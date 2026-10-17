import { describe, expect, test } from "bun:test";

import { textOf } from "../../src/index.ts";
import type { MutationResult } from "../../src/index.ts";
import {
  defaultEditSignature,
  defaultPatchSignature,
  defaultWriteSignature,
  freeformPatchSignature,
  multiEditSignature,
  writeSignatureMessages,
} from "../../src/signature/index.ts";
import type { MutationSignature } from "../../src/signature/index.ts";
import { harness, patchText } from "../helpers.ts";

const FILE = "alpha\nbeta\nalpha\ngamma\n";

type Tool = "edit" | "write" | "applyPatch";

async function run(
  signature: MutationSignature<unknown>,
  tool: Tool,
  inputs: readonly unknown[],
): Promise<string[]> {
  const messages = writeSignatureMessages(signature);
  const tools = harness({
    files: { "/a.txt": FILE },
    deps: { messages },
    editDeps: { messages },
    patchDeps: { messages },
  });
  await tools.read({ path: "/a.txt" });
  const texts: string[] = [];
  for (const input of inputs) {
    const result: MutationResult = await tools[tool](signature.toInput(input) as never);
    texts.push(textOf(result));
  }
  return texts;
}

describe("golden output for each signature preset", () => {
  test("defaultEditSignature", async () => {
    expect(
      await run(defaultEditSignature(), "edit", [
        { path: "/a.txt", old_string: "alpha", new_string: "ALPHA" },
        { path: "/a.txt", old_string: "alpha", new_string: "ALPHA", replace_all: true },
        { path: "/a.txt", old_string: "delta", new_string: "DELTA" },
      ]),
    ).toMatchSnapshot();
  });

  test("multiEditSignature", async () => {
    expect(
      await run(multiEditSignature(), "edit", [
        { path: "/a.txt", edits: [{ oldText: "alpha", newText: "ALPHA" }] },
        {
          path: "/a.txt",
          edits: [
            { oldText: "beta", newText: "BETA" },
            { oldText: "gamma", newText: "GAMMA" },
          ],
        },
      ]),
    ).toMatchSnapshot();
  });

  test("defaultWriteSignature", async () => {
    expect(
      await run(defaultWriteSignature(), "write", [
        { path: "/new.md", content: "# New\n" },
        { path: "/a.txt", content: FILE },
      ]),
    ).toMatchSnapshot();
  });

  for (const [label, build] of [
    ["defaultPatchSignature", defaultPatchSignature],
    ["freeformPatchSignature", freeformPatchSignature],
  ] as const) {
    test(label, async () => {
      expect(
        await run(build(), "applyPatch", [
          { patch: patchText("*** Update File: /a.txt", "@@", " alpha", "-gamma", "+GAMMA") },
          { patch: patchText("*** Update File: /a.txt", "@@", "-delta", "+DELTA") },
        ]),
      ).toMatchSnapshot();
    });
  }
});
