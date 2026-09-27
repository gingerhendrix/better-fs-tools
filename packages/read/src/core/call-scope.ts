import type { FileSystem, ListOutcome } from "@better-fs-tools/fs";

import type { ReadContext } from "../contract/context.ts";
import type { Dependencies } from "../contract/deps.ts";
import type { HookContext } from "../contract/extensions.ts";
import type { ReadRequest } from "../contract/input.ts";
import type { ReadPhase } from "../contract/messages.ts";
import type { ReadNote } from "../contract/result.ts";
import type { ReadStateStore } from "../contract/state.ts";
import { authorizeList } from "./authorize.ts";
import { AbortReadError } from "./cursor.ts";
import { isFileSystem, isStateStore } from "./deps.ts";
import { ReadStop, extensionFailed, messageOf } from "./outcomes.ts";

/**
 * The two listings a read may make. `resolver` is the one `ctx.list` call a
 * resolver gets. `open` is the one listing after open: suggestions on a miss,
 * or the directory converter's listing.
 */
export type ListingSlot = "resolver" | "open";

/**
 * Per-read state: the call object, the current phase, the filesystem, the
 * state store, the listing budget, and the authorizer's allow notes.
 * The core passes `call` on by reference and never reads `call.host`.
 */
export class CallScope<THost> {
  phase: ReadPhase = "input";
  /** Notes from every allow decision in this read, in order. */
  readonly allowNotes: ReadNote[] = [];
  /** A failure a listing could not throw. See hold(). */
  private held: ReadStop | null = null;
  private resolvedFs: FileSystem | null = null;
  /** undefined until the core first needs the store. */
  private resolvedState: ReadStateStore | null | undefined = undefined;
  private hook: HookContext<THost> | null = null;
  private readonly listed = new Set<ListingSlot>();

  constructor(
    readonly deps: Dependencies<THost>,
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

  /** The context every host function gets. One object for each read. */
  hookContext(): HookContext<THost> {
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

  /**
   * Every fs.list in a read goes through here. One bounded listing for each
   * slot; a second request in the same slot gets an error outcome. authorize
   * with action "list" runs before the fs.list. Never throws: a missing
   * list(), a spent slot, a denial, an abort, or a throwing backend becomes an
   * error outcome. A throwing authorizer is held; see hold(). `display` is the
   * authorizer's displayPath, when it differs from `dir`.
   */
  async list(slot: ListingSlot, dir: string, display: string = dir): Promise<ListOutcome> {
    if (this.listed.has(slot)) {
      return { ok: false, error: { reason: "denied", detail: "listing budget spent" } };
    }
    this.listed.add(slot);
    const fs = this.fileSystem();
    if (typeof fs.list !== "function") {
      return { ok: false, error: { reason: "unsupported", detail: "the backend cannot list" } };
    }
    const refused = await authorizeList(this.deps.authorize, this.request, dir, display, this);
    if (refused !== null) return refused;
    const signal = this.signal;
    const limit = this.deps.limits.maxDirectoryEntries;
    try {
      return await fs.list(dir, signal === undefined ? { limit } : { limit, signal });
    } catch (error) {
      return { ok: false, error: { reason: "io", detail: messageOf(error) } };
    }
  }

  /**
   * Keeps the first failure from a stage that must not throw (a listing), so
   * host code cannot swallow it. The stage that asked raises it with throwHeld().
   */
  hold(stop: ReadStop): void {
    this.held ??= stop;
  }

  throwHeld(): void {
    if (this.held !== null) throw this.held;
  }

  /**
   * A ReadStop with EXTENSION_FAILED for the named dependency in the current
   * phase. `id` is the extension object's id, when it has one.
   */
  extensionFailure(extension: string, id: string | null = null): ReadStop {
    return new ReadStop(
      extensionFailed(this.deps.messages, this.request, extension, this.phase, id),
    );
  }
}
