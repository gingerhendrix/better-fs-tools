import type { ExistingFileStat, OpenFile, WritableFileSystem } from "@better-fs-tools/fs";
import type { ClassificationSample } from "@better-fs-tools/read";

import type { Codec, TextStyle } from "../contract/codec.ts";
import { AbortStop } from "./abort.ts";
import { hashBytes, sameBytes } from "./bytes.ts";
import { extensionId } from "./extension-error.ts";
import { isRecord } from "./input.ts";
import { WriteStop, isBackendError, messageOf } from "./outcomes.ts";
import type { MutationScope } from "./scope.ts";
import { ioFailure } from "./target.ts";

export interface Loaded {
  readonly bytes: Uint8Array;
  readonly text: string;
  readonly style: TextStyle;
  readonly codec: Codec;
  readonly version: string;
  readonly contentId: string | null;
  readonly mode: number | null;
}

export async function loadFile<THost>(
  scope: MutationScope<THost>,
  fs: WritableFileSystem,
  stat: ExistingFileStat,
  requested: string,
): Promise<Loaded> {
  scope.enter("load");
  scope.checkAbort();
  const { limits, messages } = scope.deps;
  const tooLarge = () =>
    scope.stop(
      "TOO_LARGE",
      messages.tooLarge({
        path: requested,
        what: "file",
        limit: limits.maxFileBytes,
        existing: true,
      }),
      { limit: limits.maxFileBytes },
    );
  const stale = () => scope.stop("STALE", messages.stale({ tool: scope.tool, path: requested }));
  if (stat.size > limits.maxFileBytes) throw tooLarge();

  const { signal } = scope;
  const started: Promise<unknown>[] = [];
  let opened: unknown;
  try {
    opened = await scope.race(() => {
      const pending = fs.open(stat.resolvedPath, signal === undefined ? {} : { signal });
      started.push(Promise.resolve(pending));
      return pending;
    });
  } catch (error) {
    if (error instanceof AbortStop) {
      for (const pending of started) void pending.then(closeHandleOpenedAfterAbort, () => {});
      throw error;
    }
    throw ioFailure(scope, requested, messageOf(error));
  }
  if (isRecord(opened) && opened.ok === false && isBackendError(opened.error)) {
    throw scope.backendFailure(requested, opened.error);
  }
  if (!isRecord(opened) || opened.ok !== true || !isRecord(opened.file)) {
    throw ioFailure(scope, requested, "malformed open outcome");
  }
  const handle = opened.file as unknown as OpenFile;
  try {
    const { info } = handle;
    if ((info.version ?? null) !== stat.version) throw stale();
    if (info.size !== null && info.size > limits.maxFileBytes) throw tooLarge();
    const bytes = await readCapped(scope, handle, limits.maxFileBytes, requested, tooLarge);
    if (info.size !== null && bytes.byteLength !== info.size) throw stale();

    const sample: ClassificationSample = {
      bytes: bytes.subarray(0, limits.sampleBytes),
      complete: bytes.byteLength <= limits.sampleBytes,
      path: info.displayPath,
      mimeType: info.mimeType,
    };
    classify(scope, sample, requested);
    const { codec, text, style } = decode(scope, sample, bytes, requested);

    let verified: unknown;
    try {
      verified = await scope.race(() => handle.verify());
    } catch (error) {
      if (error instanceof AbortStop) throw error;
      throw ioFailure(scope, requested, messageOf(error));
    }
    if (isRecord(verified) && verified.ok === false && isBackendError(verified.error)) {
      throw scope.backendFailure(requested, verified.error);
    }
    if (!isRecord(verified) || verified.ok !== true) {
      throw ioFailure(scope, requested, "malformed verify outcome");
    }
    if (verified.changed !== false) throw stale();

    const { digest } = scope.deps;
    return {
      bytes,
      text,
      style,
      codec,
      version: stat.version,
      contentId: digest === null ? null : hashBytes(digest, bytes),
      mode: stat.mode,
    };
  } finally {
    await handle.close().catch(() => {});
  }
}

export async function readCapped<THost>(
  scope: MutationScope<THost>,
  handle: OpenFile,
  max: number,
  requested: string,
  tooLarge: () => Error,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  let iterator: AsyncIterator<Uint8Array> | null = null;
  try {
    iterator = handle.bytes()[Symbol.asyncIterator]();
    const source = iterator;
    for (;;) {
      scope.checkAbort();
      const item: unknown = await scope.race(() => source.next());
      if (!isRecord(item) || typeof item.done !== "boolean") {
        throw ioFailure(scope, requested, "the byte source returned an invalid result");
      }
      if (item.done) break;
      if (!(item.value instanceof Uint8Array)) {
        throw ioFailure(scope, requested, "the byte source yielded a non-Uint8Array chunk");
      }
      total += item.value.byteLength;
      if (total > max) throw tooLarge();
      chunks.push(item.value);
    }
  } catch (error) {
    if (error instanceof AbortStop || error instanceof WriteStop) throw error;
    throw ioFailure(scope, requested, messageOf(error));
  } finally {
    try {
      await iterator?.return?.(undefined);
    } catch {
      // An adapter that fails to unwind cannot fail the call.
    }
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function classify<THost>(
  scope: MutationScope<THost>,
  sample: ClassificationSample,
  requested: string,
): void {
  const { classifiers, messages } = scope.deps;
  for (const classifier of classifiers) {
    let decision: unknown;
    try {
      decision = classifier.classify(sample);
    } catch (error) {
      throw scope.extensionFailure("classifiers", extensionId(classifier, error));
    }
    if (decision === null) continue;
    if (!isRecord(decision)) throw scope.extensionFailure("classifiers", extensionId(classifier));
    if (decision.kind === "text") return;
    if (decision.kind === "unsupported" && typeof decision.code === "string") {
      const { code } = decision;
      throw scope.stop("NOT_TEXT", messages.notText({ path: requested, code }), {
        code,
        classifier: classifier.id,
      });
    }
    throw scope.extensionFailure("classifiers", extensionId(classifier));
  }
  throw scope.stop(
    "UNSUPPORTED_BACKEND",
    messages.unsupportedBackend({ path: requested, detail: "no classifier had an opinion" }),
  );
}

function decode<THost>(
  scope: MutationScope<THost>,
  sample: ClassificationSample,
  bytes: Uint8Array,
  requested: string,
): { readonly codec: Codec; readonly text: string; readonly style: TextStyle } {
  const { codecs, messages } = scope.deps;
  const notText = (code: string) =>
    scope.stop("NOT_TEXT", messages.notText({ path: requested, code }), { code });
  let codec: Codec | undefined;
  for (const candidate of codecs) {
    let accepted: unknown;
    try {
      accepted = candidate.accepts(sample);
    } catch (error) {
      throw scope.extensionFailure("codecs", extensionId(candidate, error));
    }
    if (accepted === true) {
      codec = candidate;
      break;
    }
  }
  if (codec === undefined) throw notText("UNKNOWN_ENCODING");
  const chosen = codec;
  const failed = (error?: unknown) => scope.extensionFailure("codecs", extensionId(chosen, error));
  let decoded: unknown;
  try {
    decoded = codec.decode(bytes);
  } catch (error) {
    throw failed(error);
  }
  if (!isRecord(decoded)) throw failed();
  if (decoded.ok === false) throw notText("UNKNOWN_ENCODING");
  if (decoded.ok !== true || typeof decoded.text !== "string" || !isRecord(decoded.style)) {
    throw failed();
  }
  const text = decoded.text;
  const style = decoded.style as unknown as TextStyle;
  let encoded: unknown;
  try {
    encoded = codec.encode(text, style);
  } catch (error) {
    throw failed(error);
  }
  if (!(encoded instanceof Uint8Array)) throw failed();
  if (!sameBytes(encoded, bytes)) throw notText("ROUND_TRIP");
  return { codec, text, style };
}

function closeHandleOpenedAfterAbort(outcome: unknown): void {
  if (isRecord(outcome) && outcome.ok === true && isRecord(outcome.file)) {
    const file = outcome.file as unknown as OpenFile;
    void file.close().catch(() => {});
  }
}
