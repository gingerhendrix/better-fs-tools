import { describe, expect, test } from "bun:test";

import { Type } from "typebox";
import { Value } from "typebox/value";

import { exactMatcher, lineTrimmedMatcher } from "../../src/index.ts";
import {
  CODEX_PATCH_GRAMMAR,
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
      // Both outcomes are exercised.
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
