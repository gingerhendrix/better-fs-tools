import { describe, expect, test } from "bun:test";

import { shellEnv } from "@better-fs-tools/shell";
import type { CommandRunner, RunExit } from "@better-fs-tools/shell";
import { defaultBashSignature } from "@better-fs-tools/shell/signature";

import { createAiSdkBashTool } from "../src/index.ts";
import { executeOptions } from "./helpers.ts";

function echoRunner(): CommandRunner & { commands: string[]; timeouts: AbortSignal[] } {
  const commands: string[] = [];
  const timeouts: AbortSignal[] = [];
  return {
    id: "echo",
    cwd: "/w",
    commands,
    timeouts,
    run(request) {
      commands.push(request.command);
      timeouts.push(request.signal);
      const bytes = new TextEncoder().encode(`${request.command}\n`);
      const exit: Promise<RunExit> = Promise.resolve({ code: 0, signal: null });
      return {
        exit,
        output: (async function* () {
          yield { stream: "stdout" as const, bytes };
        })(),
      };
    },
  };
}

describe("createAiSdkBashTool", () => {
  test("names the tool from the signature and puts the runner id in the description", () => {
    const tool = createAiSdkBashTool({ runner: echoRunner(), env: shellEnv() });
    expect(tool.name).toBe("bash");
    expect(tool.strict).toBe(true);
    expect(tool.description).toContain("Commands run in: echo.");
  });

  test("execute maps the model input and returns the result; toModelOutput gives text", async () => {
    const runner = echoRunner();
    const tool = createAiSdkBashTool({ runner, env: shellEnv() });
    const result = await tool.execute({ command: "ls -la" }, executeOptions());
    expect(result.status).toBe("ok");
    expect(runner.commands).toEqual(["ls -la"]);
    const output = tool.toModelOutput({ output: result });
    expect(output.type).toBe("content");
    expect(output.value[0]).toMatchObject({ type: "text" });
    expect((output.value[0] as { text: string }).text).toContain("ls -la");
  });

  test("validate runs the signature and the core parse", async () => {
    const tool = createAiSdkBashTool({ runner: echoRunner(), env: shellEnv() });
    const validate = (tool.inputSchema as { validate?: (value: unknown) => unknown }).validate;
    expect(await validate?.({ command: "ls" })).toMatchObject({ success: true });
    expect(await validate?.({ command: "" })).toMatchObject({ success: false });
    expect(await validate?.({ command: "ls", nope: 1 })).toMatchObject({ success: false });
  });

  test("a seconds signature reaches the core as milliseconds", async () => {
    const tool = createAiSdkBashTool({
      runner: echoRunner(),
      env: shellEnv(),
      signature: defaultBashSignature({ timeoutUnit: "s" }),
    });
    const result = await tool.execute({ command: "x", timeout: 3 }, executeOptions());
    expect(result.request?.timeoutMs).toBe(3_000);
  });

  test("the abort signal reaches the core", async () => {
    const runner = echoRunner();
    const controller = new AbortController();
    controller.abort();
    const tool = createAiSdkBashTool({ runner, env: shellEnv() });
    const result = await tool.execute({ command: "x" }, executeOptions(controller.signal));
    expect(result.status).toBe("error");
    expect(result.status === "error" ? result.error.code : null).toBe("ABORTED");
    expect(runner.commands).toEqual([]);
  });

  test("options must be an object with a runner and an env", () => {
    expect(() => createAiSdkBashTool(null as never)).toThrow(TypeError);
    expect(() => createAiSdkBashTool({} as never)).toThrow(TypeError);
    // @ts-expect-error: env is required.
    expect(() => createAiSdkBashTool({ runner: echoRunner() })).toThrow("env is required");
  });
});
