import type { Precondition } from "@better-fs-tools/fs";
import type { ReadRecord } from "@better-fs-tools/read";

import type { Codec, TextStyle } from "../contract/codec.ts";
import type { WriteToolName } from "../contract/context.ts";
import type { ChangeFragment, PlannedChange } from "../contract/extensions.ts";
import type { WriteLimits } from "../contract/limits.ts";
import type { MatchInfo, Snippet } from "../contract/result.ts";
import { unifiedDiff } from "./diff.ts";
import type { Loaded } from "./load.ts";
import { buildSnippets } from "./snippet.ts";

/** A target after stat: the paths every later stage names. */
export interface ResolvedTarget {
  readonly requestedPath: string;
  readonly resolvedPath: string;
  readonly displayPath: string;
}

/** One planned file change and what the core needs to encode and commit it. */
export interface Planned {
  readonly change: PlannedChange;
  readonly diffTruncated: boolean;
  readonly target: ResolvedTarget;
  /** null for a create. */
  readonly loaded: Loaded | null;
  readonly codec: Codec;
  readonly style: TextStyle;
  readonly precondition: Precondition;
  readonly createParents: boolean;
  /** The record the precondition stage read. null when none. */
  readonly record: ReadRecord | null;
  readonly userModified: boolean;
  /** An edit that went ahead on a stale record (W4). The record then marks the file as not wholly seen. */
  readonly rematched: boolean;
  /** One entry for each matched edit pair. Empty for write. */
  readonly matches: readonly MatchInfo[];
  /** Result lines around each change. Empty for write. */
  readonly snippets: readonly Snippet[];
}

/**
 * The PlannedChange for a create or update with `after` as the new text in
 * the codec's text space. The diff runs on decoded text. With `movedFrom`,
 * it is a move: `loaded` is the source and `target` the destination.
 */
export function plannedChange(
  tool: WriteToolName,
  target: ResolvedTarget,
  loaded: Loaded | null,
  after: string,
  style: TextStyle,
  fragments: readonly ChangeFragment[],
  maxDiffLines: number,
  movedFrom: ResolvedTarget | null = null,
): {
  readonly change: PlannedChange;
  readonly diffTruncated: boolean;
  readonly changed: readonly (readonly [number, number])[];
} {
  const diff = unifiedDiff(
    loaded?.text ?? null,
    after,
    target.displayPath,
    maxDiffLines,
    movedFrom?.displayPath,
  );
  const change: PlannedChange = {
    tool,
    kind: movedFrom !== null ? "move" : loaded === null ? "create" : "update",
    requestedPath: target.requestedPath,
    resolvedPath: target.resolvedPath,
    displayPath: target.displayPath,
    movedFrom: movedFrom?.resolvedPath ?? null,
    before:
      loaded === null
        ? null
        : {
            text: loaded.text,
            style: loaded.style,
            contentId: loaded.contentId,
            version: loaded.version,
          },
    after: { text: after, style, contentId: null, version: null },
    fragments,
    linesAdded: diff.linesAdded,
    linesRemoved: diff.linesRemoved,
    diff: diff.text,
  };
  return { change, diffTruncated: diff.truncated, changed: diff.changed };
}

/** New text into the file's text space: a "crlf" file holds LF text until encode. */
export function toTextSpace(text: string, style: TextStyle): string {
  return style.eol === "crlf" ? text.replaceAll("\r\n", "\n") : text;
}

/**
 * W6: the authorizer's content replaces the planned after-text. The core
 * re-diffs, and for edit re-snippets around the changed lines of the new
 * diff. Fragments become one whole-file fragment.
 */
export function withContent(
  planned: Planned,
  content: string,
  limits: Readonly<WriteLimits>,
): Planned {
  const text = toTextSpace(content, planned.style);
  const { change, diffTruncated, changed } = plannedChange(
    planned.change.tool,
    planned.target,
    planned.loaded,
    text,
    planned.style,
    [{ oldText: planned.loaded?.text ?? "", newText: text }],
    limits.maxDiffLines,
  );
  const snippets = change.tool === "edit" ? buildSnippets(text, changed, limits) : [];
  return { ...planned, change, diffTruncated, userModified: true, snippets };
}
