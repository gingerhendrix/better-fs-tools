import { describe, expect, test } from "bun:test";

import { readFile } from "node:fs/promises";

import {
  createPiApplyPatchTool,
  createPiBashTool,
  createPiEditTool,
  createPiReadTool,
  createPiWriteTool,
} from "../src/index.ts";
import { execute, fixtures, piContext, run } from "./helpers.ts";
import { piCwdCommandRunner, piCwdFileSystem } from "../src/node.ts";
import { shellEnv } from "@better-fs-tools/shell";

const fixture = fixtures();

const PNG = new Uint8Array(
  await readFile(new URL("../../read/test/fixtures/files/pixel.png", import.meta.url)),
);

describe("output schemas", () => {
  test("no tool declares an output schema, as in every integration", () => {
    for (const tool of [
      createPiReadTool({ fs: piCwdFileSystem() }),
      createPiEditTool({ fs: piCwdFileSystem() }),
      createPiWriteTool({ fs: piCwdFileSystem() }),
      createPiApplyPatchTool({ fs: piCwdFileSystem() }),
      createPiBashTool({ runner: piCwdCommandRunner(), env: shellEnv(() => process.env) }),
    ]) {
      expect(Object.hasOwn(tool, "outputSchema")).toBe(false);
    }
  });
});

describe("Pi 1.x annotations", () => {
  test("read is read-only; the change tools are destructive; only write is idempotent", () => {
    expect(createPiReadTool({ fs: piCwdFileSystem() }).annotations).toEqual({ readOnlyHint: true });
    const patch = {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    };
    expect(createPiEditTool({ fs: piCwdFileSystem() }).annotations).toEqual(patch);
    expect(createPiApplyPatchTool({ fs: piCwdFileSystem() }).annotations).toEqual(patch);
    expect(createPiWriteTool({ fs: piCwdFileSystem() }).annotations).toEqual({
      ...patch,
      idempotentHint: true,
    });
    expect(
      Object.hasOwn(
        createPiBashTool({ runner: piCwdCommandRunner(), env: shellEnv(() => process.env) }),
        "annotations",
      ),
    ).toBe(false);
  });
});

describe("Pi 1.x read results", () => {
  test("a text read sets isError false and gives no structured content", async () => {
    const cwd = await fixture({ "a.txt": "alpha\n" });
    const result = await execute(
      createPiReadTool({ fs: piCwdFileSystem() }),
      { path: "a.txt" },
      cwd,
    );
    expect(result.isError).toBe(false);
    expect(Object.hasOwn(result, "structuredContent")).toBe(false);
    expect(result.content[0]).toMatchObject({ type: "text", text: "1|alpha" });
  });

  test("an image read gives a Pi image part", async () => {
    const cwd = await fixture({ "a.png": PNG });
    const result = await execute(
      createPiReadTool({ fs: piCwdFileSystem() }),
      { path: "a.png" },
      cwd,
    );
    expect(result.isError).toBe(false);
    expect(result.content).toContainEqual({
      type: "image",
      data: Buffer.from(PNG).toString("base64"),
      mimeType: "image/png",
    });
  });

  test("an unsupported file is not an error", async () => {
    const cwd = await fixture({ "a.bin": new Uint8Array([0, 1, 2, 0, 255]) });
    const result = await execute(
      createPiReadTool({ fs: piCwdFileSystem() }),
      { path: "a.bin" },
      cwd,
    );
    expect(result.isError).toBe(false);
    expect(result.content[0]).toMatchObject({ text: expect.stringMatching(/^\[read:/u) });
  });

  test("a failed read sets isError", async () => {
    const cwd = await fixture();
    const result = await execute(
      createPiReadTool({ fs: piCwdFileSystem() }),
      { path: "missing.txt" },
      cwd,
    );
    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({
      text: expect.stringMatching(/^\[read:not-found\]/u),
    });
  });
});

describe("Pi 1.x change results", () => {
  test("a change sets isError false; a failed change sets isError true", async () => {
    const cwd = await fixture({ "a.txt": "one\n" });
    const edit = createPiEditTool({ fs: piCwdFileSystem() });
    const ok = await run(edit, { path: "a.txt", old_string: "one", new_string: "two" }, cwd);
    expect(ok.isError).toBe(false);
    const failed = await run(edit, { path: "a.txt", old_string: "x", new_string: "y" }, cwd);
    expect(failed.isError).toBe(true);
    expect(failed.details).toBeUndefined();

    const write = createPiWriteTool({ fs: piCwdFileSystem() });
    expect((await run(write, { path: "b.txt", content: "b\n" }, cwd)).isError).toBe(false);
    expect((await run(write, { path: "../out.txt", content: "x\n" }, cwd)).isError).toBe(true);
  });
});

describe("Pi 1.x bash results", () => {
  const bash = (command: string, extra: Record<string, number> = {}) =>
    fixture().then((cwd) =>
      createPiBashTool({
        runner: piCwdCommandRunner(),
        env: shellEnv(() => process.env),
        limits: { killGraceMs: 100 },
      }).execute("b1", { command, ...extra }, undefined, undefined, piContext(cwd)),
    );

  test("exit 0 sets isError false and gives no structured content", async () => {
    const result = await bash("printf hi");
    expect(result.isError).toBe(false);
    expect(Object.hasOwn(result, "structuredContent")).toBe(false);
  });

  test("a nonzero exit and a timeout set isError", async () => {
    expect((await bash("echo out; exit 3")).isError).toBe(true);
    expect((await bash("sleep 5", { timeout: 200 })).isError).toBe(true);
  });
});
