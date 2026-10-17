import { describe, expect, test } from "bun:test";

import { memoryFileSystem } from "@better-fs-tools/fs";
import { memoryStore } from "@better-fs-tools/read";
import { defaultReadSignature } from "@better-fs-tools/read/signature";
import { shellEnv } from "@better-fs-tools/shell";
import type { CommandRunner, RunExit } from "@better-fs-tools/shell";

import { fsToolDefinitions } from "../../src/signature/index.ts";
import { errorOf } from "../helpers.ts";

const call = { host: undefined };

const runner: CommandRunner = {
  id: "quiet",
  cwd: "/",
  run: () => ({
    exit: Promise.resolve<RunExit>({ code: 0, signal: null }),
    output: (async function* () {})(),
  }),
};

describe("fsToolDefinitions", () => {
  test("read, edit, and write share one store; apply_patch and bash are off by default", async () => {
    const store = memoryStore();
    const defs = fsToolDefinitions({
      fs: memoryFileSystem({ files: { "/a.txt": "one\n" } }),
      state: store,
    });
    const edit = { path: "/a.txt", old_string: "one", new_string: "two" };
    expect(errorOf(await defs.edit.execute(edit, call))?.code).toBe("NOT_READ");
    await defs.read.execute({ path: "/a.txt" }, call);
    expect((await defs.edit.execute(edit, call)).status).toBe("ok");
    expect(defs.applyPatch).toBeNull();
    expect(defs.bash).toBeNull();
    expect(defs.digest.id).toBe("sha256");
    expect(defs.state).toBe(store);
  });

  test("each tool takes its own signature", () => {
    const defs = fsToolDefinitions({
      fs: memoryFileSystem(),
      read: { signature: defaultReadSignature({ name: "view" }) },
      applyPatch: true,
      bash: { runner, env: shellEnv() },
    });
    expect([defs.read.name, defs.applyPatch?.name, defs.bash?.name]).toEqual([
      "view",
      "apply_patch",
      "bash",
    ]);
    expect(defs.bash?.description).toContain("Commands run in: quiet.");
  });

  test("throws TypeError that names fsToolDefinitions, as createFsTools() does", () => {
    expect(() => fsToolDefinitions({ fs: memoryFileSystem(), extra: 1 } as never)).toThrow(
      "Unknown fsToolDefinitions option: extra",
    );
    expect(() =>
      fsToolDefinitions({ fs: memoryFileSystem(), read: { state: null } } as never),
    ).toThrow("fsToolDefinitions read options cannot set state: set it once at the top level");
    expect(() => fsToolDefinitions({ fs: memoryFileSystem(), bash: true } as never)).toThrow(
      "fsToolDefinitions bash must be an object with a runner and an env",
    );
  });
});
