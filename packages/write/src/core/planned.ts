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

export interface ResolvedTarget {
  readonly requestedPath: string;
  readonly resolvedPath: string;
  readonly displayPath: string;
}

export interface Planned {
  readonly change: PlannedChange;
  readonly diffTruncated: boolean;
  readonly target: ResolvedTarget;
  readonly loaded: Loaded | null;
  readonly codec: Codec;
  readonly style: TextStyle;
  readonly precondition: Precondition;
  readonly createParents: boolean;
  readonly record: ReadRecord | null;
  readonly userModified: boolean;
  readonly rematchedAfterStale: boolean;
  readonly matches: readonly MatchInfo[];
  readonly snippets: readonly Snippet[];
}

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

export function toTextSpace(text: string, style: TextStyle): string {
  return style.eol === "crlf" ? text.replaceAll("\r\n", "\n") : text;
}

export function withAuthorizerContent(
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
