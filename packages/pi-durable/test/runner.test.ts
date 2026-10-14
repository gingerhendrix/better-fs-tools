import { describe, expect, test } from "bun:test";

import path from "node:path";

import type { OutputChunk, RunRequest } from "@better-fs-tools/shell";

import { executionEnvRunner } from "../src/index.ts";
import { context, fixtures, localEnv } from "./helpers.ts";

const fixture = fixtures();
const DECODER = new TextDecoder();

function request(cwd: string, command: string, extra: Partial<RunRequest> = {}): RunRequest {
  return {
    command,
    cwd,
    env: { PATH: process.env.PATH ?? "/usr/bin:/bin", ONLY: "request" },
    signal: new AbortController().signal,
    killGraceMs: 100,
    ...extra,
  };
}

async function collect(output: AsyncIterable<OutputChunk>): Promise<string[]> {
  const chunks: string[] = [];
  for await (const chunk of output) chunks.push(`${chunk.stream}:${DECODER.decode(chunk.bytes)}`);
  return chunks;
}

describe("executionEnvRunner", () => {
  test("runs in the request's cwd and streams stdout and stderr apart", async () => {
    const cwd = await fixture({ "sub/a.txt": "a" });
    const runner = executionEnvRunner(localEnv(cwd), { context });
    expect(runner.id).toBe("pi-durable:node:local");
    expect(runner.cwd).toBe(cwd);
    const handle = runner.run(request(path.join(cwd, "sub"), "pwd; echo err >&2; exit 3"));
    const [chunks, exit] = await Promise.all([collect(handle.output), handle.exit]);
    expect(exit).toEqual({ code: 3, signal: null });
    expect(chunks.join("")).toContain(`stdout:${path.join(cwd, "sub")}\n`);
    expect(chunks).toContain("stderr:err\n");
  });

  test("keeps the environment's variables by default; inheritEnv: false drops them", async () => {
    const cwd = await fixture();
    process.env.BFT_RUNNER_PROBE = "inherited";
    try {
      const inherit = executionEnvRunner(localEnv(cwd), { context }).run(
        request(cwd, 'printf "%s/%s" "$BFT_RUNNER_PROBE" "$ONLY"'),
      );
      expect((await collect(inherit.output)).join("")).toBe("stdout:inherited/request");
      const replace = executionEnvRunner(localEnv(cwd), { context, inheritEnv: false }).run(
        request(cwd, 'printf "%s/%s" "$BFT_RUNNER_PROBE" "$ONLY"'),
      );
      expect((await collect(replace.output)).join("")).toBe("stdout:/request");
    } finally {
      delete process.env.BFT_RUNNER_PROBE;
    }
  });

  test("an abort stops the command", async () => {
    const cwd = await fixture();
    const controller = new AbortController();
    const handle = executionEnvRunner(localEnv(cwd), { context }).run(
      request(cwd, "sleep 5", { signal: controller.signal }),
    );
    setTimeout(() => controller.abort(), 50);
    const started = Date.now();
    expect(await handle.exit).toEqual({ code: null, signal: "SIGTERM" });
    expect(Date.now() - started).toBeLessThan(4_000);
    expect(await collect(handle.output)).toEqual([]);
  });

  test("a missing cwd or a file cwd does not start", async () => {
    const cwd = await fixture({ "file.txt": "x" });
    const runner = executionEnvRunner(localEnv(cwd), { context });
    expect(await runner.run(request(path.join(cwd, "missing"), "true")).exit).toEqual({
      code: null,
      signal: null,
      error: { reason: "cwd-not-found" },
    });
    expect(await runner.run(request(path.join(cwd, "file.txt"), "true")).exit).toEqual({
      code: null,
      signal: null,
      error: { reason: "cwd-not-a-directory" },
    });
  });

  test("checks its options", async () => {
    const env = localEnv(await fixture());
    expect(() => executionEnvRunner(env, {} as never)).toThrow(TypeError);
    expect(() => executionEnvRunner(env, { context, cwd: "relative" })).toThrow(TypeError);
    expect(() => executionEnvRunner(null as never, { context })).toThrow(TypeError);
  });
});
