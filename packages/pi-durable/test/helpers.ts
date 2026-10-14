import { afterAll } from "bun:test";

import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";

export const context = BACKGROUND_CONTEXT;

// Call once per test file: a module-level afterAll would clean up after the first importing file only.
export function fixtures(): (files?: Record<string, string | Uint8Array>) => Promise<string> {
  const roots: string[] = [];
  afterAll(async () => {
    for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
  });
  return async (files = {}) => {
    const root = await realpath(await mkdtemp(path.join(tmpdir(), "better-fs-tools-pi-durable-")));
    roots.push(root);
    for (const [name, content] of Object.entries(files)) {
      const target = path.join(root, name);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, content);
    }
    return root;
  };
}

export function localEnv(cwd: string): NodeExecutionEnv {
  return new NodeExecutionEnv({ cwd });
}
