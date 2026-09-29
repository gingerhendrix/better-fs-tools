import type { JsonObject } from "@better-fs-tools/read";

import type { GuardContext, GuardDecision, PlannedChange } from "../contract/extensions.ts";

export const ALLOW: GuardDecision = Object.freeze({ allow: true });

export function refuse(code: string, message: string, data?: JsonObject): GuardDecision {
  return {
    allow: false,
    note: { code, severity: "warning", message, ...(data === undefined ? {} : { data }) },
  };
}

export function linesOf(text: string): string[] {
  return text.split("\n").map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line));
}

export function newTextParam(change: PlannedChange, ctx: GuardContext<unknown>): string {
  if (change.tool === "edit") return ctx.messages.param("newText");
  if (change.tool === "apply_patch") return ctx.messages.param("patch");
  return ctx.messages.param("content");
}

export function withoutStatefulFlags(pattern: RegExp): RegExp {
  return new RegExp(pattern.source, pattern.flags.replace(/[gy]/gu, ""));
}

export function regExpList(value: unknown, name: string): readonly RegExp[] {
  if (!Array.isArray(value) || !value.every((entry) => entry instanceof RegExp)) {
    throw new TypeError(`${name} must be an array of regular expressions`);
  }
  return Object.freeze(value.map(withoutStatefulFlags));
}

export function extensionOf(path: string): string | null {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const index = name.lastIndexOf(".");
  if (index <= 0 || index === name.length - 1) return null;
  return name.slice(index + 1).toLowerCase();
}

export function quoted(line: string): string {
  const trimmed = line.trim();
  return trimmed.length > 80 ? `${trimmed.slice(0, 80)}…` : trimmed;
}

export function existingLines(change: PlannedChange): (line: string) => boolean {
  let lines: Set<string> | null = null;
  return (line) => {
    if (change.before === null) return false;
    lines ??= new Set(linesOf(change.before.text));
    return lines.has(line);
  };
}
