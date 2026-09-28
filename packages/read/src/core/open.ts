import type { FileSystem, NotAFileError, OpenFile, OpenFileInfo } from "@better-fs-tools/fs";

import type { ReadDependencies } from "../contract/deps.ts";
import type { DirectoryConverter } from "../contract/extensions.ts";
import type { ReadRequest } from "../contract/input.ts";
import type { FileInfo } from "../contract/result.ts";
import type { CallScope } from "./call-scope.ts";
import { directoryConverter } from "./directory.ts";
import { ReadStop, fromFileSystemError } from "./outcomes.ts";
import { missOutcome } from "./suggest.ts";

export type Opened<THost> =
  | { readonly kind: "file"; readonly handle: OpenFile }
  | {
      readonly kind: "directory";
      readonly error: NotAFileError;
      readonly converter: DirectoryConverter<THost>;
    };

/**
 * One fs.open() for each read, on the resolved path. A refusal ends the read. A
 * not-found refusal goes to suggest, which lists but never opens. A directory
 * goes to the directory converter when there is one and the backend can list.
 */
export async function openFile<THost>(
  deps: ReadDependencies<THost>,
  fs: FileSystem,
  request: ReadRequest,
  path: string,
  scope: CallScope<THost>,
): Promise<Opened<THost>> {
  const signal = scope.signal;
  const opened = await fs.open(path, signal === undefined ? {} : { signal });
  if (opened.ok) return { kind: "file", handle: opened.file };
  const { error } = opened;
  if (error.reason === "not-found") {
    throw new ReadStop(await missOutcome(deps, request, fs, scope, path, error));
  }
  if (error.reason === "not-a-file" && error.kind === "directory") {
    const converter = directoryConverter(scope, fs);
    if (converter !== null) return { kind: "directory", error, converter };
  }
  throw new ReadStop(fromFileSystemError(deps.messages, request, error, scope.phase));
}

export function fileInfo(
  fs: FileSystem,
  request: ReadRequest,
  info: OpenFileInfo,
  resolvedFrom: string | null,
): FileInfo {
  return {
    requestedPath: request.path,
    resolvedPath: info.resolvedPath,
    displayPath: info.displayPath,
    backend: fs.id,
    size: info.size,
    mtimeMs: info.mtimeMs,
    identity: fs.capabilities.identity ? info.identity : null,
    mimeType: info.mimeType,
    resolvedFrom,
    version: info.version ?? null,
  };
}
