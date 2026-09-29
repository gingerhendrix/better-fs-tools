import { describe, expect, test } from "bun:test";

import { Type } from "typebox";
import { Value } from "typebox/value";

import { exactMatcher, lineTrimmedMatcher } from "../../src/index.ts";
import { CODEX_PATCH_GRAMMAR } from "../../src/patch/index.ts";
import {
  camelCaseEditSignature,
  defaultEditSignature,
  defaultPatchSignature,
  defaultWriteSignature,
  freeformPatchSignature,
  multiEditSignature,
  snakeCaseWriteSignature,
} from "../../src/signature/index.ts";
import type { MutationSignature } from "../../src/signature/index.ts";
import { generatedInputs } from "./generated.ts";
import type { NestedKeys } from "./generated.ts";

const LOOKAHEAD_PATH_PATTERN = "^(?=[^\\u0000]*$)[\\s\\S]*[^\\s\\u0000][\\s\\S]*$";

const PATH_TABLE = [
  "",
  " ",
  "\t\n",
  "\u00a0",
  "\u2028",
  "\u0000",
  "a\u0000b",
  " \u0000 ",
  "a",
  "a.txt",
  "/abs/path/file.ts",
  "dir/a b.txt",
  " leading",
  "trailing ",
  "  both  ",
  "caf\u00e9/\u6587\u4ef6.md",
  "\ud83d\ude00.txt",
  "\ud83d",
  "line\nbreak",
];

interface Preset {
  readonly label: string;
  readonly build: () => MutationSignature<unknown>;
  readonly keys: readonly string[];
  readonly nested?: NestedKeys;
}

const PRESETS: readonly Preset[] = [
  {
    label: "defaultEditSignature",
    build: () => defaultEditSignature(),
    keys: ["path", "old_string", "new_string", "replace_all"],
  },
  {
    label: "multiEditSignature",
    build: () => multiEditSignature(),
    keys: ["path", "edits"],
    nested: { edits: ["oldText", "newText"] },
  },
  {
    label: "camelCaseEditSignature",
    build: () => camelCaseEditSignature(),
    keys: ["filePath", "oldString", "newString", "replaceAll"],
  },
  {
    label: "defaultWriteSignature",
    build: () => defaultWriteSignature(),
    keys: ["path", "content"],
  },
  {
    label: "snakeCaseWriteSignature",
    build: () => snakeCaseWriteSignature(),
    keys: ["file_path", "content"],
  },
  { label: "defaultPatchSignature", build: () => defaultPatchSignature(), keys: ["patch"] },
  { label: "freeformPatchSignature", build: () => freeformPatchSignature(), keys: ["patch"] },
];

function schemaAccepts(signature: MutationSignature<unknown>, input: unknown): boolean {
  return Value.Check(Type.Unsafe(signature.schema), input);
}

function toInputAccepts(signature: MutationSignature<unknown>, input: unknown): boolean {
  try {
    signature.toInput(input);
    return true;
  } catch (error) {
    expect(error).toBeInstanceOf(TypeError);
    return false;
  }
}

describe("signature presets", () => {
  for (const preset of PRESETS) {
    test(`${preset.label}: schema and description snapshot`, () => {
      const signature = preset.build();
      expect({
        name: signature.name,
        description: signature.description,
        schema: signature.schema,
        grammar: signature.grammar !== undefined,
      }).toMatchSnapshot();
    });

    test(`${preset.label}: frozen, and every parameter has a description`, () => {
      const signature = preset.build();
      expect(Object.isFrozen(signature)).toBe(true);
      expect(Object.isFrozen(signature.schema)).toBe(true);
      const properties = signature.schema.properties as Record<string, Record<string, unknown>>;
      expect(Object.keys(properties)).toEqual([...preset.keys]);
      for (const property of Object.values(properties)) {
        expect(typeof property.description).toBe("string");
      }
      expect(signature.schema.additionalProperties).toBe(false);
    });

    test(`${preset.label}: toInput accepts exactly what the schema accepts`, () => {
      const signature = preset.build();
      const inputs = generatedInputs(preset.keys, 3000, preset.nested);
      let accepted = 0;
      for (const input of inputs) {
        const bySchema = schemaAccepts(signature, input);
        if (toInputAccepts(signature, input) !== bySchema) {
          throw new Error(`schema ${bySchema}, toInput ${!bySchema}: ${JSON.stringify(input)}`);
        }
        if (bySchema) accepted += 1;
      }
      expect(accepted).toBeGreaterThan(10);
      expect(accepted).toBeLessThan(inputs.length - 20);
    });
  }

  test("only the optional flags are optional", () => {
    expect(defaultEditSignature().schema.required).toEqual(["path", "old_string", "new_string"]);
    expect(camelCaseEditSignature().schema.required).toEqual([
      "filePath",
      "oldString",
      "newString",
    ]);
    expect(multiEditSignature().schema.required).toEqual(["path", "edits"]);
    expect(defaultWriteSignature().schema.required).toEqual(["path", "content"]);
    expect(snakeCaseWriteSignature().schema.required).toEqual(["file_path", "content"]);
  });

  test("the patch schema has exactly one required string property, for Pi grammar tools", () => {
    for (const signature of [defaultPatchSignature(), freeformPatchSignature()]) {
      const properties = signature.schema.properties as Record<string, { type: string }>;
      expect(signature.schema.type).toBe("object");
      expect(signature.schema.required).toEqual(["patch"]);
      expect(Object.keys(properties)).toEqual(["patch"]);
      expect(properties.patch?.type).toBe("string");
    }
  });

  test("only freeformPatchSignature has a grammar, and it is the Codex grammar", () => {
    expect(freeformPatchSignature().grammar).toEqual({ lark: CODEX_PATCH_GRAMMAR });
    expect(defaultPatchSignature().grammar).toBeUndefined();
    expect(freeformPatchSignature().description).not.toMatch(/json/iu);
    expect(CODEX_PATCH_GRAMMAR).toStartWith("start: begin_patch hunk+ end_patch\n");
    expect(CODEX_PATCH_GRAMMAR).toContain('"*** Move to: " filename LF');
  });
});

describe("toInput", () => {
  test("maps each edit preset to canonical input", () => {
    expect(
      defaultEditSignature().toInput({ path: "a.ts", old_string: "x", new_string: "y" }),
    ).toEqual({ path: "a.ts", edits: [{ oldText: "x", newText: "y" }] });
    expect(
      camelCaseEditSignature().toInput({
        filePath: "a.ts",
        oldString: "x",
        newString: "",
        replaceAll: true,
      }),
    ).toEqual({ path: "a.ts", edits: [{ oldText: "x", newText: "", replaceAll: true }] });
    const edits = [
      { oldText: "a", newText: "b" },
      { oldText: "c", newText: "d" },
    ];
    expect(multiEditSignature().toInput({ path: "a.ts", edits })).toEqual({ path: "a.ts", edits });
  });

  test("maps the write and patch presets to canonical input", () => {
    expect(snakeCaseWriteSignature().toInput({ file_path: "a.md", content: "" })).toEqual({
      path: "a.md",
      content: "",
    });
    expect(defaultWriteSignature().toInput({ path: "a.md", content: "x" })).toEqual({
      path: "a.md",
      content: "x",
    });
    expect(freeformPatchSignature().toInput({ patch: "*** Begin Patch" })).toEqual({
      patch: "*** Begin Patch",
    });
  });

  test("errors name the host parameters", () => {
    const cases: [MutationSignature<unknown>, unknown, RegExp][] = [
      [defaultEditSignature(), { path: "a", new_string: "" }, /^old_string is required$/u],
      [defaultEditSignature(), { path: "a", old_string: "", new_string: "" }, /^old_string must/u],
      [defaultEditSignature(), { path: "a", oldText: "x" }, /Unknown edit input key: oldText/u],
      [
        defaultEditSignature(),
        { path: "a", old_string: "x", new_string: "y", replace_all: "yes" },
        /^replace_all must be a boolean$/u,
      ],
      [camelCaseEditSignature(), { filePath: " ", oldString: "x", newString: "" }, /^filePath/u],
      [multiEditSignature(), { path: "a", edits: [] }, /^edits must be a non-empty array$/u],
      [multiEditSignature(), { path: "a", edits: [{ oldText: "x" }] }, /edits\[0\]\.newText/u],
      [snakeCaseWriteSignature(), { path: "a", content: "" }, /Unknown write input key: path/u],
      [snakeCaseWriteSignature(), { content: "" }, /^file_path is required$/u],
      [defaultPatchSignature(), { patch: " \n" }, /^patch must be a non-blank string$/u],
    ];
    for (const [signature, input, message] of cases) {
      expect(() => signature.toInput(input)).toThrow(message);
    }
  });
});

describe("signature options", () => {
  test("docs replace the name, the description, and each parameter description", () => {
    const signature = snakeCaseWriteSignature({
      name: "create_file",
      description: "Write one file.",
      describe: { file_path: "Where." },
    });
    const properties = signature.schema.properties as Record<string, { description: string }>;
    expect(signature.name).toBe("create_file");
    expect(signature.description).toBe("Write one file.");
    expect(properties.file_path?.description).toBe("Where.");
  });

  test("every preset takes names, keyed by its own parameter names", () => {
    const cases: [MutationSignature<unknown>, unknown, unknown][] = [
      [
        defaultEditSignature({ names: { old_string: "find", new_string: "replace" } }),
        { path: "a.ts", find: "x", replace: "y" },
        { path: "a.ts", edits: [{ oldText: "x", newText: "y" }] },
      ],
      [
        camelCaseEditSignature({ names: { filePath: "file" } }),
        { file: "a.ts", oldString: "x", newString: "y", replaceAll: true },
        { path: "a.ts", edits: [{ oldText: "x", newText: "y", replaceAll: true }] },
      ],
      [
        multiEditSignature({ names: { edits: "changes", oldText: "from", newText: "to" } }),
        { path: "a.ts", changes: [{ from: "x", to: "y" }] },
        { path: "a.ts", edits: [{ oldText: "x", newText: "y" }] },
      ],
      [
        defaultWriteSignature({ names: { path: "file", content: "text" } }),
        { file: "a.ts", text: "x" },
        { path: "a.ts", content: "x" },
      ],
      [
        snakeCaseWriteSignature({ names: { file_path: "target" } }),
        { target: "a.ts", content: "x" },
        { path: "a.ts", content: "x" },
      ],
      [
        freeformPatchSignature({ names: { patch: "input" } }),
        { input: "*** Begin Patch" },
        { patch: "*** Begin Patch" },
      ],
    ];
    for (const [signature, model, canonical] of cases) {
      expect(signature.toInput(model)).toEqual(canonical);
      expect(Object.keys(signature.schema.properties as object)).toEqual(
        expect.arrayContaining(Object.keys(model as object)),
      );
    }
  });

  test("renamed presets name the host parameters in param, errors, and descriptions", () => {
    const edit = defaultEditSignature({
      names: { old_string: "find", replace_all: "all" },
      describe: { old_string: "What to find." },
    });
    expect(edit.param("oldText")).toBe("find");
    expect(edit.param("replaceAll")).toBe("all");
    expect(edit.description).toContain("`find`");
    expect(edit.description).not.toContain("old_string");
    const properties = edit.schema.properties as Record<string, { description: string }>;
    expect(properties.find?.description).toBe("What to find.");
    expect(() => edit.toInput({ path: "a", find: "", new_string: "y" })).toThrow(
      "find must not be empty",
    );

    const multi = multiEditSignature({ names: { edits: "changes", oldText: "from" } });
    expect(multi.param("oldText")).toBe("from");
    expect(multi.param("edits")).toBe("changes");
    expect(multi.param("replaceAll")).toBe("");
    expect(() => multi.toInput({ path: "a", changes: [{ from: 1, newText: "y" }] })).toThrow(
      "changes[0].from must be a string",
    );

    const patch = defaultPatchSignature({ names: { patch: "diff" } });
    expect(patch.param("patch")).toBe("diff");
    expect(patch.description).toContain("(the `diff` parameter)");
    expect(patch.schema.required).toEqual(["diff"]);
  });

  test("renamed presets accept exactly what their schema accepts", () => {
    const cases: [MutationSignature<unknown>, readonly string[], NestedKeys?][] = [
      [
        defaultEditSignature({ names: { path: "file", old_string: "find" } }),
        ["file", "find", "new_string", "replace_all"],
      ],
      [
        multiEditSignature({ names: { edits: "changes", newText: "to" } }),
        ["path", "changes"],
        { changes: ["oldText", "to"] },
      ],
      [defaultWriteSignature({ names: { content: "text" } }), ["path", "text"]],
    ];
    for (const [signature, keys, nested] of cases) {
      for (const input of generatedInputs(keys, 1000, nested)) {
        const bySchema = schemaAccepts(signature, input);
        if (toInputAccepts(signature, input) !== bySchema) {
          throw new Error(`schema ${bySchema}, toInput ${!bySchema}: ${JSON.stringify(input)}`);
        }
      }
    }
  });

  test("bad names throw TypeError", () => {
    expect(() => defaultEditSignature({ names: { path: " " } })).toThrow(
      "names.path must be a non-blank string",
    );
    expect(() => defaultEditSignature({ names: { old_string: "new_string" } })).toThrow(
      "Parameter name new_string is used twice",
    );
    expect(() => defaultWriteSignature({ names: { file_path: "x" } } as never)).toThrow(
      /Unknown parameter in names: file_path/u,
    );
    expect(() => defaultPatchSignature({ names: { patch: 1 } } as never)).toThrow(
      "names.patch must be a string",
    );
    expect(() => multiEditSignature({ names: [] as never })).toThrow(
      "multiEditSignature names must be an object",
    );
  });

  test("bad docs throw TypeError", () => {
    expect(() => defaultWriteSignature({ describe: { file_path: "x" } } as never)).toThrow(
      /Unknown parameter in describe: file_path/u,
    );
    expect(() => defaultPatchSignature({ name: " " })).toThrow(TypeError);
    expect(() => defaultEditSignature(null as never)).toThrow(TypeError);
    expect(() => multiEditSignature({ matchers: [] })).toThrow(/non-empty array/u);
  });

  test("the edit description follows the matcher chain", () => {
    const exactOnly = defaultEditSignature({ matchers: [exactMatcher()] }).description;
    expect(exactOnly).toContain("`old_string` must match the file exactly");
    expect(exactOnly).not.toContain("close match");

    const trimmed = multiEditSignature({ matchers: [exactMatcher(), lineTrimmedMatcher()] });
    expect(trimmed.description).toContain(
      "A close match may differ in: leading and trailing whitespace on each line.",
    );

    const byDefault = defaultEditSignature().description;
    expect(byDefault).toContain("curly quotes");
    expect(byDefault).toContain("escape sequences");
  });
});

describe("path pattern", () => {
  test("the path pattern has no lookaround and accepts what the lookahead pattern accepted", () => {
    const pattern = (
      defaultWriteSignature().schema.properties as Record<string, { pattern: string }>
    ).path!.pattern;
    expect(pattern).not.toMatch(/\(\?[=!<]/u);
    for (const flags of ["u", ""]) {
      const next = new RegExp(pattern, flags);
      const old = new RegExp(LOOKAHEAD_PATH_PATTERN, flags);
      for (const value of PATH_TABLE) {
        expect({ value, flags, accepts: next.test(value) }).toEqual({
          value,
          flags,
          accepts: old.test(value),
        });
      }
    }
    expect(new RegExp(pattern, "u").test("dir/a b.txt")).toBe(true);
    expect(new RegExp(pattern, "u").test(" \t")).toBe(false);
    expect(new RegExp(pattern, "u").test("a\u0000b")).toBe(false);
  });
});
