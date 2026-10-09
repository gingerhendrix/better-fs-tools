import { describe, expect, test } from "bun:test";

import { recommendedGuards, resolveWriteMessages, textOf } from "../../src/index.ts";
import type { MutationSignature } from "../../src/signature/index.ts";
import {
  camelCaseEditSignature,
  defaultEditSignature,
  defaultPatchSignature,
  defaultWriteSignature,
  multiEditSignature,
  snakeCaseWriteSignature,
  writeSignatureMessages,
} from "../../src/signature/index.ts";
import { errorOf, harness } from "../helpers.ts";

const FILE = "one\ntwo\none\nthree\n";

async function editWith(signature: MutationSignature<unknown>, input: unknown) {
  const tools = harness({
    files: { "/a.txt": FILE },
    editDeps: { messages: writeSignatureMessages(signature), guards: recommendedGuards() },
  });
  await tools.read({ path: "/a.txt" });
  return tools.edit(signature.toInput(input) as never);
}

describe("writeSignatureMessages", () => {
  test("returns a frozen param that asks the signature", () => {
    const messages = writeSignatureMessages(defaultEditSignature());
    expect(Object.keys(messages)).toEqual(["param"]);
    expect(Object.isFrozen(messages)).toBe(true);
    expect(messages.param("oldText")).toBe("old_string");
    expect(messages.param("patch")).toBe("patch");
  });

  test("maps canonical names to each preset's host names", () => {
    const names = (signature: MutationSignature<unknown>) =>
      Object.fromEntries(
        (["path", "oldText", "newText", "replaceAll", "content", "patch"] as const).map((name) => [
          name,
          signature.param(name),
        ]),
      );
    expect(names(defaultEditSignature())).toEqual({
      path: "path",
      oldText: "old_string",
      newText: "new_string",
      replaceAll: "replace_all",
      content: "content",
      patch: "patch",
    });
    expect(names(camelCaseEditSignature())).toMatchObject({
      path: "filePath",
      oldText: "oldString",
      replaceAll: "replaceAll",
    });
    expect(names(multiEditSignature())).toMatchObject({ oldText: "oldText", replaceAll: "" });
    expect(names(snakeCaseWriteSignature())).toMatchObject({ path: "file_path" });
    expect(names(defaultWriteSignature())).toMatchObject({ path: "path" });
    expect(names(defaultPatchSignature())).toMatchObject({ patch: "patch" });
  });

  test("throws TypeError on a non-signature", () => {
    expect(() => writeSignatureMessages({} as never)).toThrow(TypeError);
  });
});

describe("messages use the host parameter names", () => {
  test("defaultEditSignature: an ambiguous match names old_string and replace_all", async () => {
    const result = await editWith(defaultEditSignature(), {
      path: "/a.txt",
      old_string: "one",
      new_string: "1",
    });
    expect(errorOf(result)?.code).toBe("AMBIGUOUS_MATCH");
    expect(textOf(result)).toContain("the old_string matches 2 places");
    expect(textOf(result)).toContain("or set replace_all.");
  });

  test("camelCaseEditSignature: a miss names oldString", async () => {
    const result = await editWith(camelCaseEditSignature(), {
      filePath: "/a.txt",
      oldString: "four",
      newString: "4",
    });
    expect(errorOf(result)?.code).toBe("NO_MATCH");
    expect(textOf(result)).toContain("Edit 1: the oldString was not found in /a.txt.");
  });

  test("multiEditSignature: an ambiguous match does not suggest a flag it lacks", async () => {
    const result = await editWith(multiEditSignature(), {
      path: "/a.txt",
      edits: [{ oldText: "one", newText: "1" }],
    });
    expect(errorOf(result)?.code).toBe("AMBIGUOUS_MATCH");
    expect(textOf(result)).toContain("Add surrounding lines to make it unique.");
    expect(textOf(result)).not.toContain("replace");
  });

  test("a guard refusal names the host's new-text parameter", async () => {
    const result = await editWith(defaultEditSignature(), {
      path: "/a.txt",
      old_string: "three\n",
      new_string: "1|one\n2|two\n3|three\n4|four\n",
    });
    expect(errorOf(result)?.code).toBe("GUARD_REFUSED");
    expect(textOf(result)).toContain("new_string");
  });

  test("host message overrides still win over the signature's param", () => {
    const messages = resolveWriteMessages({
      ...writeSignatureMessages(defaultEditSignature()),
      param: (name) => `<${name}>`,
    });
    expect(messages.noChange({ path: "a" })).toContain("<newText>");
  });
});
