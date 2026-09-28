import { describe, expect, test } from "bun:test";

import {
  defaultGuards,
  executableShebang,
  generatedFileGuard,
  protectPaths,
  syntaxGuard,
  textOf,
} from "../../src/index.ts";
import type { MutationResult } from "../../src/index.ts";
import { harness } from "../helpers.ts";

function shown(result: MutationResult) {
  return { status: result.status, error: result.error, text: textOf(result) };
}

const NOTEBOOK = JSON.stringify({ cells: [], metadata: {}, nbformat: 4, nbformat_minor: 5 });

describe("golden guard output", () => {
  test("each default guard's refusal", async () => {
    const yaml = (value: string) => {
      if (value.includes("\t")) throw new Error("tabs are not allowed");
    };
    const { read, write, edit } = harness({
      files: {
        "/src/app.ts": "const a = 1;\nconst b = 2;\nconst c = 3;\nconst d = 4;\n",
        "/config.yaml": "a: 1\n",
      },
      deps: { guards: [...defaultGuards(), syntaxGuard({ parsers: { yaml } })] },
    });
    await read({ path: "/src/app.ts" });
    await read({ path: "/config.yaml" });
    const results = [
      await edit({
        path: "/src/app.ts",
        edits: [{ oldText: "const b = 2;", newText: "2|const b = 3;\n3|const c = 4;" }],
      }),
      await write({
        path: "/notes.txt",
        content: "a\n\n[read:continue] Continue with offset 3.\n",
      }),
      await write({ path: "/src/app.ts", content: "const a = 1;\n// ... rest of code\n" }),
      await edit({ path: "/config.yaml", edits: [{ oldText: "a: 1", newText: "a:\t1" }] }),
      await write({ path: "/n.ipynb", content: NOTEBOOK }),
    ];
    expect(results.map(shown)).toMatchSnapshot();
  });

  test("the opt-in guard, protectPaths, and the hooks", async () => {
    const { read, write } = harness({
      files: { "/dist/app.min.js": "a();\n", "/repo/AGENTS.md": "rules\n" },
      deps: {
        guards: [generatedFileGuard()],
        authorize: protectPaths(),
        hooks: [executableShebang()],
      },
    });
    await read({ path: "/dist/app.min.js" });
    const results = [
      await write({ path: "/dist/app.min.js", content: "b();\n" }),
      await write({ path: "/repo/AGENTS.md", content: "new rules\n" }),
      await write({ path: "/bin/run", content: "#!/bin/sh\necho hi\n" }),
    ];
    expect(results.map(shown)).toMatchSnapshot();
  });
});
