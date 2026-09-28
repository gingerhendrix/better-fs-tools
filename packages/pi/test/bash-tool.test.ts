import { describe, expect, test } from "bun:test";

import { createPiBashTool } from "../src/index.ts";
import { fixtures, piContext } from "./helpers.ts";

const makeRoot = fixtures();

describe("createPiBashTool", () => {
  test("has Pi's own bash shape: command and timeout in seconds, no cwd", () => {
    const tool = createPiBashTool();
    expect(tool.name).toBe("bash");
    expect(tool.label).toBe("bash");
    expect(tool.promptSnippet).toBe("Execute bash commands (ls, grep, find, etc.)");
    expect(Object.keys((tool.parameters as { properties: object }).properties)).toEqual([
      "command",
      "timeout",
    ]);
  });

  test("runs in ctx.cwd, one runner for each directory", async () => {
    const first = await makeRoot({ "a.txt": "a" });
    const second = await makeRoot({ "b.txt": "b" });
    const tool = createPiBashTool();
    const one = await tool.execute(
      "c1",
      { command: "pwd; ls" },
      undefined,
      undefined,
      piContext(first),
    );
    const two = await tool.execute(
      "c2",
      { command: "pwd; ls" },
      undefined,
      undefined,
      piContext(second),
    );
    expect(one.content).toEqual([
      { type: "text", text: expect.stringContaining(`${first}\na.txt`) },
    ]);
    expect(two.content).toEqual([
      { type: "text", text: expect.stringContaining(`${second}\nb.txt`) },
    ]);
    expect(one.details).toBeUndefined();
  });

  test("the timeout is in seconds", async () => {
    const root = await makeRoot();
    const tool = createPiBashTool({ limits: { killGraceMs: 100 } });
    const result = await tool.execute(
      "c3",
      { command: "sleep 5", timeout: 0.2 },
      undefined,
      undefined,
      piContext(root),
    );
    expect(result.content[0]).toMatchObject({
      text: expect.stringContaining("Timed out after 0.2 s"),
    });
  });

  test("a spill reference becomes details.fullOutputPath", async () => {
    const root = await makeRoot();
    const tool = createPiBashTool({
      spill: {
        id: "noop",
        open: async () => ({ write: async () => undefined, close: async () => "/tmp/full.log" }),
      },
    });
    const result = await tool.execute(
      "c4",
      { command: "echo hi" },
      undefined,
      undefined,
      piContext(root),
    );
    expect(result.details).toEqual({ fullOutputPath: "/tmp/full.log" });
  });

  test("the default description names the configured timeouts, in seconds", () => {
    const tool = createPiBashTool({ limits: { defaultTimeoutMs: 1_000, maxTimeoutMs: 2_000 } });
    const timeout = (tool.parameters as { properties: { timeout: { description: string } } })
      .properties.timeout.description;
    expect(timeout).toBe("Timeout in seconds. Default 1 seconds, maximum 2 seconds.");
    expect(tool.description).not.toContain("120");
    expect(tool.description).toContain("The command stops after 1 s");
  });

  test("the default description names a given runner object", () => {
    const tool = createPiBashTool({
      runner: { id: "sandbox", cwd: "/", run: () => ({ output: [], exit: new Promise(() => {}) }) },
    } as never);
    expect(tool.description).toContain("Commands run in: sandbox.");
    expect(createPiBashTool().description).not.toContain("Commands run in:");
  });

  test("refuses cwd in options and a context without cwd", async () => {
    expect(() => createPiBashTool({ cwd: "/" } as never)).toThrow(TypeError);
    const tool = createPiBashTool();
    await expect(
      tool.execute("c5", { command: "true" }, undefined, undefined, {} as never),
    ).rejects.toThrow(TypeError);
  });
});
