import { afterAll } from "bun:test";

import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import type { JsonObject } from "@better-fs-tools/read";

import type { PiReadTool, PiReadToolResult } from "../src/index.ts";

/**
 * Call once at the top of each test file. Returns a function that makes a
 * temporary directory with the given files, and registers an afterAll in
 * that file that removes every directory it made. A single afterAll here
 * would run for the first test file that imports this module only, and
 * leave every other file's directories behind.
 */
export function fixtures(): (files?: Record<string, string | Uint8Array>) => Promise<string> {
  const roots: string[] = [];
  afterAll(async () => {
    for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
  });
  return async (files = {}) => {
    const root = await realpath(await mkdtemp(path.join(tmpdir(), "better-fs-tools-pi-")));
    roots.push(root);
    for (const [name, content] of Object.entries(files)) {
      const target = path.join(root, name);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, content);
    }
    return root;
  };
}

/** A Pi context. The adapter reads only `cwd`; the rest stays as Pi sent it. */
export function piContext(cwd: string): ExtensionContext {
  return { cwd } as ExtensionContext;
}

/** One Pi execution. `onUpdate` is unused by this adapter. */
export function execute(
  tool: PiReadTool,
  input: JsonObject,
  cwd: string,
  signal?: AbortSignal,
): Promise<PiReadToolResult> {
  return tool.execute("pi-read-call", input, signal, undefined, piContext(cwd));
}

export function textOf(result: PiReadToolResult): string {
  return result.content.map((part) => (part.type === "text" ? part.text : "")).join("\n");
}
