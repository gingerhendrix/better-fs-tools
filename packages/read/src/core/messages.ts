import type { NodeKind } from "@better-fs-tools/fs";

import type { MessageCatalog } from "../contract/messages.ts";
import type { TruncationReason } from "../contract/result.ts";

/**
 * Wording for every note the core owns. No message names a parameter: text
 * that suggests a retry prints the `retry` string, which `retry(next)` built.
 */
const catalog: MessageCatalog = {
  retry: (next) => JSON.stringify(next),
  continuation: ({ retry, reason }) =>
    `Output stopped at the ${reasonLabel(reason)}. Continue with ${retry}.`,
  firstLineTooLong: ({ line, maxViewBytes, retry }) =>
    `Line ${line} cannot be shown within the ${maxViewBytes}-byte view limit. To skip it, continue with ${retry}.`,
  offsetPastEof: ({ request, totalLines, retry }) =>
    `Line ${request.offset} is past EOF; the file has ${totalLines} logical line${totalLines === 1 ? "" : "s"}. To read the last line, retry with ${retry}.`,
  offsetUnreached: ({ request, reachedLine, retry }) =>
    `Scanning stopped before line ${request.offset} was reached. Retry from line ${reachedLine} with ${retry}.`,
  lineClamped: ({ lines, total, maxChars }) =>
    `Source line${total === 1 ? "" : "s"} ${lines.join(", ")}${total > lines.length ? ", …" : ""} exceeded ${maxChars} characters and ${total === 1 ? "was" : "were"} clamped.`,
  scanLimit: ({ maxScanBytes }) =>
    `Scanning stopped at ${maxScanBytes} bytes; total lines and raw content identity are unknown.`,
  empty: ({ path }) => `${path} is empty (0 bytes); no retry is needed.`,
  notFound: ({ request, suggestions }) =>
    suggestions.length === 0
      ? `${request.path} was not found.`
      : `${request.path} was not found. Nearby names: ${quoted(suggestions)}.`,
  pathRepaired: ({ from, to }) =>
    `The requested filename ${JSON.stringify(from)} was repaired to the unique Unicode-equivalent path ${JSON.stringify(to)}.`,
  notAFile: ({ request, kind }) =>
    `${request.path} is a ${kindLabel(kind)}; directories, FIFOs, sockets, and devices are refused before any content read.`,
  dangerousPath: ({ request, detail }) =>
    `${request.path} belongs to a refused policy class${detail === null ? "" : ` (${detail})`}.`,
  outsideAllowedRoots: ({ request }) => `${request.path} is outside every configured allowed root.`,
  permissionDenied: ({ request }) => `Permission was denied for ${request.path}.`,
  denied: ({ path, detail }) =>
    `${path} was refused by policy${detail === null ? "" : ` (${detail})`}.`,
  tooLarge: ({ request, stage, limit }) =>
    stage === "convert"
      ? `${request.path} is larger than the ${limit}-byte conversion limit, so it was not converted.`
      : `The media converted from ${request.path} is larger than the ${limit}-byte media limit, so it was not returned.`,
  changedDuringRead: ({ request, retry }) =>
    `${request.path} changed while it was being read. Read it again with ${retry} before relying on this result.`,
  aborted: ({ phase }) =>
    `The read was aborted during the ${phase} phase; no observation was recorded.`,
  invalidInput: ({ detail }) => `The read input was rejected: ${detail}`,
  extensionFailed: ({ request, extension, phase }) =>
    `The ${extension} extension failed during the ${phase} phase while reading ${request.path}; this is a host problem rather than a property of the file.`,
  ioError: ({ request }) =>
    `The backend failed while reading ${request === null ? "the requested path" : request.path}.`,
  unsupportedBackend: ({ request, detail }) =>
    `No classifier had an opinion about ${request.path}${detail === null ? "" : ` (${detail})`}; this is a configuration problem rather than a property of the file.`,
  viewModified: ({ hook }) =>
    `The ${hook} hook changed this view, so it is not the exact file text.`,
  weakIdentity: ({ backend }) =>
    `The ${backend} backend has no stable identity, so this observation cannot back a write precondition.`,
  bufferedBackend: ({ backend }) =>
    `The ${backend} backend buffers whole objects instead of streaming them.`,
};

export const defaultMessages: Readonly<MessageCatalog> = Object.freeze(catalog);

function quoted(values: readonly string[]): string {
  return values.map((value) => JSON.stringify(value)).join(", ");
}

function reasonLabel(reason: TruncationReason): string {
  if (reason === "lines") return "line limit";
  if (reason === "bytes") return "view-byte limit";
  if (reason === "budget") return "view budget";
  if (reason === "scan-limit") return "scan limit";
  return "line-length limit";
}

function kindLabel(kind: NodeKind): string {
  if (kind === "fifo") return "FIFO";
  if (kind === "other") return "non-regular file";
  return kind;
}

/** Merges key by key. Throws TypeError on an unknown key or a non-function value. */
export function resolveMessages(overrides: Partial<MessageCatalog> = {}): Readonly<MessageCatalog> {
  if (overrides === null || typeof overrides !== "object" || Array.isArray(overrides)) {
    throw new TypeError("messages must be an object");
  }
  const resolved: Record<string, unknown> = { ...defaultMessages };
  for (const [key, value] of Object.entries(overrides)) {
    if (!Object.hasOwn(defaultMessages, key)) throw new TypeError(`Unknown message: ${key}`);
    if (value === undefined) continue;
    if (typeof value !== "function") throw new TypeError(`messages.${key} must be a function`);
    resolved[key] = value;
  }
  return Object.freeze(resolved as unknown as MessageCatalog);
}
