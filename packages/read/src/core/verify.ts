import type { OpenFile } from "@better-fs-tools/fs";

import type { ReadRequest } from "../contract/input.ts";
import type { ReadMessageCatalog } from "../contract/messages.ts";
import type { FileInfo } from "../contract/result.ts";
import type { CallScope } from "./call-scope.ts";
import { ReadStop, changedDuringRead, fromFileSystemError } from "./outcomes.ts";

export function checkSize(
  messages: Readonly<ReadMessageCatalog>,
  request: ReadRequest,
  file: FileInfo,
  consumed: number,
): void {
  if (file.size !== null && consumed !== file.size) {
    throw new ReadStop(changedDuringRead(messages, request, file));
  }
}

export async function verifyHandle<THost>(
  handle: OpenFile,
  messages: Readonly<ReadMessageCatalog>,
  request: ReadRequest,
  file: FileInfo,
  scope: CallScope<THost>,
): Promise<void> {
  const verified = await handle.verify();
  if (!verified.ok) {
    throw new ReadStop(fromFileSystemError(messages, request, verified.error, scope.phase, file));
  }
  if (verified.changed) throw new ReadStop(changedDuringRead(messages, request, file));
  scope.checkAbort();
}
