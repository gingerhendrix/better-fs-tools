import { describe, expect, test } from "bun:test";

import { shellEnv, textOf } from "../../src/index.ts";
import type { CommandRunner, RunExit } from "../../src/index.ts";
import { bashToolDefinition, defaultBashSignature } from "../../src/signature/index.ts";

function echoRunner(id = "echo"): CommandRunner & { commands: string[] } {
  const commands: string[] = [];
  return {
    id,
    cwd: "/w",
    commands,
    run(request) {
      commands.push(request.command);
      const bytes = new TextEncoder().encode(`${request.command}\n`);
      return {
        exit: Promise.resolve<RunExit>({ code: 0, signal: null }),
        output: (async function* () {
          yield { stream: "stdout" as const, bytes };
        })(),
      };
    },
  };
}

const call = { host: undefined };

describe("bashToolDefinition", () => {
  test("the default signature names the runner and the limits", () => {
    const definition = bashToolDefinition({
      runner: echoRunner("sandbox"),
      env: shellEnv(),
      limits: { defaultTimeoutMs: 5_000 },
    });
    expect(definition.description).toBe(
      defaultBashSignature({ runner: "sandbox", limits: { defaultTimeoutMs: 5_000 } }).description,
    );
    const factory = bashToolDefinition({ runner: () => echoRunner(), env: shellEnv() });
    expect(factory.description).not.toContain("Commands run in");
  });

  test("execute maps model input and runs the command", async () => {
    const runner = echoRunner();
    const definition = bashToolDefinition({
      runner,
      env: shellEnv(),
      signature: defaultBashSignature({ timeoutUnit: "s", cwd: false }),
    });
    const result = await definition.execute({ command: "ls", timeout: 2 }, call);
    expect(result.status).toBe("ok");
    expect(textOf(result)).toContain("ls");
    expect(runner.commands).toEqual(["ls"]);
    expect(definition.validate({ command: "ls", timeout: 2 })).toEqual({
      command: "ls",
      timeoutMs: 2_000,
    });
    expect(() => definition.validate({ command: "ls", cwd: "/" })).toThrow(TypeError);
  });

  test("throws TypeError where createBashTool() does", () => {
    expect(() => bashToolDefinition({ runner: echoRunner() } as never)).toThrow("env is required");
    expect(() => bashToolDefinition(null as never)).toThrow(
      "bashToolDefinition options must be an object",
    );
  });
});
