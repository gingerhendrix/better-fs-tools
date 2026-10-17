import { describe, expect, test } from "bun:test";

import { memoryFileSystem } from "@better-fs-tools/fs";

import { exactMatcher, textOf } from "../../src/index.ts";
import { CODEX_PATCH_GRAMMAR } from "../../src/patch/index.ts";
import {
  applyPatchToolDefinition,
  defaultEditSignature,
  defaultPatchSignature,
  defaultWriteSignature,
  editToolDefinition,
  writeToolDefinition,
} from "../../src/signature/index.ts";
import { errorOf } from "../helpers.ts";

const call = { host: undefined };

describe("editToolDefinition", () => {
  test("the default signature describes the tool's matchers", () => {
    const definition = editToolDefinition({ fs: memoryFileSystem(), matchers: [exactMatcher()] });
    expect(definition.description).toBe(
      defaultEditSignature({ matchers: [exactMatcher()] }).description,
    );
    expect(definition.signature.param("oldText")).toBe("old_string");
  });

  test("execute maps model input, and errors name the signature's parameters", async () => {
    const definition = editToolDefinition({
      fs: memoryFileSystem({ files: { "/a.txt": "a\na\n" } }),
      preconditions: { requireRead: "off" },
    });
    const result = await definition.execute(
      { path: "/a.txt", old_string: "a", new_string: "b" },
      call,
    );
    expect(errorOf(result)?.code).toBe("AMBIGUOUS_MATCH");
    expect(textOf(result)).toContain("or set replace_all.");
    await expect(definition.execute({ path: "/a.txt", oldText: "a" }, call)).rejects.toThrow(
      TypeError,
    );
  });

  test("host messages win over the signature's", async () => {
    const definition = editToolDefinition({
      fs: memoryFileSystem({ files: { "/a.txt": "a\na\n" } }),
      preconditions: { requireRead: "off" },
      messages: { param: (name) => `<${name}>` },
    });
    const result = await definition.execute(
      { path: "/a.txt", old_string: "a", new_string: "b" },
      call,
    );
    expect(textOf(result)).toContain("<oldText>");
  });
});

describe("writeToolDefinition and applyPatchToolDefinition", () => {
  test("validate checks the signature, then the core input at the tool's limits", () => {
    const write = writeToolDefinition({
      fs: memoryFileSystem(),
      signature: defaultWriteSignature({ names: { path: "file" } }),
    });
    expect(write.validate({ file: "/a.txt", content: "" })).toEqual({
      path: "/a.txt",
      content: "",
    });
    expect(() => write.validate({ path: "/a.txt", content: "" })).toThrow(TypeError);

    const patch = applyPatchToolDefinition({
      fs: memoryFileSystem(),
      limits: { maxPatchBytes: 8 },
    });
    expect(() => patch.validate({ patch: "*** Begin Patch\n*** End Patch" })).toThrow(
      "patch must be at most 8 bytes of UTF-8",
    );
  });

  test("a grammar on the signature is copied to the definition", () => {
    const signature = { ...defaultPatchSignature(), grammar: { lark: CODEX_PATCH_GRAMMAR } };
    expect(applyPatchToolDefinition({ fs: memoryFileSystem(), signature }).grammar).toEqual({
      lark: CODEX_PATCH_GRAMMAR,
    });
    expect(Object.hasOwn(applyPatchToolDefinition({ fs: memoryFileSystem() }), "grammar")).toBe(
      false,
    );
  });

  test("throw TypeError on options that are not an object", () => {
    expect(() => writeToolDefinition(null as never)).toThrow(
      "writeToolDefinition options must be an object",
    );
    expect(() => editToolDefinition([] as never)).toThrow(
      "editToolDefinition options must be an object",
    );
  });
});
