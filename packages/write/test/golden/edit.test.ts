import { describe, expect, test } from "bun:test";

import { defaultWriteFormatter, textOf } from "../../src/index.ts";
import type { MutationResult } from "../../src/index.ts";
import { errorOf, harness } from "../helpers.ts";

function shown(result: MutationResult) {
  return { status: result.status, error: errorOf(result), text: textOf(result) };
}

const APP = [
  'import { x } from "./x";',
  "",
  "// sum",
  "export const y = x + 0;",
  "export const z = y * 1;",
  "",
  "export default z;",
  "",
  "// helpers",
  "function one() {",
  "  return 1;",
  "}",
  "",
  "function two() {",
  "  return 2;",
  "}",
  "",
].join("\n");

async function setup(options: Parameters<typeof harness>[0] = {}) {
  const tools = harness({ ...options, files: { "/src/app.ts": APP, ...options.files } });
  await tools.read({ path: "/src/app.ts" });
  return tools;
}

describe("golden edit output", () => {
  test("one change, several changes, replace all, and a fuzzy match", async () => {
    const { edit } = await setup();
    const one = await edit({
      path: "/src/app.ts",
      edits: [
        { oldText: "x + 0;\nexport const z = y * 1;", newText: "x + 1;\nexport const z = y * 2;" },
      ],
    });
    const several = await edit({
      path: "/src/app.ts",
      edits: [
        { oldText: "// sum", newText: "// sum of x" },
        { oldText: "  return 2;", newText: "  return 1 + 1;" },
      ],
    });
    const all = await edit({
      path: "/src/app.ts",
      edits: [{ oldText: "function", newText: "export function", replaceAll: true }],
    });
    const fuzzy = await edit({
      path: "/src/app.ts",
      edits: [
        {
          oldText: "// helpers  \nexport function one() {",
          newText: "// helper functions\nexport function one() {",
        },
      ],
    });
    expect([one, several, all, fuzzy].map(shown)).toMatchSnapshot();
  });

  test("no change and failure help", async () => {
    const { edit } = await setup();
    const applied = await edit({
      path: "/src/app.ts",
      edits: [{ oldText: "export const q = 1;", newText: "export default z;" }],
    });
    const same = await edit({
      path: "/src/app.ts",
      edits: [{ oldText: "// sum", newText: "// sum" }],
    });
    const miss = {
      path: "/src/app.ts",
      edits: [{ oldText: "function two() {\n  return 3;\n}", newText: "x" }],
    };
    const misses = [await edit(miss), await edit(miss), await edit(miss)];
    const ambiguous = await edit({ path: "/src/app.ts", edits: [{ oldText: "}", newText: "};" }] });
    const overlap = await edit({
      path: "/src/app.ts",
      edits: [
        { oldText: "function one() {\n  return 1;", newText: "a" },
        { oldText: "return 1;\n}", newText: "b" },
      ],
    });
    const tools = await setup({ files: { "/src/tail.ts": "last line" } });
    await tools.read({ path: "/src/tail.ts" });
    const newline = await tools.edit({
      path: "/src/tail.ts",
      edits: [{ oldText: "last line\n", newText: "end\n" }],
    });
    expect([applied, same, ...misses, ambiguous, overlap, newline].map(shown)).toMatchSnapshot();
  });

  test("refusals and preconditions", async () => {
    const { edit, fs, read } = await setup({
      files: { "/src/lig.ts": "de\ufb01ne(x);\n", "/src/dash.ts": "a \u2014 b\na \u2013 b\n" },
      deps: { preconditions: { onStale: "rematch" } },
    });
    await read({ path: "/src/lig.ts" });
    await read({ path: "/src/dash.ts" });
    const boundary = await edit({
      path: "/src/lig.ts",
      edits: [{ oldText: "ine(x);", newText: "ine(y);" }],
    });
    const fuzzyAll = await edit({
      path: "/src/dash.ts",
      edits: [{ oldText: "a - b", newText: "c", replaceAll: true }],
    });
    const notFound = await edit({
      path: "/src/missing.ts",
      edits: [{ oldText: "a", newText: "b" }],
    });
    fs.setFile("/src/app.ts", `// banner\n${APP}`);
    const rematched = await edit({
      path: "/src/app.ts",
      edits: [{ oldText: "  return 2;", newText: "  return 22;" }],
    });
    fs.setFile("/src/app.ts", `// banner 2\n${APP}`);
    const stale = await edit({
      path: "/src/app.ts",
      edits: [{ oldText: "// sum  ", newText: "// total" }],
    });
    const invalid = await edit({ path: "/src/app.ts", edits: [] });
    expect([boundary, fuzzyAll, notFound, rematched, stale, invalid].map(shown)).toMatchSnapshot();
  });

  test("with snippet: true", async () => {
    const { edit } = await setup({
      deps: { formatter: defaultWriteFormatter({ snippet: true }) },
    });
    const one = await edit({
      path: "/src/app.ts",
      edits: [
        { oldText: "x + 0;\nexport const z = y * 1;", newText: "x + 1;\nexport const z = y * 2;" },
      ],
    });
    const several = await edit({
      path: "/src/app.ts",
      edits: [
        { oldText: "// sum", newText: "// sum of x" },
        { oldText: "  return 2;", newText: "  return 1 + 1;" },
      ],
    });
    expect([one, several].map(shown)).toMatchSnapshot();
  });

  test("with diff: true", async () => {
    const { edit } = await setup({ deps: { formatter: defaultWriteFormatter({ diff: true }) } });
    expect(
      textOf(
        await edit({
          path: "/src/app.ts",
          edits: [{ oldText: "  return 1;", newText: "  return 10;" }],
        }),
      ),
    ).toMatchSnapshot();
  });
});
