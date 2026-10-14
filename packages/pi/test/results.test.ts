import { describe, expect, test } from "bun:test";

import { readFile } from "node:fs/promises";

import {
  createBashToolDefinition as createBuiltInPiBashTool,
  createReadToolDefinition as createBuiltInPiReadTool,
} from "@earendil-works/pi-coding-agent";

import {
  createPiApplyPatchTool,
  createPiBashTool,
  createPiEditTool,
  createPiReadTool,
  createPiWriteTool,
} from "../src/index.ts";
import { execute, fixtures, piContext, run } from "./helpers.ts";

const fixture = fixtures();

const PNG = new Uint8Array(
  await readFile(new URL("../../read/test/fixtures/files/pixel.png", import.meta.url)),
);

describe("Pi 1.x output schemas", () => {
  test("read and bash declare the output schemas of Pi's own read and bash", () => {
    const cwd = process.cwd();
    expect(createPiReadTool().outputSchema).toEqual(createBuiltInPiReadTool(cwd).outputSchema!);
    expect(createPiBashTool().outputSchema).toEqual(createBuiltInPiBashTool(cwd).outputSchema!);
  });

  test("edit, write, and apply_patch declare no output schema, as Pi's own edit and write", () => {
    for (const tool of [createPiEditTool(), createPiWriteTool(), createPiApplyPatchTool()]) {
      expect(Object.hasOwn(tool, "outputSchema")).toBe(false);
    }
  });
});

describe("Pi 1.x annotations", () => {
  test("read is read-only; the change tools are destructive; only write is idempotent", () => {
    expect(createPiReadTool().annotations).toEqual({ readOnlyHint: true });
    const patch = {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    };
    expect(createPiEditTool().annotations).toEqual(patch);
    expect(createPiApplyPatchTool().annotations).toEqual(patch);
    expect(createPiWriteTool().annotations).toEqual({ ...patch, idempotentHint: true });
    expect(Object.hasOwn(createPiBashTool(), "annotations")).toBe(false);
  });
});

describe("Pi 1.x read results", () => {
  test("a text read gives the text as structured content and isError false", async () => {
    const cwd = await fixture({ "a.txt": "alpha\n" });
    const result = await execute(createPiReadTool(), { path: "a.txt" }, cwd);
    expect(result.isError).toBe(false);
    expect(result.structuredContent).toBe("1|alpha");
  });

  test("an image read gives Pi's image output", async () => {
    const cwd = await fixture({ "a.png": PNG });
    const result = await execute(createPiReadTool(), { path: "a.png" }, cwd);
    expect(result.isError).toBe(false);
    expect(result.structuredContent).toEqual({
      type: "image",
      data: Buffer.from(PNG).toString("base64"),
      mimeType: "image/png",
      note: "",
    });
  });

  test("an unsupported file is not an error", async () => {
    const cwd = await fixture({ "a.bin": new Uint8Array([0, 1, 2, 0, 255]) });
    const result = await execute(createPiReadTool(), { path: "a.bin" }, cwd);
    expect(result.isError).toBe(false);
    expect(result.structuredContent).toStartWith("[read:");
  });

  test("a failed read sets isError and gives no structured content", async () => {
    const cwd = await fixture();
    const result = await execute(createPiReadTool(), { path: "missing.txt" }, cwd);
    expect(result.isError).toBe(true);
    expect(Object.hasOwn(result, "structuredContent")).toBe(false);
    expect(result.content[0]).toMatchObject({
      text: expect.stringMatching(/^\[read:not-found\]/u),
    });
  });
});

describe("Pi 1.x change results", () => {
  test("a change sets isError false; a failed change sets isError true", async () => {
    const cwd = await fixture({ "a.txt": "one\n" });
    const edit = createPiEditTool();
    const ok = await run(edit, { path: "a.txt", edits: [{ oldText: "one", newText: "two" }] }, cwd);
    expect(ok.isError).toBe(false);
    const failed = await run(edit, { path: "a.txt", edits: [{ oldText: "x", newText: "y" }] }, cwd);
    expect(failed.isError).toBe(true);
    expect(failed.details).toBeUndefined();

    const write = createPiWriteTool();
    expect((await run(write, { path: "b.txt", content: "b\n" }, cwd)).isError).toBe(false);
    expect((await run(write, { path: "../out.txt", content: "x\n" }, cwd)).isError).toBe(true);
  });
});

describe("Pi 1.x bash results", () => {
  test("exit 0 gives Pi's bash output and isError false", async () => {
    const cwd = await fixture();
    const result = await createPiBashTool().execute(
      "b1",
      { command: "printf hi" },
      undefined,
      undefined,
      piContext(cwd),
    );
    expect(result.isError).toBe(false);
    expect(result.structuredContent).toMatchObject({
      output: "hi",
      truncated: false,
      exit_code: 0,
    });
    expect(Object.hasOwn(result.structuredContent!, "full_output_path")).toBe(false);
    expect(typeof result.structuredContent?.wall_time_seconds).toBe("number");
  });

  test("a nonzero exit sets isError and keeps the structured output, as Pi's own bash", async () => {
    const cwd = await fixture();
    const result = await createPiBashTool().execute(
      "b2",
      { command: "echo out; exit 3" },
      undefined,
      undefined,
      piContext(cwd),
    );
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ output: "out", exit_code: 3 });
  });

  test("a timeout sets isError and gives no structured output", async () => {
    const cwd = await fixture();
    const result = await createPiBashTool({ limits: { killGraceMs: 100 } }).execute(
      "b3",
      { command: "sleep 5", timeout: 0.2 },
      undefined,
      undefined,
      piContext(cwd),
    );
    expect(result.isError).toBe(true);
    expect(Object.hasOwn(result, "structuredContent")).toBe(false);
  });

  test("cut output joins the head and the tail with Pi's omission marker", async () => {
    const cwd = await fixture();
    const result = await createPiBashTool({
      limits: { maxOutputBytes: 64, maxOutputLines: 1_000 },
    }).execute(
      "b4",
      { command: "for i in $(seq 1 200); do echo line-$i; done" },
      undefined,
      undefined,
      piContext(cwd),
    );
    expect(result.structuredContent?.truncated).toBe(true);
    expect(result.structuredContent?.output).toMatch(
      /\n\n\[\.\.\. \d+ bytes omitted \.\.\.\]\n\n/u,
    );
  });
});
