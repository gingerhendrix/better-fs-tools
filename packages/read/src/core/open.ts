import type { FileSystem, OpenFile, OpenFileInfo } from "@better-fs-tools/fs";

import type { Dependencies } from "../contract/deps.ts";
import type { ReadRequest } from "../contract/input.ts";
import type { FileInfo } from "../contract/result.ts";
import type { CallScope } from "./call-scope.ts";
import { ReadStop, fromFileSystemError } from "./outcomes.ts";
import { missOutcome } from "./suggest.ts";

/**
 * One fs.open() for each read, on the resolved path. A refusal ends the read. A
 * not-found refusal goes to suggest, which lists but never opens.
 */
export async function openFile<THost>(
  deps: Dependencies<THost>,
  fs: FileSystem,
  request: ReadRequest,
  path: string,
  scope: CallScope<THost>,
): Promise<OpenFile> {
  const signal = scope.signal;
  const opened = await fs.open(path, signal === undefined ? {} : { signal });
  if (opened.ok) return opened.file;
  if (opened.error.reason === "not-found") {
    throw new ReadStop(await missOutcome(deps, request, fs, scope, path, opened.error));
  }
  throw new ReadStop(fromFileSystemError(deps.messages, request, opened.error, scope.phase));
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
  };
}
