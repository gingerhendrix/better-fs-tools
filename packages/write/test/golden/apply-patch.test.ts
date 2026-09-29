import { describe, expect, test } from "bun:test";

import type { MutationError } from "@better-fs-tools/fs";

import { defaultWriteFormatter, textOf } from "../../src/index.ts";
import type { MutationResult } from "../../src/index.ts";
import { errorOf, harness, patchText } from "../helpers.ts";

function shown(result: MutationResult) {
  return {
    status: result.status,
    error: errorOf(result),
    commit: result.commit,
    text: textOf(result),
  };
}

const APP = ["import { x } from './x';", "", "export const a = 1;", "export const b = 2;", ""].join(
  "\n",
);

const FILES = {
  "/src/app.ts": APP,
  "/src/old-name.ts": "export const old = true;\n",
  "/old/unused.ts": "unused\n",
  "/src/a.ts": "a\n",
  "/src/b.ts": "b\n",
  "/src/c.ts": "c\n",
  "/src/d.ts": "d\n",
};

async function setup(
  options: {
    readonly faults?: (operation: string, path: string) => MutationError | null;
    readonly diff?: boolean;
  } = {},
) {
  const tools = harness({
    files: FILES,
    fsOptions: options.faults === undefined ? {} : { faults: options.faults },
    deps: options.diff ? { formatter: defaultWriteFormatter({ diff: true }) } : {},
  });
  for (const path of Object.keys(FILES)) await tools.read({ path });
  return tools;
}

describe("golden apply_patch output (plan section 6)", () => {
  test("success: add, update with a loose hunk, move, and delete", async () => {
    const { applyPatch } = await setup();
    const result = await applyPatch({
      patch: patchText(
        "*** Add File: /docs/new.md",
        "+# New",
        "*** Update File: /src/app.ts",
        "@@",
        " export const a = 1;",
        "-export const b = 2;",
        "+export const b = 3;",
        "@@",
        "+export const c = 4;",
        "*** Update File: /src/old-name.ts",
        "*** Move to: /src/new-name.ts",
        "@@",
        "-export const old = true;  ",
        "+export const renamed = true;",
        "*** Delete File: /old/unused.ts",
      ),
    });
    expect(shown(result)).toMatchSnapshot();
  });

  test("success with the diff option", async () => {
    const { applyPatch } = await setup({ diff: true });
    const result = await applyPatch({
      patch: patchText("*** Update File: /src/a.ts", "@@", "-a", "+A"),
    });
    expect(textOf(result)).toMatchSnapshot();
  });

  test("verify failure, parse failure, not read, and no change", async () => {
    const { applyPatch } = await setup();
    const verify = await applyPatch({
      patch: patchText(
        "*** Update File: /src/app.ts",
        "@@",
        "-const a = 1;",
        "-const b = 2;",
        "+const a = 2;",
        "*** Add File: /src/a.ts",
        "+again",
      ),
    });
    const parse = await applyPatch({ patch: "*** Begin Patch\n*** Update File: /src/a.ts\n" });
    const unread = await harness({ files: FILES }).applyPatch({
      patch: patchText("*** Delete File: /src/a.ts"),
    });
    const same = await applyPatch({
      patch: patchText("*** Update File: /src/b.ts", "@@", "-b", "+b"),
    });
    expect([verify, parse, unread, same].map(shown)).toMatchSnapshot();
  });

  test("commit failure: rolled back, and a failed rollback", async () => {
    const patch = patchText(
      "*** Update File: /src/a.ts",
      "@@",
      "-a",
      "+A",
      "*** Update File: /src/b.ts",
      "@@",
      "-b",
      "+B",
      "*** Update File: /src/c.ts",
      "@@",
      "-c",
      "+C",
      "*** Delete File: /src/d.ts",
    );
    const rolled = await (
      await setup({
        faults: (operation, path) =>
          operation === "publish" && path === "/src/b.ts" ? { reason: "changed" } : null,
      })
    ).applyPatch({ patch });
    let writes = 0;
    const partial = await (
      await setup({
        faults: (operation, path) => {
          if (operation === "remove" && path === "/src/d.ts") return { reason: "io" };
          if (operation === "write" && path === "/src/c.ts") writes += 1;
          return operation === "write" && path === "/src/c.ts" && writes === 1
            ? { reason: "io" }
            : null;
        },
      })
    ).applyPatch({ patch });
    expect([rolled, partial].map(shown)).toMatchSnapshot();
  });
});
