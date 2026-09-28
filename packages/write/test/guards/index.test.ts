import { describe, expect, test } from "bun:test";

import { defaultGuards } from "../../src/index.ts";
import { errorOf, harness } from "../helpers.ts";

/** Ordinary files the default guards must let through, as creates and as rewrites. */
const ORDINARY: Record<string, string> = {
  "/docs/steps.md": "# Steps\n\n1. Install.\n2. Configure.\n3. Run.\n\n- a\n- b\n",
  "/src/table.ts": "export const names = {\n  1: 'one',\n  2: 'two',\n};\n",
  "/src/stub.py": "class A:\n    def f(self):\n        ...\n",
  "/src/rest.ts":
    "// The rest of the input is ignored.\nexport const rest = (xs: number[]) => xs.slice(1);\n",
  "/config/codes.yaml": "codes:\n  200: ok\n  404: not found\n  500: error\n",
  "/data/users.tsv": "1\talice\n2\tbob\n3\tcarol\n",
  "/tsconfig.json": '{\n  // comments are fine in a create\n  "compilerOptions": {},\n}\n',
  "/package.json": '{\n  "name": "x"\n}\n',
  "/notes/times.txt": "10:30 start\n11:45 lunch\n",
  "/docs/read.md": "The read tool prints `12|text` lines and notes such as read:continue.\n",
  "/bin/run.sh": "#!/bin/sh\necho hi\n",
};

describe("defaultGuards", () => {
  test("the order", () => {
    expect(defaultGuards().map((guard) => guard.id)).toEqual([
      "read-prefix",
      "truncation-notice",
      "omission",
      "syntax",
      "non-text",
    ]);
  });

  test("each call gives new guard objects", () => {
    expect(defaultGuards()[0]).not.toBe(defaultGuards()[0]);
  });

  test("ordinary files pass as creates and as rewrites", async () => {
    const { read, write } = harness();
    for (const [path, content] of Object.entries(ORDINARY)) {
      const created = await write({ path, content });
      expect([path, created.status, errorOf(created)]).toEqual([path, "ok", null]);
    }
    for (const [path, content] of Object.entries(ORDINARY)) {
      await read({ path });
      const rewritten = await write({ path, content: `${content}\n` });
      expect([path, rewritten.status, errorOf(rewritten)]).toEqual([path, "ok", null]);
    }
  });

  test("ordinary edits pass", async () => {
    const { read, edit } = harness({ files: ORDINARY });
    await read({ path: "/src/table.ts" });
    const result = await edit({
      path: "/src/table.ts",
      edits: [{ oldText: "  2: 'two',\n", newText: "  2: 'two',\n  3: 'three',\n" }],
    });
    expect([result.status, errorOf(result)]).toEqual(["ok", null]);
  });
});
