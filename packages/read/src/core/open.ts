import type { FileSystem, OpenFile, OpenFileInfo } from "@better-fs-tools/fs";

import type { ReadRequest } from "../contract/input.ts";
import type { MessageCatalog } from "../contract/messages.ts";
import type { FileInfo } from "../contract/result.ts";
import type { CallScope } from "./call-scope.ts";
import { ReadStop, fromFileSystemError } from "./outcomes.ts";

/** One fs.open() for each read. A refusal, including a plain not-found, ends the read. */
export async function openFile<THost>(
  fs: FileSystem,
  request: ReadRequest,
  scope: CallScope<THost>,
  messages: Readonly<MessageCatalog>,
): Promise<OpenFile> {
  const signal = scope.signal;
  const opened = await fs.open(request.path, signal === undefined ? {} : { signal });
  if (!opened.ok) {
    throw new ReadStop(fromFileSystemError(messages, request, opened.error, scope.phase));
  }
  return opened.file;
}

export function fileInfo(fs: FileSystem, request: ReadRequest, info: OpenFileInfo): FileInfo {
  return {
    requestedPath: request.path,
    resolvedPath: info.resolvedPath,
    displayPath: info.displayPath,
    backend: fs.id,
    size: info.size,
    mtimeMs: info.mtimeMs,
    identity: fs.capabilities.identity ? info.identity : null,
    mimeType: info.mimeType,
    resolvedFrom: null,
  };
}
