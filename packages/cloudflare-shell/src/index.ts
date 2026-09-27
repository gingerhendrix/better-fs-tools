/**
 * A Cloudflare Shell Workspace as a `FileSystem`.
 *
 * Nothing from `@cloudflare/shell` is imported here. The Workspace surface this
 * adapter needs is declared structurally below, so the package stays
 * importable in a Worker that pins a different Shell release, and nothing
 * Node-specific can reach the Worker graph.
 *
 * Two Shell properties shape the whole adapter:
 *
 * - **Reads are buffered and uncancellable.** `readFileBytes` resolves with the
 *   whole object and offers no signal, so the adapter owns an allocation
 *   ceiling on both sides of the call (the size Shell reports before it, the
 *   length it returns after it) and checks abort around it. The read happens in
 *   `open()`, which keeps `bytes()` synchronous: there is no suspended await
 *   for `close()` to wait on after an abort.
 * - **Identity is weak.** A Workspace row has no inode or ETag, so
 *   `capabilities.identity` is false, `info.identity` is null, and `verify()`
 *   is mutation detection over bounded metadata rather than an identity claim.
 *
 * Policy is adapter-owned and fails closed. Containment is checked lexically
 * before any Workspace call, and every path component from the configured root
 * to the target is `lstat`ed and refused if it is a symlink. A Workspace that
 * does not implement `lstat` is rejected at construction rather than served
 * with a weaker rule.
 */
import { containsPosix, posixPaths, resolvePosix } from "@better-fs-tools/fs";
import type {
  DirectoryEntry,
  FileSystem,
  FileSystemError,
  ListOptions,
  ListOutcome,
  NotAFileError,
  OpenFile,
  OpenOptions,
  OpenOutcome,
  VerifyOutcome,
} from "@better-fs-tools/fs";

/** 4 MiB. Far above any view the read tool will produce, far below a Worker's memory. */
const DEFAULT_MAX_BUFFERED_BYTES = 4 * 1024 * 1024;

/**
 * An entry as a Shell Workspace describes it. A structural subset of Shell's
 * `FileInfo` / `FileStat`: the fields this adapter reads are declared, the rest
 * are ignored, and everything optional here is validated at runtime anyway.
 */
export interface ShellFileInfo {
  path: string;
  type: "file" | "directory" | "symlink";
  size: number;
  /** Epoch milliseconds. Shell's `updatedAt`. */
  updatedAt: number;
  name?: string;
  mimeType?: string;
  target?: string;
}

/**
 * The Workspace methods this adapter uses. `@cloudflare/shell`'s `Workspace`
 * and its `WorkspaceFsLike` structural type both satisfy it.
 *
 * `lstat` is required, not optional: it is the only way to see a symlink
 * before `stat` follows it.
 */
export interface ShellWorkspaceLike {
  stat(path: string): Promise<ShellFileInfo | null>;
  lstat(path: string): Promise<ShellFileInfo | null>;
  readFileBytes(path: string): Promise<Uint8Array | null>;
  readDir(dir: string, opts?: { limit?: number; offset?: number }): Promise<ShellFileInfo[]>;
}

export interface ShellWorkspaceFileSystemOptions {
  /** Absolute POSIX path. Nothing outside it is readable or listable. */
  root: string;
  /**
   * Ceiling on one buffered object, applied to the size Shell reports and to
   * the length it returns. Defaults to 4 MiB.
   */
  maxBufferedBytes?: number;
  id?: string;
}

export interface ShellWorkspaceFileSystem extends FileSystem {
  readonly root: string;
  readonly maxBufferedBytes: number;
  list(path: string, options: ListOptions): Promise<ListOutcome>;
}

/**
 * Adapt a Cloudflare Shell Workspace to the filesystem contract.
 *
 * Every method resolves the requested path against `root`, refuses anything
 * outside it before the Workspace is touched, and walks the path with `lstat`
 * so a symlinked root, parent or leaf is refused before any byte is read.
 */
export function shellWorkspaceFileSystem(
  workspace: ShellWorkspaceLike,
  options: ShellWorkspaceFileSystemOptions,
): ShellWorkspaceFileSystem {
  validateWorkspace(workspace);
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("shellWorkspaceFileSystem options must be an object");
  }
  if (
    typeof options.root !== "string" ||
    !options.root.startsWith("/") ||
    options.root.includes("\0")
  ) {
    throw new TypeError("root must be an absolute POSIX path without NUL");
  }
  const maxBufferedBytes = options.maxBufferedBytes ?? DEFAULT_MAX_BUFFERED_BYTES;
  if (!Number.isSafeInteger(maxBufferedBytes) || maxBufferedBytes <= 0) {
    throw new TypeError("maxBufferedBytes must be a positive safe integer");
  }
  const root = resolvePosix("/", options.root);

  /** Refuse a symlinked root, a symlinked parent and a symlinked leaf. */
  const walk = async (target: string): Promise<ShellFileInfo> => {
    for (const component of components(root, target)) {
      const stat = await inspect(workspace, "lstat", component);
      if (stat === null) {
        throw refuse({
          reason: "not-found",
          ...(component === target ? {} : { detail: "a path component does not exist" }),
        });
      }
      if (stat.type === "symlink") {
        throw refuse({
          reason: "denied",
          detail:
            component === target
              ? "the path is a symbolic link and this adapter refuses symlinks"
              : "a path component is a symbolic link and this adapter refuses symlinks",
        });
      }
      if (component !== target && stat.type !== "directory") {
        throw refuse({ reason: "not-found", detail: "a path component is not a directory" });
      }
      if (component === target) return stat;
    }
    /* Only reachable when the target is the root "/" itself, which is a directory. */
    throw refuse(notAFile("directory", root, target));
  };

  return Object.freeze({
    id: options.id ?? "cloudflare-shell",
    capabilities: Object.freeze({ streaming: false, identity: false }),
    paths: posixPaths,
    root,
    maxBufferedBytes,

    async open(requested: string, callOptions: OpenOptions = {}): Promise<OpenOutcome> {
      const signal = callOptions.signal;
      if (signal?.aborted) return { ok: false, error: { reason: "aborted" } };

      try {
        const target = authorize(root, requested);
        await walk(target);

        const stat = await inspect(workspace, "stat", target);
        if (stat === null) throw refuse({ reason: "not-found" });
        if (stat.type !== "file") {
          throw refuse(notAFile(stat.type === "directory" ? "directory" : "other", root, target));
        }
        if (stat.size > maxBufferedBytes) {
          throw refuse({
            reason: "denied",
            detail: `the object exceeds the ${maxBufferedBytes}-byte buffered ceiling`,
          });
        }

        /*
         * The uncancellable window. Shell buffers the whole object and takes no
         * signal, so abort is checked on both sides: before, to avoid starting
         * work nobody wants, and after, because the caller may have given up
         * while Shell was reading. Backend work can still finish after the
         * caller has been told the read was aborted.
         */
        if (signal?.aborted) throw refuse({ reason: "aborted" });
        const bytes = await call(workspace.readFileBytes(target), "readFileBytes");
        if (signal?.aborted) throw refuse({ reason: "aborted" });
        if (bytes === null) {
          throw refuse({
            reason: "not-found",
            detail: "the entry disappeared before its buffered read",
          });
        }
        if (!(bytes instanceof Uint8Array)) {
          throw invalid("readFileBytes returned neither bytes nor null", "readFileBytes");
        }
        if (bytes.byteLength > maxBufferedBytes) {
          throw refuse({
            reason: "denied",
            detail: `the backend returned more than the ${maxBufferedBytes}-byte buffered ceiling`,
          });
        }
        return { ok: true, file: shellOpenFile(workspace, root, target, stat, bytes) };
      } catch (error) {
        return { ok: false, error: toFileSystemError(error) };
      }
    },

    async list(requested: string, listOptions: ListOptions): Promise<ListOutcome> {
      if (listOptions.signal?.aborted) return { ok: false, error: { reason: "aborted" } };
      const limit = listOptions.limit;
      if (!Number.isSafeInteger(limit) || limit <= 0) {
        return {
          ok: false,
          error: { reason: "io", detail: "list limit must be a positive safe integer" },
        };
      }
      try {
        const target = authorize(root, requested);
        /* A root of "/" has no component for walk() to inspect, and it is a directory. */
        const stat = target === "/" ? null : await walk(target);
        /* Same rule as memoryFileSystem: listing a non-directory is not-found. */
        if (stat !== null && stat.type !== "directory") {
          throw refuse({ reason: "not-found", detail: "not a directory" });
        }

        /* One past the limit, so `truncated` reports the directory and not the request. */
        const listed = await call(
          workspace.readDir(target, { limit: limit + 1, offset: 0 }),
          "readDir",
        );
        if (!Array.isArray(listed)) throw invalid("readDir returned a non-array", "readDir");

        const entries: DirectoryEntry[] = [];
        for (const value of listed.slice(0, limit)) {
          const entry = validateStat(value, "readDir");
          if (entry === null) throw invalid("readDir returned a null entry", "readDir");
          const path = resolvePosix("/", entry.path);
          if (posixPaths.dirname(path) !== target) {
            throw invalid("readDir returned an entry outside the listed directory", "readDir");
          }
          entries.push({
            name: posixPaths.basename(path),
            type: entry.type === "symlink" ? "other" : entry.type,
          });
        }
        return { ok: true, entries, truncated: listed.length > limit };
      } catch (error) {
        return { ok: false, error: toFileSystemError(error) };
      }
    },
  });
}

function shellOpenFile(
  workspace: ShellWorkspaceLike,
  root: string,
  target: string,
  stat: ShellFileInfo,
  bytes: Uint8Array,
): OpenFile {
  let consumed = false;
  let closed = false;
  return {
    info: {
      resolvedPath: target,
      displayPath: display(root, target),
      size: stat.size,
      mtimeMs: stat.updatedAt,
      /* Weak by capability: a Workspace row carries nothing durable to compare. */
      identity: null,
      mimeType: stat.mimeType ?? null,
      /* Weak: the same size and updatedAt that verify() compares. */
      version: `shell:${stat.size}:${stat.updatedAt}`,
    },
    bytes(): AsyncIterable<Uint8Array> {
      if (consumed) throw new TypeError("shell workspace byte source is single-use");
      consumed = true;
      /*
       * The object is already in memory, so this iterator never awaits anything
       * a `close()` after an abort would have to wait for.
       */
      let sent = closed || bytes.byteLength === 0;
      return {
        [Symbol.asyncIterator]() {
          return {
            async next(): Promise<IteratorResult<Uint8Array>> {
              if (sent || closed) return { done: true, value: undefined };
              sent = true;
              return { done: false, value: bytes };
            },
            async return(): Promise<IteratorResult<Uint8Array>> {
              sent = true;
              return { done: true, value: undefined };
            },
          };
        },
      };
    },
    async verify(): Promise<VerifyOutcome> {
      try {
        /* `lstat`, so a file replaced by a symlink reads as a change, not as a file. */
        const current = await inspect(workspace, "lstat", target);
        if (current === null) return { ok: true, changed: true };
        const changed =
          current.type !== stat.type ||
          current.size !== stat.size ||
          current.updatedAt !== stat.updatedAt;
        return { ok: true, changed };
      } catch (error) {
        return { ok: false, error: toFileSystemError(error) };
      }
    },
    async close(): Promise<void> {
      closed = true;
      consumed = true;
    },
  };
}

/** Root, then every component beneath it, ending at the target. */
function components(root: string, target: string): string[] {
  const found: string[] = root === "/" ? [] : [root];
  const relative = target === root ? "" : target.slice(root === "/" ? 1 : root.length + 1);
  let current = root;
  for (const segment of relative.split("/")) {
    if (segment === "") continue;
    current = current === "/" ? `/${segment}` : `${current}/${segment}`;
    found.push(current);
  }
  return found;
}

/**
 * Lexical containment, before the Workspace is touched at all. A relative path
 * is resolved against the root, so a Worker prompt can use either form, and
 * `..` is folded by the resolver before the check rather than after it.
 */
function authorize(root: string, requested: unknown): string {
  if (typeof requested !== "string" || requested === "") {
    throw refuse({ reason: "io", detail: "the requested path must be a non-empty string" });
  }
  if (requested.includes("\0")) {
    throw refuse({ reason: "dangerous-path", detail: "the path contains NUL" });
  }
  const target = resolvePosix(root, requested);
  if (!containsPosix(root, target)) throw refuse({ reason: "outside-allowed-roots" });
  return target;
}

/** Relative to the root. The root itself shows its own name, or "/". */
function display(root: string, target: string): string {
  if (target === root) return posixPaths.basename(target) || "/";
  return target.slice(root === "/" ? 1 : root.length + 1);
}

function notAFile(kind: NotAFileError["kind"], root: string, target: string): NotAFileError {
  return {
    reason: "not-a-file",
    kind,
    target: { resolvedPath: target, displayPath: display(root, target) },
  };
}

/** One `stat` or `lstat` call, validated. */
async function inspect(
  workspace: ShellWorkspaceLike,
  method: "stat" | "lstat",
  path: string,
): Promise<ShellFileInfo | null> {
  const value = await call(workspace[method](path), method);
  const stat = validateStat(value, method);
  if (stat !== null && resolvePosix("/", stat.path) !== path) {
    throw invalid(`${method} returned an entry for a different path`, method);
  }
  return stat;
}

function validateStat(value: unknown, phase: string): ShellFileInfo | null {
  if (value === null) return null;
  if (value === undefined || typeof value !== "object" || Array.isArray(value)) {
    throw invalid(`${phase} returned neither an entry nor null`, phase);
  }
  const entry = value as Record<string, unknown>;
  if (typeof entry.path !== "string" || !entry.path.startsWith("/") || entry.path.includes("\0")) {
    throw invalid(`${phase} returned an entry without an absolute path`, phase);
  }
  if (entry.type !== "file" && entry.type !== "directory" && entry.type !== "symlink") {
    throw invalid(`${phase} returned an unknown entry type`, phase);
  }
  if (!Number.isSafeInteger(entry.size) || (entry.size as number) < 0) {
    throw invalid(`${phase} returned an unusable size`, phase);
  }
  if (typeof entry.updatedAt !== "number" || !Number.isFinite(entry.updatedAt)) {
    throw invalid(`${phase} returned an unusable modification time`, phase);
  }
  if (entry.mimeType !== undefined && typeof entry.mimeType !== "string") {
    throw invalid(`${phase} returned an unusable mime type`, phase);
  }
  const mimeType =
    typeof entry.mimeType === "string" && entry.mimeType !== "" ? entry.mimeType : undefined;
  return {
    path: entry.path,
    type: entry.type,
    size: entry.size as number,
    updatedAt: entry.updatedAt,
    ...(mimeType === undefined ? {} : { mimeType }),
  };
}

/** Await one Workspace call, mapping whatever it throws exactly once. */
async function call<T>(pending: Promise<T> | T, phase: string): Promise<T> {
  try {
    return await pending;
  } catch (error) {
    if (error instanceof AdapterRefusal) throw error;
    throw refuse(mapBackendError(error, phase));
  }
}

/**
 * Shell surfaces failures as thrown errors from its SQL and R2 layers. They are
 * mapped once, here, into the reason vocabulary, keeping a bounded code and the
 * phase for diagnostics and dropping the message.
 */
function mapBackendError(error: unknown, phase: string): FileSystemError {
  const code = boundedCode(error);
  const cause = { code, phase };
  if (code === "ABORT_ERR") return { reason: "aborted", cause };
  if (code === "ENOENT" || code === "ENOTDIR") return { reason: "not-found", cause };
  /* The call site knows no path, so the target is unknown. */
  if (code === "EISDIR") return { reason: "not-a-file", kind: "directory", target: null, cause };
  if (code === "EACCES" || code === "EPERM") return { reason: "permission-denied", cause };
  if (code === "ELOOP") return { reason: "denied", detail: "too many symbolic links", cause };
  return { reason: "io", detail: phase, cause };
}

/** A short, allocation-bounded token. Never the backend's message. */
function boundedCode(error: unknown): string {
  if (error !== null && typeof error === "object" && "code" in error) {
    const code = (error as { code: unknown }).code;
    if (typeof code === "string" && /^[A-Za-z0-9_.-]{1,40}$/u.test(code)) return code;
  }
  if (error instanceof Error && error.name === "AbortError") return "ABORT_ERR";
  return "UNKNOWN";
}

/** Carries a typed error out of a helper. Never escapes this module. */
class AdapterRefusal extends Error {
  constructor(readonly error: FileSystemError) {
    super(error.reason);
    this.name = "AdapterRefusal";
  }
}

function refuse(error: FileSystemError): AdapterRefusal {
  return new AdapterRefusal(error);
}

function invalid(detail: string, phase: string): AdapterRefusal {
  return new AdapterRefusal({
    reason: "io",
    detail,
    cause: { code: "INVALID_BACKEND_RESULT", phase },
  });
}

/**
 * `open()` and `list()` return errors, never throw, so an unexpected throw from
 * anywhere below becomes a bounded `io` error rather than escaping the adapter.
 */
function toFileSystemError(error: unknown): FileSystemError {
  if (error instanceof AdapterRefusal) return error.error;
  return {
    reason: "io",
    detail: "the Shell Workspace adapter failed",
    cause: { code: boundedCode(error) },
  };
}

function validateWorkspace(workspace: ShellWorkspaceLike): void {
  if (workspace === null || typeof workspace !== "object" || Array.isArray(workspace)) {
    throw new TypeError("shellWorkspaceFileSystem needs a Shell Workspace object");
  }
  for (const method of ["stat", "lstat", "readFileBytes", "readDir"] as const) {
    if (typeof workspace[method] !== "function") {
      /* Fail closed: an absent `lstat` would mean serving reads without a symlink check. */
      throw new TypeError(`the Shell Workspace must implement ${method}()`);
    }
  }
}
