import type { FileSystemError, MutationError, WritableFileSystem } from "@better-fs-tools/fs";
import type { JsonObject, Note, ReadStateStore, ToolCallContext } from "@better-fs-tools/read";

import type { WriteDependencies } from "../contract/deps.ts";
import type { WriteHookContext } from "../contract/extensions.ts";
import type { MutationRequest } from "../contract/input.ts";
import type { WriteErrorCode, WritePhase } from "../contract/result.ts";
import { AbortStop, raceAbort } from "./abort.ts";
import { isFileSystem, isStateStore, isWritable } from "./deps.ts";
import { WriteStop, backendErrorNote, errorNote, failure } from "./outcomes.ts";

export class MutationScope<THost> {
  phase: WritePhase = "input";
  readonly notes: Note[] = [];
  private commitStarted = false;
  private resolvedFs: WritableFileSystem | null = null;
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

  get signal(): AbortSignal | undefined {
    return this.commitStarted ? undefined : this.call.signal;
  }

  enter(phase: WritePhase): void {
    this.phase = phase;
  }

  startCommit(): void {
    this.commitStarted = true;
  }

  checkAbort(): void {
    if (this.signal?.aborted) throw new AbortStop();
  }

  race<T>(start: () => T | Promise<T>): Promise<T> {
    return raceAbort(start, this.signal);
  }

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
    // A read-only backend is a configuration problem, not a host bug.
    if (isFileSystem(produced)) {
      throw this.backendFailure(this.path ?? "the patch", {
        reason: "unsupported",
        detail: "the filesystem has no write methods",
      });
    }
    throw this.extensionFailure("fs");
  }

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

  get path(): string | null {
    return this.request.tool === "apply_patch" ? null : this.request.path;
  }

  stop(code: WriteErrorCode, message: string, data?: JsonObject): WriteStop {
    return this.stopWith(errorNote(code, message, data));
  }

  stopWith(note: Note): WriteStop {
    return new WriteStop(failure(this.tool, this.phase, note));
  }

  backendFailure(path: string, error: FileSystemError | MutationError): WriteStop {
    return this.stopWith(backendErrorNote(this.deps.messages, this.tool, path, error, this.phase));
  }

  extensionFailure(extension: string, id: string | null = null): WriteStop {
    const { phase } = this;
    return this.stop(
      "EXTENSION_FAILED",
      this.deps.messages.extensionFailed({ path: this.path, extension, phase }),
      id === null ? { extension, phase } : { extension, phase, id },
    );
  }
}
