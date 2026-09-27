import { describe, expect, test } from "bun:test";

import { memoryFileSystem } from "@better-fs-tools/fs";
import type { FileSystem } from "@better-fs-tools/fs";

import { askUser, createReadTool } from "../../src/index.ts";
import type { AuthorizeTarget, HookContext, ReadContext } from "../../src/index.ts";
import { expectFailure, expectOk } from "../helpers.ts";
import { hookContext, listTarget, readTarget } from "./context.ts";

interface Host {
  readonly answers: Map<string, boolean>;
}

describe("askUser", () => {
  test("true allows; false, a throw, or a non-boolean denies", async () => {
    for (const [answer, allow] of [
      [async () => true, true],
      [async () => false, false],
      [async () => "yes" as never, false],
      [
        async () => {
          throw new Error("dialog closed");
        },
        false,
      ],
    ] as const) {
      const decision = await askUser(answer).authorize(readTarget("/a"), hookContext());
      expect(decision.allow).toBe(allow);
    }
  });

  test("the denial note uses the catalog's denied text", async () => {
    const decision = await askUser(async () => false).authorize(readTarget("/a"), hookContext());
    expect(decision).toEqual({
      allow: false,
      note: {
        code: "denied",
        severity: "warning",
        message: "/a was refused by policy (the user did not approve the read).",
      },
    });
  });

  test("a list is allowed without a prompt", async () => {
    let asked = 0;
    const ask = askUser(async () => {
      asked += 1;
      return false;
    });
    expect((await ask.authorize(listTarget("/d"), hookContext())).allow).toBe(true);
    expect(asked).toBe(0);
  });

  test("the prompt gets the target and the call, and keeps answers through the host", async () => {
    const call: ReadContext<Host> = { host: { answers: new Map([["/a.txt", true]]) } };
    const seen: [AuthorizeTarget, HookContext<Host>][] = [];
    const read = createReadTool<Host>({
      fs: memoryFileSystem({ files: { "/a.txt": "a\n", "/b.txt": "b\n" } }),
      authorize: askUser(async (target, ctx) => {
        seen.push([target, ctx]);
        return ctx.call.host.answers.get(target.resolvedPath) ?? false;
      }),
    });
    expectOk(await read({ path: "/a.txt" }, call));
    expectFailure(await read({ path: "/b.txt" }, call), "DENIED");
    expect(seen.map(([target]) => target.resolvedPath)).toEqual(["/a.txt", "/b.txt"]);
    expect(seen.every(([, ctx]) => ctx.call === call)).toBe(true);
  });

  test("an abort while the prompt waits gives ABORTED and closes the handle", async () => {
    const inner = memoryFileSystem({ files: { "/a.txt": "a\n" } });
    const events: string[] = [];
    const fs: FileSystem = {
      ...inner,
      async open(path, options) {
        const opened = await inner.open(path, options);
        if (!opened.ok) return opened;
        const { file } = opened;
        return {
          ok: true,
          file: {
            ...file,
            bytes: () => {
              events.push("bytes");
              return file.bytes();
            },
            close: async () => {
              events.push("close");
              await file.close();
            },
          },
        };
      },
    };
    const controller = new AbortController();
    const read = createReadTool({
      fs,
      authorize: askUser(() => {
        events.push("prompt");
        setTimeout(() => controller.abort(), 1);
        return new Promise<boolean>(() => {});
      }),
    });
    const result = await read({ path: "/a.txt" }, { signal: controller.signal });
    expect(expectFailure(result, "ABORTED").notes[0]?.data).toEqual({ phase: "authorize" });
    expect(events).toEqual(["prompt", "close"]);
  });

  test("has a stable id and refuses a non-function", () => {
    expect(askUser(async () => true).id).toBe("ask-user");
    expect(() => askUser(null as never)).toThrow(TypeError);
  });
});
