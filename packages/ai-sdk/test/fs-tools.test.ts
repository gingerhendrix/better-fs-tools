import { describe, expect, test } from "bun:test";

import { generateText, isStepCount } from "ai";
import { MockLanguageModelV4 } from "ai/test";

import { memoryFileSystem } from "@better-fs-tools/fs";
import { sha256Digest } from "@better-fs-tools/read";
import type { Digest } from "@better-fs-tools/read";
import { lineRangeSignature } from "@better-fs-tools/read/signature";
import { shellEnv } from "@better-fs-tools/shell";
import type { CommandRunner, RunExit } from "@better-fs-tools/shell";
import { memoryLocks } from "@better-fs-tools/write";
import type { MutationResult } from "@better-fs-tools/write";

import { createAiSdkFsTools } from "../src/index.ts";
import { errorOf, executeOptions } from "./helpers.ts";

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};

const runner: CommandRunner = {
  id: "quiet",
  cwd: "/",
  run() {
    const exit: Promise<RunExit> = Promise.resolve({ code: 0, signal: null });
    return { exit, output: (async function* () {})() };
  },
};

const EDIT = { path: "/a.txt", old_string: "one", new_string: "1", replace_all: null };

describe("createAiSdkFsTools", () => {
  test("one call shares the store: edit needs a read first", async () => {
    const tools = createAiSdkFsTools({ fs: memoryFileSystem({ files: { "/a.txt": "one\n" } }) });
    expect(errorOf(await tools.edit.execute(EDIT, executeOptions()))?.code).toBe("NOT_READ");
    await tools.read.execute({ path: "/a.txt", offset: null, limit: null }, executeOptions());
    expect((await tools.edit.execute(EDIT, executeOptions())).status).toBe("ok");
  });

  test("the defaults are a memory store, sha256Digest(), memoryLocks(), and no bash", () => {
    const tools = createAiSdkFsTools({ fs: memoryFileSystem() });
    expect(tools.state).not.toBeNull();
    expect(tools.digest.id).toBe(sha256Digest().id);
    expect(tools.locks.id).toBe(memoryLocks().id);
    expect(tools.bash).toBeNull();
    expect(Object.keys(tools.tools)).toEqual(["read", "edit", "write", "apply_patch"]);
    expect(Object.isFrozen(tools)).toBe(true);
  });

  test("each tool takes its own signature; tools is keyed by the signature names", async () => {
    const tools = createAiSdkFsTools({
      fs: memoryFileSystem({ files: { "/a.txt": "one\ntwo\n" } }),
      read: {
        signature: lineRangeSignature({ name: "read_file", names: { path: "file_path" } }),
      },
    });
    expect(tools.read.name).toBe("read_file");
    expect(Object.keys(tools.tools)).toEqual(["read_file", "edit", "write", "apply_patch"]);
    const result = await tools.read.execute(
      { file_path: "/a.txt", start: 2, end: null },
      executeOptions(),
    );
    expect(result.status).toBe("ok");
  });

  test("bash is on only with a runner and an env, and gets the shared digest and clock", async () => {
    const now = new Date("2026-09-29T00:00:00.000Z");
    const seen: (Digest | Date | null)[] = [];
    const tools = createAiSdkFsTools({
      fs: memoryFileSystem(),
      clock: () => now,
      bash: {
        runner,
        env: shellEnv(),
        authorize: {
          id: "spy",
          authorize: (_target, ctx) => {
            seen.push(ctx.digest, ctx.clock());
            return { allow: true };
          },
        },
      },
    });
    expect(Object.keys(tools.tools)).toContain("bash");
    const ran = await tools.bash.execute(
      { command: "true", timeout: null, cwd: null },
      executeOptions(),
    );
    expect(ran.status).toBe("ok");
    expect(seen).toEqual([tools.digest, now]);
    expect(tools.bash.description).toContain("Commands run in: quiet.");
  });

  test("tools goes to generateText as it is", async () => {
    const tools = createAiSdkFsTools({ fs: memoryFileSystem({ files: { "/a.txt": "one\n" } }) });
    const model = new MockLanguageModelV4({
      doGenerate: [
        {
          content: [
            {
              type: "tool-call",
              toolCallId: "read-1",
              toolName: "read",
              input: JSON.stringify({ path: "/a.txt", offset: null, limit: null }),
            },
            {
              type: "tool-call",
              toolCallId: "edit-1",
              toolName: "edit",
              input: JSON.stringify(EDIT),
            },
          ],
          finishReason: { unified: "tool-calls", raw: "tool-calls" },
          usage,
          warnings: [],
        },
        {
          content: [{ type: "text", text: "done" }],
          finishReason: { unified: "stop", raw: "stop" },
          usage,
          warnings: [],
        },
      ],
    });
    const generated = await generateText({
      model,
      prompt: "Change /a.txt",
      tools: tools.tools,
      stopWhen: isStepCount(2),
    });
    const outputs = generated.steps[0]?.toolResults.map(
      (result) => (result.output as MutationResult).status,
    );
    expect(outputs).toEqual(["ok", "ok"]);
  });

  test("invalidate deletes the record, so the next edit needs a read", async () => {
    const tools = createAiSdkFsTools({ fs: memoryFileSystem({ files: { "/a.txt": "one\n" } }) });
    await tools.read.execute({ path: "/a.txt", offset: null, limit: null }, executeOptions());
    expect(await tools.invalidate("/a.txt")).toMatchObject({ ok: true, recorded: true });
    expect(errorOf(await tools.edit.execute(EDIT, executeOptions()))?.code).toBe("NOT_READ");
  });

  test("throws TypeError on an unknown key or a shared key in a tool (GA-16)", () => {
    const fs = memoryFileSystem();
    expect(() => createAiSdkFsTools(null as never)).toThrow(
      "createAiSdkFsTools options must be an object",
    );
    expect(() => createAiSdkFsTools({ fs, bogus: 1 } as never)).toThrow(
      "Unknown createAiSdkFsTools option: bogus",
    );
    expect(() => createAiSdkFsTools({ fs, read: { digest: null } } as never)).toThrow(
      "createAiSdkFsTools read options cannot set digest: set it once at the top level",
    );
    expect(() =>
      createAiSdkFsTools({ fs, bash: { runner, env: shellEnv(), clock: null } } as never),
    ).toThrow("createAiSdkFsTools bash options cannot set clock: set it once at the top level");
    expect(() => createAiSdkFsTools({ fs, bash: true } as never)).toThrow(
      "createAiSdkFsTools bash options must be an object",
    );
    expect(() => createAiSdkFsTools({ fs, bash: { runner } } as never)).toThrow("env is required");
  });
});
