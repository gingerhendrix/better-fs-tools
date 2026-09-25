import type { FileSystem } from "@better-fs-tools/fs";

import type { ReadContext } from "../contract/context.ts";
import type { Dependencies } from "../contract/deps.ts";
import type { ReadRequest } from "../contract/input.ts";
import type { ReadPhase } from "../contract/messages.ts";
import type { ReadStateStore } from "../contract/state.ts";
import { AbortReadError } from "./cursor.ts";
import { isFileSystem, isStateStore } from "./deps.ts";
import { ReadStop, extensionFailed } from "./outcomes.ts";

/**
 * Per-read state: the call object, the current phase, the filesystem, and the
 * state store.
 * The core passes `call` on by reference and never reads `call.host`.
 */
export class CallScope<THost> {
  phase: ReadPhase = "input";
  private resolvedFs: FileSystem | null = null;
  /** undefined until the core first needs the store. */
  private resolvedState: ReadStateStore | null | undefined = undefined;

  constructor(
    private readonly deps: Dependencies<THost>,
    private readonly request: ReadRequest,
    readonly call: ReadContext<THost>,
  ) {}

  get signal(): AbortSignal | undefined {
    return this.call.signal;
  }

  enter(phase: ReadPhase): void {
    this.phase = phase;
  }

  /** Throws AbortReadError when the caller aborted. The pipeline maps it to ABORTED with the phase. */
  checkAbort(): void {
    if (this.call.signal?.aborted) throw new AbortReadError("aborted");
  }

  /** `deps.fs`, or the result of `fs(call)`. The factory runs at most once for each read. */
  fileSystem(): FileSystem {
    if (this.resolvedFs !== null) return this.resolvedFs;
    const { fs } = this.deps;
    if (typeof fs !== "function") return (this.resolvedFs = fs);
    let produced: unknown;
    try {
      produced = fs(this.call);
    } catch {
      throw this.extensionFailure("fs");
    }
    if (!isFileSystem(produced)) throw this.extensionFailure("fs");
    return (this.resolvedFs = produced);
  }

  /**
   * `deps.state`, or the result of `state(call)`. The factory runs at most once
   * for each read, and only when a stage asks for the store.
   */
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

  private extensionFailure(extension: string): ReadStop {
    return new ReadStop(extensionFailed(this.deps.messages, this.request, extension, this.phase));
  }
}
