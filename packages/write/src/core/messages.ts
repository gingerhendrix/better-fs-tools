import type { NodeKind } from "@better-fs-tools/fs";

import type { WriteCanonicalParam, WriteMessageCatalog } from "../contract/messages.ts";

type Param = (name: WriteCanonicalParam) => string;

function catalogUsingParam(param: Param): WriteMessageCatalog {
  return {
    param,
    pathRepaired: ({ from, to }) =>
      `The requested filename ${JSON.stringify(from)} was repaired to the unique Unicode-equivalent path ${JSON.stringify(to)}.`,
    denied: ({ path, detail }) =>
      `${path} was refused by policy${detail === null ? "" : ` (${detail})`}.`,

    invalidInput: ({ tool, detail }) => `The ${tool} input was rejected: ${detail}`,
    notFound: ({ tool, path }) => {
      if (tool === "edit") return `${path} does not exist. Use the write tool to create it.`;
      if (tool === "apply_patch") return `${path} does not exist. Use *** Add File to create it.`;
      return `${path} was not found. Check the path and its parent directories.`;
    },
    notAFile: ({ path, kind }) =>
      `${path} is a ${kindLabel(kind)}. Only regular files can be changed.`,
    dangerousPath: ({ path, detail }) =>
      `${path} is refused by policy${detail === null ? "" : ` (${detail})`}. Choose another path.`,
    outsideAllowedRoots: ({ path }) =>
      `${path} is outside every configured allowed root. Choose a path inside the workspace.`,
    permissionDenied: ({ path }) => `Permission was denied for ${path}.`,
    guardRefused: ({ guard, path }) => `The ${guard} check refused the change to ${path}.`,
    readOnly: ({ path }) => `${path} is on a read-only filesystem, so it cannot be changed.`,
    noSpace: ({ path }) => `There is no space left to write ${path}.`,
    unsupportedBackend: ({ path, detail }) =>
      `The backend cannot change ${path}${detail === null ? "" : ` (${detail})`}; this is a configuration problem rather than a property of the file.`,
    ioError: ({ path }) =>
      `The backend failed while changing ${path ?? "the requested path"}. Retry, or read the file to check its state.`,
    aborted: ({ phase }) => `The call was aborted during the ${phase} phase. No file was changed.`,
    extensionFailed: ({ path, extension, phase }) =>
      `The ${extension} extension failed during the ${phase} phase${path === null ? "" : ` while changing ${path}`}; this is a host problem rather than a property of the file.`,
    lockTimeout: ({ paths }) =>
      `Another change to ${paths.join(", ")} is still running. Retry when it has finished.`,

    notRead: ({ path, wholeFile }) =>
      wholeFile
        ? `Read all of ${path} before replacing it. A partial read is not enough for write.`
        : `Read ${path} with the read tool before changing it.`,
    stale: ({ path }) => `${path} changed since it was last read. Read it again, then retry.`,
    staleRematched: ({ path }) =>
      `${path} changed since it was last read, but every old text still matched exactly once, so the edit was applied.`,
    tooLarge: ({ path, what, limit, existing }) => {
      if (what === "patch") {
        return `The patch is over the limit of ${limit}. Split it into smaller patches.`;
      }
      if (what === "file") {
        return `${path ?? "The file"} is larger than the ${limit}-byte limit, so it cannot be changed with this tool.`;
      }
      return existing
        ? `The new content for ${path} is larger than the ${limit}-byte write limit. Change the file in smaller steps with the edit tool.`
        : `The new content for ${path} is larger than the ${limit}-byte write limit. Write a smaller file.`;
    },
    notText: ({ path, code }) => {
      if (code === "ROUND_TRIP") {
        return `${path} does not decode and encode back to the same bytes, so it cannot be changed safely as text.`;
      }
      if (code === "UNKNOWN_ENCODING") {
        return `${path} is not in an encoding this tool can decode, so it cannot be changed as text.`;
      }
      return `${path} is not a text file (${code}), so it cannot be changed with this tool.`;
    },
    exists: ({ tool, path }) =>
      tool === "apply_patch"
        ? `${path} already exists. Use *** Update File, or the write tool to replace it.`
        : `${path} was created while this call ran. Read it, then retry.`,

    noMatch: ({ path, index, closest, trailingNewline }) => {
      const lines = [`Edit ${index + 1}: the ${param("oldText")} was not found in ${path}.`];
      if (trailingNewline !== null) lines.push("It differs only by a trailing newline.");
      if (closest !== null) lines.push("The closest region is:", closest);
      return lines.join("\n");
    },
    ambiguousMatch: ({ path, index, lines, total }) =>
      `Edit ${index + 1}: the ${param("oldText")} matches ${total} places in ${path} (lines ${lines.join(", ")}${total > lines.length ? ", …" : ""}). Add surrounding lines to make it unique${param("replaceAll") === "" ? "" : `, or set ${param("replaceAll")}`}.`,
    matchRefused: ({ path, index, matcher, reason }) => {
      const found = `Edit ${index + 1}: the ${matcher} matcher found the ${param("oldText")} in ${path}, but the match was refused (${refusalLabel(reason)}).`;
      if (reason === "too-many") {
        return `${found} Change fewer places in each edit, or replace the file with the write tool.`;
      }
      return `${found} Copy the ${param("oldText")} exactly from the file.`;
    },
    overlap: ({ path, first, second }) =>
      `Edits ${first + 1} and ${second + 1} change overlapping text in ${path}. Merge them into one edit.`,
    noChange: ({ path }) =>
      `The edits leave ${path} as it is. Check the ${param("newText")} values, or do not send the edit.`,
    alreadyApplied: ({ path, index }) =>
      `Edit ${index + 1} is already applied: the ${param("newText")} is in ${path} and the ${param("oldText")} is not. Do not send this edit again.`,
    fuzzyMatch: ({ path, index, matcher, lines }) =>
      `Edit ${index + 1} matched ${path} at lines ${lines[0]}-${lines[1]} only with the ${matcher} matcher, not exactly. Check the result.`,
    repeatedMiss: ({ path, misses }) =>
      `This is miss ${misses} in a row on ${path}. Read the file again, include more surrounding lines, or replace the file with the write tool.`,

    patchParse: ({ line, detail }) => `The patch could not be parsed at line ${line}: ${detail}`,
    patchVerifyHeader: () => "Patch validation failed (no files were modified):",
    patchDuplicateTarget: ({ path }) => `${path}: multiple operations target this file.`,
    patchNotFound: ({ path, operation }) =>
      operation === "update"
        ? `${path} does not exist. Use *** Add File to create it.`
        : `${path} does not exist, so it cannot be deleted.`,
    patchMoveExists: ({ path, from }) =>
      `${path} already exists, so ${from} cannot move there. Choose another path, or delete ${path} first.`,
    patchContextNotFound: ({ path, hunk, context }) =>
      `${path}: hunk ${hunk}: failed to find the context line ${JSON.stringify(context)}.`,
    patchLinesNotFound: ({ path, hunk, lines }) =>
      [
        `${path}: hunk ${hunk}: failed to find the expected lines:`,
        ...lines.map((line) => `    ${line}`),
      ].join("\n"),
    patchFuzzyMatch: ({ path, hunk, matcher, lines }) =>
      `Hunk ${hunk} matched ${path} at lines ${lines[0]}-${lines[1]} only with the ${matcher} matcher, not exactly. Check the result.`,
    patchCommitFailed: ({ path, code, rolledBack, files }) =>
      rolledBack
        ? `Patch commit failed at ${path} (${code}). The patch was rolled back. No files are changed.`
        : [
            `Patch commit failed at ${path} (${code}). Rollback failed, so these files are in a mixed state:`,
            ...files.map((file) => `${file.state} ${file.path}`),
          ].join("\n"),

    userModified: ({ path }) =>
      `The user changed the content before it was written to ${path}. The file holds their version. Read it before changing it again.`,
    hookRewrote: ({ hook, path }) =>
      `The ${hook} hook rewrote ${path} after the write. Read it again before relying on its text.`,
  };
}

function kindLabel(kind: NodeKind): string {
  if (kind === "fifo") return "FIFO";
  if (kind === "other") return "non-regular file";
  return kind;
}

function refusalLabel(
  reason: "span" | "boundary" | "escape" | "fuzzy-replace-all" | "too-many",
): string {
  if (reason === "span") return "the matched region is much longer than the text sent";
  if (reason === "boundary") return "the match starts or ends inside normalized text";
  if (reason === "escape") return "the new text holds escape sequences the file does not";
  if (reason === "too-many") return "it matches more places than one edit may replace";
  return "a loose match cannot replace every occurrence";
}

const canonical: Param = (name) => name;

export const defaultWriteMessages: Readonly<WriteMessageCatalog> = Object.freeze(
  catalogUsingParam(canonical),
);

/**
 * Merges message overrides onto the defaults key by key. Throws TypeError on
 * an unknown key or a non-function value. A `param` override applies to every
 * default message.
 */
export function resolveWriteMessages(
  overrides: Partial<WriteMessageCatalog> = {},
): Readonly<WriteMessageCatalog> {
  if (overrides === null || typeof overrides !== "object" || Array.isArray(overrides)) {
    throw new TypeError("messages must be an object");
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (!Object.hasOwn(defaultWriteMessages, key)) throw new TypeError(`Unknown message: ${key}`);
    if (value !== undefined && typeof value !== "function") {
      throw new TypeError(`messages.${key} must be a function`);
    }
  }
  const resolved: Record<string, unknown> = { ...catalogUsingParam(overrides.param ?? canonical) };
  for (const [key, value] of Object.entries(overrides)) {
    if (value !== undefined) resolved[key] = value;
  }
  return Object.freeze(resolved as unknown as WriteMessageCatalog);
}
