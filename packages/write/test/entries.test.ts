import { describe, expect, test } from "bun:test";

describe("package entries", () => {
  test("the root, ./patch, and ./signature entries load", async () => {
    for (const specifier of [
      "@better-fs-tools/write",
      "@better-fs-tools/write/patch",
      "@better-fs-tools/write/signature",
    ]) {
      expect(await import(specifier)).toBeDefined();
    }
  });
});

describe("./patch", () => {
  test("is the one home of the parser and the grammar", async () => {
    const patch = await import("@better-fs-tools/write/patch");
    const root = await import("@better-fs-tools/write");
    const signature = await import("@better-fs-tools/write/signature");
    expect(Object.keys(patch).sort()).toEqual([
      "CODEX_PATCH_GRAMMAR",
      "codexPatchParser",
      "parsePatch",
    ]);
    for (const name of Object.keys(patch)) {
      expect(name in root).toBe(false);
      expect(name in signature).toBe(false);
    }
  });
});

describe("./signature", () => {
  test("exports the presets and the messages helper", async () => {
    const signature = await import("@better-fs-tools/write/signature");
    expect(Object.keys(signature).sort()).toEqual([
      "camelCaseEditSignature",
      "defaultEditSignature",
      "defaultPatchSignature",
      "defaultWriteSignature",
      "freeformPatchSignature",
      "multiEditSignature",
      "snakeCaseWriteSignature",
      "writeSignatureMessages",
    ]);
  });
});
