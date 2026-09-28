import { describe, expect, spyOn, test } from "bun:test";

import type { ToolCallContext } from "@better-fs-tools/read";

import { defaultWriteMessages, protectPaths, writeAuthorizers } from "../../src/index.ts";
import type { WriteAuthorizeTarget } from "../../src/index.ts";
import { errorCode, harness, text } from "../helpers.ts";

describe("protectPaths", () => {
  test.each(["/repo/AGENTS.md", "/repo/sub/CLAUDE.md", "/repo/.git/config", "/AGENTS.md"])(
    "denies %s without ask, before any content byte is read",
    async (path) => {
      const { fs, write } = harness({
        files: { [path]: "keep\n" },
        deps: { authorize: protectPaths() },
      });
      const open = spyOn(fs, "open");
      const result = await write({ path, content: "x" });
      expect(result.error).toMatchObject({ code: "DENIED", phase: "authorize" });
      expect(result.notes[0]?.data).toMatchObject({ pattern: expect.any(String) });
      expect(open).not.toHaveBeenCalled();
      expect(text(fs, path)).toBe("keep\n");
    },
  );

  test("near miss: other paths, and names that only contain a protected name", async () => {
    const { write } = harness({ deps: { authorize: protectPaths() } });
    for (const path of [
      "/repo/README.md",
      "/repo/AGENTS.md.bak",
      "/repo/.github/ci.yml",
      "/repo/git/x",
    ]) {
      expect([path, (await write({ path, content: "x" })).status]).toEqual([path, "ok"]);
    }
  });

  test("a create of a protected path is denied too", async () => {
    const { fs, write } = harness({ deps: { authorize: protectPaths() } });
    expect(errorCode(await write({ path: "/AGENTS.md", content: "x" }))).toBe("DENIED");
    expect(text(fs, "/AGENTS.md")).toBeNull();
  });

  test("with ask: asks once for each path in a call, with the same call object", async () => {
    const asked: [string, WriteAuthorizeTarget["change"], unknown][] = [];
    const authorize = protectPaths({
      ask: async (target, ctx) => {
        asked.push([target.resolvedPath, target.change, ctx.call]);
        return true;
      },
    });
    const { fs, read, edit } = harness({ files: { "/AGENTS.md": "a\n" }, deps: { authorize } });
    await read({ path: "/AGENTS.md" });
    const call: ToolCallContext = { host: undefined };
    const result = await edit(
      { path: "/AGENTS.md", edits: [{ oldText: "a", newText: "b" }] },
      call,
    );
    expect(result.status).toBe("ok");
    expect(text(fs, "/AGENTS.md")).toBe("b\n");
    // Asked in the access stage only. The change stage reuses the answer.
    expect(asked).toEqual([["/AGENTS.md", null, call]]);
    await edit({ path: "/AGENTS.md", edits: [{ oldText: "b", newText: "c" }] });
    expect(asked).toHaveLength(2);
  });

  test("with ask: false, a throw, or a non-boolean denies", async () => {
    for (const answer of [
      async () => false,
      async () => {
        throw new Error("closed");
      },
      async () => "yes" as never,
    ]) {
      const { fs, write } = harness({
        files: { "/CLAUDE.md": "a\n" },
        deps: { authorize: protectPaths({ ask: answer }), preconditions: { requireRead: "off" } },
      });
      const result = await write({ path: "/CLAUDE.md", content: "x" });
      expect(errorCode(result)).toBe("DENIED");
      expect(result.notes[0]?.message).toBe(
        "/CLAUDE.md was refused by policy (the path is protected and the user did not approve the change).",
      );
      expect(text(fs, "/CLAUDE.md")).toBe("a\n");
    }
  });

  test("the change stage checks the move source", async () => {
    let asks = 0;
    const authorize = protectPaths({
      ask: async () => {
        asks += 1;
        return false;
      },
    });
    const target = {
      action: "move",
      tool: "apply_patch",
      requestedPath: "/b.md",
      resolvedPath: "/b.md",
      displayPath: "/b.md",
      change: { movedFrom: "/repo/.git/HEAD" },
      plan: [],
    } as unknown as WriteAuthorizeTarget;
    const ctx = { call: {}, messages: defaultWriteMessages } as never;
    expect(await authorize.authorize(target, ctx)).toMatchObject({ allow: false });
    expect(asks).toBe(1);
  });

  test("host patterns replace the defaults, and it chains", async () => {
    const authorize = writeAuthorizers(protectPaths({ patterns: ["**/secrets/*"] }));
    const { write } = harness({ deps: { authorize } });
    expect(errorCode(await write({ path: "/app/secrets/key", content: "x" }))).toBe("DENIED");
    expect((await write({ path: "/AGENTS.md", content: "x" })).status).toBe("ok");
  });

  test("rejects bad options", () => {
    expect(() => protectPaths({ patterns: [""] })).toThrow(TypeError);
    expect(() => protectPaths({ patterns: "x" as never })).toThrow(TypeError);
    expect(() => protectPaths({ ask: true as never })).toThrow(TypeError);
  });
});
