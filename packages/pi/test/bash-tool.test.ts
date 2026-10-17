import { describe, expect, test } from "bun:test";

import type { CommandRunner } from "@better-fs-tools/shell";

import { defaultBashSignature } from "@better-fs-tools/shell/signature";

import { createPiBashTool } from "../src/index.ts";
import { fixtures, piContext, textOf } from "./helpers.ts";
import { piCwdCommandRunner } from "../src/node.ts";
import { shellEnv } from "@better-fs-tools/shell";

const makeRoot = fixtures();

describe("createPiBashTool", () => {
  test("has the shared default signature: command, timeout in milliseconds, and cwd", () => {
    const tool = createPiBashTool({
      runner: piCwdCommandRunner(),
      env: shellEnv(() => process.env),
    });
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
      runner: piCwdCommandRunner(),
      env: shellEnv(() => process.env),
      signature: defaultBashSignature({ timeoutUnit: "s", cwd: false }),
    });
    expect(Object.keys((tool.parameters as { properties: object }).properties)).toEqual([
      "command",
      "timeout",
    ]);
  });

  test("a cwd from the model is relative to ctx.cwd", async () => {
    const root = await makeRoot({ "sub/b.txt": "b" });
    const tool = createPiBashTool({
      runner: piCwdCommandRunner(),
      env: shellEnv(() => process.env),
    });
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
    const tool = createPiBashTool({
      runner: piCwdCommandRunner(),
      env: shellEnv(() => process.env),
    });
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
    const tool = createPiBashTool({
      runner: piCwdCommandRunner(),
      env: shellEnv(() => process.env),
      limits: { killGraceMs: 100 },
    });
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
      runner: piCwdCommandRunner(),
      env: shellEnv(() => process.env),
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
    const tool = createPiBashTool({
      runner: piCwdCommandRunner(),
      env: shellEnv(() => process.env),
      limits: { defaultTimeoutMs: 1_000, maxTimeoutMs: 2_000 },
    });
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
      env: shellEnv(() => process.env),
      runner: { id: "sandbox", cwd: "/", run: () => ({ output: [], exit: new Promise(() => {}) }) },
    } as never);
    expect(tool.description).toContain("Commands run in: sandbox.");
    expect(
      createPiBashTool({ runner: piCwdCommandRunner(), env: shellEnv(() => process.env) })
        .description,
    ).not.toContain("Commands run in:");
  });

  test("a runner object runs in its own cwd unless the cwd option is set", async () => {
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
    const own = createPiBashTool({ env: shellEnv(() => process.env), runner });
    await own.execute("c5", { command: "pwd" }, undefined, undefined, piContext("/context/one"));
    const tool = createPiBashTool({
      env: shellEnv(() => process.env),
      runner,
      cwd: (call) => call.host.cwd,
    });
    for (const cwd of ["/context/one", "/context/two"]) {
      await tool.execute("c6", { command: "pwd" }, undefined, undefined, piContext(cwd));
    }
    const made = createPiBashTool({
      env: shellEnv(() => process.env),
      runner: () => runner,
      cwd: (call) => call.host.cwd,
    });
    await made.execute("c7", { command: "pwd" }, undefined, undefined, piContext("/context/three"));
    expect(seen).toEqual(["/runner", "/context/one", "/context/two", "/context/three"]);
  });

  test("piCwdCommandRunner() refuses a relative or missing ctx.cwd, and the call is an error result", async () => {
    const runner = piCwdCommandRunner();
    const tool = createPiBashTool({ runner, env: shellEnv(() => process.env) });
    for (const ctx of [piContext("relative"), {} as never]) {
      const result = await tool.execute("c8", { command: "true" }, undefined, undefined, ctx);
      expect(result.isError).toBe(true);
      expect(textOf(result)).toStartWith("[bash:extension-failed]");
    }
    expect(() => runner({ host: piContext("relative") })).toThrow(
      "piCwdCommandRunner needs an absolute ctx.cwd",
    );
    expect(() => runner({ host: {} as never })).toThrow("piCwdCommandRunner needs ctx.cwd");
  });

  test("piCwdCommandRunner() refuses cwd in its options; runner and env are required", () => {
    expect(() => piCwdCommandRunner({ cwd: "/" } as never)).toThrow(
      "piCwdCommandRunner options cannot set cwd",
    );
    expect(() => createPiBashTool({ env: shellEnv() } as never)).toThrow(TypeError);
    expect(() => createPiBashTool({ runner: piCwdCommandRunner() } as never)).toThrow(
      "env is required",
    );
  });
});
