import { defaultClassifiers } from "@better-fs-tools/read";

import type {
  ChangeFragment,
  GuardContext,
  GuardDecision,
  PlannedChange,
  WriteToolName,
} from "../../src/index.ts";
import { defaultWriteLimits, defaultWriteMessages } from "../../src/index.ts";

const STYLE = Object.freeze({ encoding: "utf-8", bom: false, eol: "keep" as const });

export interface ChangeOptions {
  readonly tool?: WriteToolName;
  readonly path?: string;
  /** null for a create. */
  readonly before?: string | null;
  readonly after: string;
  /** Default: one fragment from before to after. */
  readonly fragments?: readonly ChangeFragment[];
  readonly bom?: boolean;
  readonly eol?: "lf" | "crlf" | "keep";
}

export function change(options: ChangeOptions): PlannedChange {
  const { tool = "write", path = "/a.txt", before = null, after } = options;
  const style = { ...STYLE, bom: options.bom ?? false, eol: options.eol ?? "keep" };
  return {
    tool,
    kind: before === null ? "create" : "update",
    requestedPath: path,
    resolvedPath: path,
    displayPath: path,
    movedFrom: null,
    before: before === null ? null : { text: before, style, contentId: null, version: null },
    after: { text: after, style, contentId: null, version: null },
    fragments: options.fragments ?? [{ oldText: before ?? "", newText: after }],
    linesAdded: 0,
    linesRemoved: 0,
    diff: "",
  };
}

export function guardContext(tool: WriteToolName = "write"): GuardContext<unknown> {
  return {
    tool,
    request: { tool: "write", path: "/a.txt", content: "" },
    limits: defaultWriteLimits,
    messages: defaultWriteMessages,
    digest: null,
    clock: () => new Date(0),
    call: { host: undefined },
    classifiers: defaultClassifiers(),
  };
}

type Decided = GuardDecision | Promise<GuardDecision>;

export function decided(decision: Decided): GuardDecision {
  if (decision instanceof Promise) throw new Error("the built-in guards decide synchronously");
  return decision;
}

export function verdict(decision: Decided): string {
  const sync = decided(decision);
  return sync.allow ? "allow" : (sync.note?.code ?? "no note");
}

export function numbered(
  lines: readonly string[],
  gutter: (n: number) => string,
  first = 1,
): string {
  return lines.map((line, index) => `${gutter(first + index)}${line}`).join("\n");
}
