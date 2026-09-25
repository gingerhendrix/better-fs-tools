import type { FileSystem } from "@better-fs-tools/fs";

import type { ReadContext } from "../contract/context.ts";
import type { Dependencies } from "../contract/deps.ts";
import type { ReadRequest } from "../contract/input.ts";
import type { ReadPhase } from "../contract/messages.ts";
import { AbortReadError } from "./cursor.ts";
import { isFileSystem } from "./deps.ts";
import { ReadStop, extensionFailed } from "./outcomes.ts";

/**
 * Per-read state: the call object, the current phase, and the filesystem.
 * The core passes `call` on by reference and never reads `call.host`.
 */
export class CallScope<THost> {
  phase: ReadPhase = "input";
  private resolvedFs: FileSystem | null = null;

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
      throw this.extensionFailure();
    }
    if (!isFileSystem(produced)) throw this.extensionFailure();
    return (this.resolvedFs = produced);
  }

  private extensionFailure(): ReadStop {
    return new ReadStop(extensionFailed(this.deps.messages, this.request, "fs", this.phase));
  }
}
