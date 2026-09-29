import { afterAll } from "bun:test";

import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import type { JsonObject } from "@better-fs-tools/read";

import type {
  PiMutationTool,
  PiMutationToolResult,
  PiReadTool,
  PiReadToolResult,
} from "../src/index.ts";

// Call once per test file: a module-level afterAll would clean up after the first importing file only.
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

export function piContext(cwd: string): ExtensionContext {
  return { cwd } as ExtensionContext;
}

export function execute(
  tool: PiReadTool,
  input: JsonObject,
  cwd: string,
  signal?: AbortSignal,
): Promise<PiReadToolResult> {
  return tool.execute("pi-read-call", input, signal, undefined, piContext(cwd));
}

export function run(
  tool: PiMutationTool,
  input: JsonObject,
  cwd: string,
  signal?: AbortSignal,
): Promise<PiMutationToolResult> {
  return tool.execute(`pi-${tool.name}-call`, input, signal, undefined, piContext(cwd));
}

export function textOf(result: PiReadToolResult | PiMutationToolResult): string {
  return result.content.map((part) => (part.type === "text" ? part.text : "")).join("\n");
}
