import type { FileSystemError, MutationError, WritableFileSystem } from "@better-fs-tools/fs";
import type { JsonObject, Note, ReadStateStore, ToolCallContext } from "@better-fs-tools/read";

import type { WriteDependencies } from "../contract/deps.ts";
import type { WriteHookContext } from "../contract/extensions.ts";
import type { MutationRequest } from "../contract/input.ts";
import type { WriteErrorCode, WritePhase } from "../contract/result.ts";
import { AbortStop, raceAbort } from "./abort.ts";
import { isReadable, isStateStore, isWritable } from "./deps.ts";
import { WriteStop, backendErrorNote, errorNote, failure } from "./outcomes.ts";

/**
 * Per-call state: the call object, the current phase, the filesystem, the
 * state store, and the notes gathered so far. The core passes `call` on by
 * reference and never reads `call.host`.
 */
export class MutationScope<THost> {
  phase: WritePhase = "input";
  /** Notes gathered in this call, in order. An error report keeps them after its error note. */
  readonly notes: Note[] = [];
  /** Set at the first commit call. From then on the signal is ignored. */
  private committing = false;
  private resolvedFs: WritableFileSystem | null = null;
  /** undefined until the core first needs the store. */
  private resolvedState: ReadStateStore | null | undefined = undefined;
  private hook: WriteHookContext<THost> | null = null;

  constructor(
    readonly deps: WriteDependencies<THost>,
    readonly request: MutationRequest,
    readonly call: ToolCallContext<THost>,
  ) {}

  get tool(): MutationRequest["tool"] {
    return this.request.tool;
  }

  /** The caller's signal, until the commit starts. */
  get signal(): AbortSignal | undefined {
    return this.committing ? undefined : this.call.signal;
  }

  enter(phase: WritePhase): void {
    this.phase = phase;
  }

  /** From the first commit call to the end of the call, the signal is ignored. */
  startCommit(): void {
    this.committing = true;
  }

  /** Throws AbortStop when the caller aborted, until the commit starts. */
  checkAbort(): void {
    if (this.signal?.aborted) throw new AbortStop();
  }

  /** Runs host or backend code raced against the signal. */
  race<T>(start: () => T | Promise<T>): Promise<T> {
    return raceAbort(start, this.signal);
  }

  /** `deps.fs`, or the result of `fs(call)`. The factory runs at most once for each call. */
  fileSystem(): WritableFileSystem {
    if (this.resolvedFs !== null) return this.resolvedFs;
    const { fs } = this.deps;
    if (typeof fs !== "function") return (this.resolvedFs = fs);
    let produced: unknown;
    try {
      produced = fs(this.call);
    } catch {
      throw this.extensionFailure("fs");
    }
    if (isWritable(produced)) return (this.resolvedFs = produced);
    // A read-only backend, such as readOnlyFileSystem(fs), is a configuration problem, not a bug.
    if (isReadable(produced)) {
      throw this.backendFailure(this.path ?? "the patch", {
        reason: "unsupported",
        detail: "the filesystem has no write methods",
      });
    }
    throw this.extensionFailure("fs");
  }

  /** `deps.state`, or the result of `state(call)`. The factory runs at most once for each call. */
  stateStore(): ReadStateStore | null {
    if (this.resolvedState !== undefined) return this.resolvedState;
    const { state } = this.deps;
    if (typeof state !== "function") return (this.resolvedState = state);
    let produced: unknown;
    try {
      produced = state(this.call);
    } catch {
      throw this.extensionFailure("state");
    }
    if (produced !== null && !isStateStore(produced)) throw this.extensionFailure("state");
    return (this.resolvedState = produced);
  }

  /** The context every host function gets. One object for each call. */
  hookContext(): WriteHookContext<THost> {
    if (this.hook !== null) return this.hook;
    const { limits, messages, digest, clock } = this.deps;
    return (this.hook = Object.freeze({
      tool: this.request.tool,
      request: this.request,
      limits,
      messages,
      digest,
      clock,
      call: this.call,
    }));
  }

  /** The path the messages name: the requested path, or null for apply_patch. */
  get path(): string | null {
    return this.request.tool === "apply_patch" ? null : this.request.path;
  }

  /** A WriteStop in the current phase with one error note. */
  stop(code: WriteErrorCode, message: string, data?: JsonObject): WriteStop {
    return this.stopWith(errorNote(code, message, data));
  }

  stopWith(note: Note): WriteStop {
    return new WriteStop(failure(this.tool, this.phase, note));
  }

  /** A typed backend refusal, mapped by section 5.11. */
  backendFailure(path: string, error: FileSystemError | MutationError): WriteStop {
    return this.stopWith(backendErrorNote(this.deps.messages, this.tool, path, error, this.phase));
  }

  /**
   * EXTENSION_FAILED for the named dependency in the current phase. `id` is
   * the extension object's id, when it has one.
   */
  extensionFailure(extension: string, id: string | null = null): WriteStop {
    const { phase } = this;
    return this.stop(
      "EXTENSION_FAILED",
      this.deps.messages.extensionFailed({ path: this.path, extension, phase }),
      id === null ? { extension, phase } : { extension, phase, id },
    );
  }
}
