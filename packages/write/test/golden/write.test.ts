import { describe, expect, test } from "bun:test";

import { denyPaths } from "@better-fs-tools/read";

import { createWriteTool, defaultWriteFormatter, textOf } from "../../src/index.ts";
import type { MutationResult } from "../../src/index.ts";
import { harness, withoutCompareAndSwap } from "../helpers.ts";

/** The model text and the fields a host reads, for one call. */
function shown(result: MutationResult) {
  return {
    status: result.status,
    error: result.error,
    text: textOf(result),
  };
}

describe("golden write output", () => {
  test("create, update, and no-change", async () => {
    const { read, write } = harness({ files: { "/src/app.ts": "a\nb\nc\n" } });
    const created = await write({ path: "/docs/guide/notes.md", content: "# Notes\n\nOne.\n" });
    await read({ path: "/src/app.ts" });
    const updated = await write({ path: "/src/app.ts", content: "a\nB\nc\nd\n" });
    const same = await write({ path: "/src/app.ts", content: "a\nB\nc\nd\n" });
    expect([created, updated, same].map(shown)).toMatchSnapshot();
  });

  test("with diff: true", async () => {
    const { read, write } = harness({
      files: { "/src/app.ts": "const a = 1;\nconst b = 2;\n" },
      deps: { formatter: defaultWriteFormatter({ diff: true }) },
    });
    await read({ path: "/src/app.ts" });
    expect(
      textOf(await write({ path: "/src/app.ts", content: "const a = 1;\nconst b = 3;\n" })),
    ).toMatchSnapshot();
  });

  test("refusals", async () => {
    const { fs, read, write } = harness({
      files: {
        "/src/app.ts": "one\ntwo\nthree\n",
        "/src/old.ts": "old\n",
        "/img.bin": Uint8Array.of(0, 1, 2, 3),
        "/big.txt": "0123456789\n",
      },
      fsOptions: { directories: ["/dir"] },
      deps: { limits: { maxWriteBytes: 64 } },
    });
    const notRead = await write({ path: "/src/app.ts", content: "x" });
    await read({ path: "/src/app.ts", offset: 1, limit: 1 });
    const partial = await write({ path: "/src/app.ts", content: "x" });
    await read({ path: "/src/old.ts" });
    fs.setFile("/src/old.ts", "changed\n");
    const stale = await write({ path: "/src/old.ts", content: "x" });
    const notText = createWriteTool({
      fs,
      preconditions: { requireRead: "off" },
    })({ path: "/img.bin", content: "x" });
    const notAFile = await write({ path: "/dir", content: "x" });
    await read({ path: "/big.txt" });
    const tooLarge = await write({ path: "/big.txt", content: "x".repeat(65) });
    const invalid = await write({ path: "", content: "x" });
    expect(
      [notRead, partial, stale, await notText, notAFile, tooLarge, invalid].map(shown),
    ).toMatchSnapshot();
  });

  test("host policy", async () => {
    const denied = harness({ deps: { authorize: denyPaths(["**/.env"]) } });
    const refused = harness({
      deps: {
        guards: [
          {
            id: "no-todo",
            check: (change) =>
              change.after?.text.includes("TODO")
                ? {
                    allow: false,
                    note: { code: "todo", severity: "warning", message: "Finish the TODO first." },
                  }
                : { allow: true },
          },
        ],
      },
    });
    const failed = harness({
      deps: {
        hooks: [
          {
            id: "lint",
            afterWrite: () => {
              throw new Error("lint");
            },
          },
        ],
      },
    });
    expect(
      [
        await denied.write({ path: "/app/.env", content: "KEY=1\n" }),
        await refused.write({ path: "/a.ts", content: "// TODO\n" }),
        await failed.write({ path: "/a.ts", content: "ok\n" }),
      ].map(shown),
    ).toMatchSnapshot();
  });

  test("weak backends and no store", async () => {
    const weak = harness({
      files: { "/a.txt": "one\n" },
      fsOptions: { writeCapabilities: { atomic: false, preserveMode: false } },
      writeFs: withoutCompareAndSwap,
    });
    await weak.read({ path: "/a.txt" });
    const noStore = harness({ files: { "/a.txt": "one\n" }, deps: { state: null } });
    expect(
      [
        await weak.write({ path: "/a.txt", content: "two\n" }),
        await noStore.write({ path: "/a.txt", content: "two\n" }),
      ].map(shown),
    ).toMatchSnapshot();
  });
});
