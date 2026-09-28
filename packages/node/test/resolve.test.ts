import { afterAll, describe, expect, test } from "bun:test";

import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expandHome, pathResolvers, textOf, unicodeRepair } from "@better-fs-tools/read";

import { createNodeReadTool, nodeFileSystem } from "../src/index.ts";

const root = await realpath(await mkdtemp(join(tmpdir(), "better-fs-tools-resolve-")));
const outside = await realpath(await mkdtemp(join(tmpdir(), "better-fs-tools-resolve-outside-")));

await mkdir(join(root, "src"), { recursive: true });
await writeFile(join(root, "src", "index.ts"), "const a = 1;\n");
await writeFile(join(root, "report 2026.txt"), "q1\n");
await writeFile(join(outside, "secret.txt"), "secret\n");

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
});

function toolWithHome(home: string) {
  return createNodeReadTool({
    fs: nodeFileSystem({ cwd: root, allowedRoots: [root] }),
    resolve: expandHome({ home }),
  });
}

describe("resolvers on the node filesystem", () => {
  test("~ inside the allowed roots opens", async () => {
    const result = await toolWithHome(root)({ path: "~/src/index.ts" });
    if (result.status !== "ok") throw new Error(`expected ok, got ${result.status}`);
    expect(textOf(result)).toBe("1|const a = 1;");
    expect(result.file.requestedPath).toBe("~/src/index.ts");
    expect(result.file.resolvedPath).toBe(join(root, "src", "index.ts"));
    expect(result.file.resolvedFrom).toBe("~/src/index.ts");
  });

  test("~ outside the allowed roots gives OUTSIDE_ALLOWED_ROOTS", async () => {
    const result = await toolWithHome(outside)({ path: "~/secret.txt" });
    if (result.status !== "error") throw new Error(`expected error, got ${result.status}`);
    expect(result.error.code).toBe("OUTSIDE_ALLOWED_ROOTS");
    expect(textOf(result)).not.toContain("secret\n");
  });

  test("unicodeRepair lists through the node adapter and opens the real name", async () => {
    const read = createNodeReadTool({
      fs: nodeFileSystem({ cwd: root, allowedRoots: [root] }),
      resolve: pathResolvers(expandHome({ home: root }), unicodeRepair()),
    });
    const result = await read({ path: "~/report 2026.txt" });
    if (result.status !== "ok") throw new Error(`expected ok, got ${result.status}`);
    expect(result.file.resolvedPath).toBe(join(root, "report 2026.txt"));
    expect(result.notes.map((note) => note.code)).toEqual(["path-repaired"]);
  });

  test("a U+202F miss with no resolver suggests the real name", async () => {
    const read = createNodeReadTool({ fs: nodeFileSystem({ cwd: root, allowedRoots: [root] }) });
    const result = await read({ path: "report 2026.txt" });
    if (result.status !== "error") throw new Error(`expected error, got ${result.status}`);
    expect(result.error.code).toBe("NOT_FOUND");
    expect(result.notes[0]?.data?.suggestions).toEqual(["report 2026.txt"]);
  });
});
