import type { FileSystem, FileSystemError } from "./contract.ts";

export interface ConformanceFixtures {
  /** A readable file and the exact bytes it holds. */
  readonly existingFile: { readonly path: string; readonly bytes: Uint8Array };
  /** A path that does not exist inside an authorized parent. */
  readonly missingPath: string;
  /** A directory the adapter must refuse as not-a-file with kind "directory". */
  readonly directoryPath?: string;
  /** A path the adapter's policy refuses. */
  readonly refusedPath?: string;
  /** Change existingFile so verify() must report changed: true. */
  readonly mutate?: () => void | Promise<void>;
  /** A directory to list when the adapter has list(). */
  readonly listDirectory?: string;
}

export interface ConformanceCheck {
  readonly name: string;
  readonly ok: boolean;
  readonly detail?: string;
}

export interface ConformanceReport {
  readonly adapter: string;
  readonly passed: boolean;
  readonly checks: readonly ConformanceCheck[];
}

export const POLICY_REASONS: readonly FileSystemError["reason"][] = [
  "dangerous-path",
  "outside-allowed-roots",
  "permission-denied",
  "denied",
];

/**
 * Checks that a filesystem adapter keeps the read contract: a single-use byte
 * stream, change-aware verification, safe cleanup, and a typed error for every
 * refusal.
 */
export async function runFileSystemConformance(
  fs: FileSystem,
  fixtures: ConformanceFixtures,
): Promise<ConformanceReport> {
  const { checks, check } = checkRunner();

  await check("shape", async () => shapeProblem(fs));

  await check("open returns a handle with usable metadata", async () => {
    const opened = await fs.open(fixtures.existingFile.path, {});
    if (!opened.ok) return `open failed with ${opened.error.reason}`;
    try {
      const info = opened.file.info;
      if (typeof info.resolvedPath !== "string" || info.resolvedPath === "") {
        return "resolvedPath missing";
      }
      if (typeof info.displayPath !== "string" || info.displayPath === "") {
        return "displayPath missing";
      }
      if (info.size !== null && info.size !== fixtures.existingFile.bytes.byteLength) {
        return `size ${info.size} does not match the fixture`;
      }
      if (fs.capabilities.identity && (typeof info.identity !== "string" || info.identity === "")) {
        return "identity capability without a durable identity";
      }
      return null;
    } finally {
      await opened.file.close();
    }
  });

  await check("bytes() yields the exact contents once", async () => {
    const opened = await fs.open(fixtures.existingFile.path, {});
    if (!opened.ok) return `open failed with ${opened.error.reason}`;
    try {
      const chunks: Uint8Array[] = [];
      for await (const chunk of opened.file.bytes()) {
        if (!(chunk instanceof Uint8Array)) return "bytes() yielded a non-Uint8Array chunk";
        chunks.push(Uint8Array.from(chunk));
      }
      if (!equal(concat(chunks), fixtures.existingFile.bytes)) {
        return "bytes() did not yield the fixture contents";
      }
      let reused = false;
      try {
        opened.file.bytes();
        reused = true;
      } catch {
        reused = false;
      }
      return reused ? "bytes() must be single-use" : null;
    } finally {
      await opened.file.close();
    }
  });

  await check("verify() reports an unchanged handle", async () => {
    const opened = await fs.open(fixtures.existingFile.path, {});
    if (!opened.ok) return `open failed with ${opened.error.reason}`;
    try {
      const verified = await opened.file.verify();
      if (!verified.ok) return `verify failed with ${verified.error.reason}`;
      return verified.changed ? "verify() reported a change on an untouched file" : null;
    } finally {
      await opened.file.close();
    }
  });

  if (fixtures.mutate !== undefined) {
    const mutate = fixtures.mutate;
    await check("verify() reports a mutated handle", async () => {
      const opened = await fs.open(fixtures.existingFile.path, {});
      if (!opened.ok) return `open failed with ${opened.error.reason}`;
      try {
        await mutate();
        const verified = await opened.file.verify();
        if (!verified.ok) return `verify failed with ${verified.error.reason}`;
        return verified.changed ? null : "verify() missed a mutation";
      } finally {
        await opened.file.close();
      }
    });
  }

  await check("close() is idempotent", async () => {
    const opened = await fs.open(fixtures.existingFile.path, {});
    if (!opened.ok) return `open failed with ${opened.error.reason}`;
    await opened.file.close();
    await opened.file.close();
    return null;
  });

  await check("close() after a partial read", async () => {
    const opened = await fs.open(fixtures.existingFile.path, {});
    if (!opened.ok) return `open failed with ${opened.error.reason}`;
    const iterator = opened.file.bytes()[Symbol.asyncIterator]();
    await iterator.next();
    await opened.file.close();
    return null;
  });

  await check("missing path returns not-found", async () => {
    const opened = await fs.open(fixtures.missingPath, {});
    if (opened.ok) {
      await opened.file.close();
      return "a missing path opened successfully";
    }
    return opened.error.reason === "not-found" ? null : `reason was ${opened.error.reason}`;
  });

  if (fixtures.directoryPath !== undefined) {
    const directoryPath = fixtures.directoryPath;
    const openDirectory = async (): Promise<FileSystemError | string> => {
      const opened = await fs.open(directoryPath, {});
      if (!opened.ok) return opened.error;
      await opened.file.close();
      return "a directory opened successfully";
    };

    await check("directory returns not-a-file", async () => {
      const error = await openDirectory();
      if (typeof error === "string") return error;
      return error.reason === "not-a-file" ? null : `reason was ${error.reason}`;
    });

    await check("not-a-file reports kind directory", async () => {
      const error = await openDirectory();
      if (typeof error === "string") return error;
      if (error.reason !== "not-a-file") return `reason was ${error.reason}`;
      return error.kind === "directory" ? null : `kind was ${error.kind}`;
    });

    await check("not-a-file reports the directory target", async () => {
      const error = await openDirectory();
      if (typeof error === "string") return error;
      if (error.reason !== "not-a-file") return `reason was ${error.reason}`;
      const target = error.target;
      if (target === null) return "target is null";
      if (typeof target.resolvedPath !== "string" || target.resolvedPath === "") {
        return "target.resolvedPath missing";
      }
      if (typeof target.displayPath !== "string" || target.displayPath === "") {
        return "target.displayPath missing";
      }
      return null;
    });
  }

  if (fixtures.refusedPath !== undefined) {
    const refusedPath = fixtures.refusedPath;
    await check("refused path returns a policy reason", async () => {
      const opened = await fs.open(refusedPath, {});
      if (opened.ok) {
        await opened.file.close();
        return "a refused path opened successfully";
      }
      return POLICY_REASONS.includes(opened.error.reason)
        ? null
        : `reason was ${opened.error.reason}`;
    });
  }

  await check("an aborted signal is refused", async () => {
    const controller = new AbortController();
    controller.abort();
    const opened = await fs.open(fixtures.existingFile.path, { signal: controller.signal });
    if (opened.ok) {
      await opened.file.close();
      return "an aborted open returned a handle";
    }
    return opened.error.reason === "aborted" ? null : `reason was ${opened.error.reason}`;
  });

  if (fs.list !== undefined && fixtures.listDirectory !== undefined) {
    const list = fs.list.bind(fs);
    const listDirectory = fixtures.listDirectory;
    await check("list() is bounded and returns names", async () => {
      const listed = await list(listDirectory, { limit: 1 });
      if (!listed.ok) return `list failed with ${listed.error.reason}`;
      if (listed.entries.length > 1) return "list ignored its limit";
      if (listed.entries.some((entry) => entry.name.includes("/"))) {
        return "list returned paths rather than names";
      }
      return null;
    });
  }

  return { adapter: fs.id, passed: checks.every((entry) => entry.ok), checks };
}

/** A check returns null on success, else a problem. A throw counts as a failure. */
export function checkRunner(): {
  readonly checks: ConformanceCheck[];
  readonly check: (name: string, run: () => Promise<string | null>) => Promise<void>;
} {
  const checks: ConformanceCheck[] = [];
  const check = async (name: string, run: () => Promise<string | null>): Promise<void> => {
    try {
      const detail = await run();
      checks.push(detail === null ? { name, ok: true } : { name, ok: false, detail });
    } catch (error) {
      checks.push({
        name,
        ok: false,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  };
  return { checks, check };
}

export function shapeProblem(fs: FileSystem): string | null {
  if (typeof fs.id !== "string" || fs.id === "") return "id must be a non-empty string";
  if (typeof fs.open !== "function") return "open must be a function";
  if (fs.list !== undefined && typeof fs.list !== "function") {
    return "list must be a function when present";
  }
  if (typeof fs.capabilities.streaming !== "boolean") return "capabilities.streaming missing";
  if (typeof fs.capabilities.identity !== "boolean") return "capabilities.identity missing";
  return null;
}

export function concat(chunks: readonly Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return joined;
}

export function equal(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  return left.every((byte, index) => byte === right[index]);
}
