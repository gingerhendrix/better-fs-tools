import type { JsonObject } from "@better-fs-tools/read";

import type { GuardContext, GuardDecision, PlannedChange } from "../contract/extensions.ts";

export const ALLOW: GuardDecision = Object.freeze({ allow: true });

/** A refusal note. The core names the guard and turns the code into GUARD_REFUSED. */
export function refuse(code: string, message: string, data?: JsonObject): GuardDecision {
  return {
    allow: false,
    note: { code, severity: "warning", message, ...(data === undefined ? {} : { data }) },
  };
}

/** Lines without their line break. A CR before the break is dropped. */
export function linesOf(text: string): string[] {
  return text.split("\n").map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line));
}

/** The host name of the parameter that carried the new text. */
export function newTextParam(change: PlannedChange, ctx: GuardContext<unknown>): string {
  if (change.tool === "edit") return ctx.messages.param("newText");
  if (change.tool === "apply_patch") return ctx.messages.param("patch");
  return ctx.messages.param("content");
}

/**
 * A copy of `pattern` without the "g" and "y" flags, so `test` keeps no
 * state between lines.
 */
export function lineTester(pattern: RegExp): RegExp {
  return new RegExp(pattern.source, pattern.flags.replace(/[gy]/gu, ""));
}

export function regExpList(value: unknown, name: string): readonly RegExp[] {
  if (!Array.isArray(value) || !value.every((entry) => entry instanceof RegExp)) {
    throw new TypeError(`${name} must be an array of regular expressions`);
  }
  return Object.freeze(value.map(lineTester));
}

/** Lowercase extension without the dot, or null. `.env` has none. */
export function extensionOf(path: string): string | null {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const index = name.lastIndexOf(".");
  if (index <= 0 || index === name.length - 1) return null;
  return name.slice(index + 1).toLowerCase();
}

/** A line for a message: trimmed and cut at 80 characters. */
export function quoted(line: string): string {
  const trimmed = line.trim();
  return trimmed.length > 80 ? `${trimmed.slice(0, 80)}…` : trimmed;
}

/**
 * Tells whether a line is already in the file. Builds the set of the
 * before text's lines on first use only, since most checks find no hit.
 */
export function existingLines(change: PlannedChange): (line: string) => boolean {
  let lines: Set<string> | null = null;
  return (line) => {
    if (change.before === null) return false;
    lines ??= new Set(linesOf(change.before.text));
    return lines.has(line);
  };
}
