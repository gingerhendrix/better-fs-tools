import { describe, expect, test } from "bun:test";

import type { CommandRunner } from "@better-fs-tools/shell";

import { defaultBashSignature } from "@better-fs-tools/shell/signature";

import { createPiBashTool } from "../src/index.ts";
import { fixtures, piContext } from "./helpers.ts";

const makeRoot = fixtures();

describe("createPiBashTool", () => {
  test("has the shared default signature: command, timeout in milliseconds, and cwd", () => {
    const tool = createPiBashTool();
    expect(tool.name).toBe("bash");
    expect(tool.label).toBe("bash");
    expect(tool.description).toBe(defaultBashSignature().description);
    expect(tool.promptSnippet).toBe(
      "Run a shell command with bash -c and return its exit code and output",
    );
    expect(tool.promptGuidelines).toEqual([]);
    expect(Object.keys((tool.parameters as { properties: object }).properties)).toEqual([
      "command",
      "timeout",
      "cwd",
    ]);
  });

  test("the timeoutUnit seconds preset gives Pi's own bash keys", () => {
    const tool = createPiBashTool({
      signature: defaultBashSignature({ timeoutUnit: "s", cwd: false }),
    });
    expect(Object.keys((tool.parameters as { properties: object }).properties)).toEqual([
      "command",
      "timeout",
    ]);
  });

  test("a cwd from the model is relative to ctx.cwd", async () => {
    const root = await makeRoot({ "sub/b.txt": "b" });
    const tool = createPiBashTool();
    const result = await tool.execute(
      "c0",
      { command: "pwd", cwd: "sub" },
      undefined,
      undefined,
      piContext(root),
    );
    expect(result.content).toEqual([
      { type: "text", text: expect.stringContaining(`${root}/sub`) },
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

  test("the timeout is in milliseconds", async () => {
    const root = await makeRoot();
    const tool = createPiBashTool({ limits: { killGraceMs: 100 } });
    const result = await tool.execute(
      "c3",
      { command: "sleep 5", timeout: 200 },
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

  test("the default description names the configured timeouts, in milliseconds", () => {
    const tool = createPiBashTool({ limits: { defaultTimeoutMs: 1_000, maxTimeoutMs: 2_000 } });
    const timeout = (tool.parameters as { properties: { timeout: { description: string } } })
      .properties.timeout.description;
    expect(timeout).toBe(
      "Timeout in milliseconds. Default 1000 milliseconds, maximum 2000 milliseconds.",
    );
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

  test("a supplied runner runs in ctx.cwd, not in its own cwd", async () => {
    const seen: string[] = [];
    const runner: CommandRunner = {
      id: "sandbox",
      cwd: "/runner",
      run(request) {
        seen.push(request.cwd);
        return {
          output: (async function* () {})(),
          exit: Promise.resolve({ code: 0, signal: null }),
        };
      },
    };
    const tool = createPiBashTool({ runner });
    for (const cwd of ["/context/one", "/context/two"]) {
      await tool.execute("c6", { command: "pwd" }, undefined, undefined, piContext(cwd));
    }
    const made = createPiBashTool({ runner: () => runner });
    await made.execute("c7", { command: "pwd" }, undefined, undefined, piContext("/context/three"));
    expect(seen).toEqual(["/context/one", "/context/two", "/context/three"]);
  });

  test("refuses a relative ctx.cwd", async () => {
    const tool = createPiBashTool();
    await expect(
      tool.execute("c8", { command: "true" }, undefined, undefined, piContext("relative")),
    ).rejects.toThrow("Pi bash execution requires an absolute ctx.cwd");
  });

  test("refuses cwd in options and a context without cwd", async () => {
    expect(() => createPiBashTool({ cwd: "/" } as never)).toThrow(TypeError);
    const tool = createPiBashTool();
    await expect(
      tool.execute("c5", { command: "true" }, undefined, undefined, {} as never),
    ).rejects.toThrow(TypeError);
  });
});
