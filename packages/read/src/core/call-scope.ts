import type { FileSystem, ListOutcome } from "@better-fs-tools/fs";

import type { ReadContext } from "../contract/context.ts";
import type { ReadDependencies } from "../contract/deps.ts";
import type { ReadHookContext } from "../contract/extensions.ts";
import type { ReadRequest } from "../contract/input.ts";
import type { ReadPhase } from "../contract/messages.ts";
import type { ReadNote } from "../contract/result.ts";
import type { ReadStateStore } from "../contract/state.ts";
import { authorizeList } from "./authorize.ts";
import { AbortReadError } from "./cursor.ts";
import { isFileSystem, isStateStore } from "./deps.ts";
import { ReadStop, extensionFailed, messageOf } from "./outcomes.ts";

/** `resolver`: the resolver's `ctx.list`. `open`: suggestions on a miss, or a directory converter. */
export type ListingSlot = "resolver" | "open";

export class CallScope<THost> {
  phase: ReadPhase = "input";
  readonly allowNotes: ReadNote[] = [];
  private heldFailure: ReadStop | null = null;
  private resolvedFs: FileSystem | null = null;
  private resolvedState: ReadStateStore | null | undefined = undefined;
  private hook: ReadHookContext<THost> | null = null;
  private readonly listed = new Set<ListingSlot>();

  constructor(
    readonly deps: ReadDependencies<THost>,
    private readonly request: ReadRequest,
    readonly call: ReadContext<THost>,
  ) {}

  get signal(): AbortSignal | undefined {
    return this.call.signal;
  }

  enter(phase: ReadPhase): void {
    this.phase = phase;
  }

  checkAbort(): void {
    if (this.call.signal?.aborted) throw new AbortReadError("aborted");
  }

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

  hookContext(): ReadHookContext<THost> {
    if (this.hook !== null) return this.hook;
    const { limits, messages, digest, clock } = this.deps;
    return (this.hook = Object.freeze({
      tool: "read",
      request: this.request,
      limits,
      messages,
      digest,
      clock,
      call: this.call,
    }));
  }

  /** One bounded, authorized listing per slot. Never throws: every failure is an error outcome. */
  async list(slot: ListingSlot, dir: string, displayPath: string = dir): Promise<ListOutcome> {
    if (this.listed.has(slot)) {
      return { ok: false, error: { reason: "denied", detail: "listing budget spent" } };
    }
    this.listed.add(slot);
    const fs = this.fileSystem();
    if (typeof fs.list !== "function") {
      return { ok: false, error: { reason: "unsupported", detail: "the backend cannot list" } };
    }
    const refused = await authorizeList(this.deps.authorize, this.request, dir, displayPath, this);
    if (refused !== null) return refused;
    const signal = this.signal;
    const limit = this.deps.limits.maxDirectoryEntries;
    try {
      return await fs.list(dir, signal === undefined ? { limit } : { limit, signal });
    } catch (error) {
      return { ok: false, error: { reason: "io", detail: messageOf(error) } };
    }
  }

  /** Keeps a listing failure out of reach of host code that might catch and ignore it. */
  hold(stop: ReadStop): void {
    this.heldFailure ??= stop;
  }

  throwHeld(): void {
    if (this.heldFailure !== null) throw this.heldFailure;
  }

  extensionFailure(extension: string, id: string | null = null): ReadStop {
    return new ReadStop(
      extensionFailed(this.deps.messages, this.request, extension, this.phase, id),
    );
  }
}
