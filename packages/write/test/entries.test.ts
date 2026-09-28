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
  test("exports the parser and the grammar, and the root exports the same values", async () => {
    const patch = await import("@better-fs-tools/write/patch");
    const root = await import("@better-fs-tools/write");
    expect(Object.keys(patch).sort()).toEqual([
      "CODEX_PATCH_GRAMMAR",
      "codexPatchParser",
      "parsePatch",
    ]);
    expect(root.parsePatch).toBe(patch.parsePatch);
    expect(root.codexPatchParser).toBe(patch.codexPatchParser);
    expect(root.CODEX_PATCH_GRAMMAR).toBe(patch.CODEX_PATCH_GRAMMAR);
  });
});

describe("./signature", () => {
  test("exports the presets, the messages helper, and the grammar", async () => {
    const signature = await import("@better-fs-tools/write/signature");
    const patch = await import("@better-fs-tools/write/patch");
    expect(Object.keys(signature).sort()).toEqual([
      "CODEX_PATCH_GRAMMAR",
      "camelCaseEditSignature",
      "defaultEditSignature",
      "defaultPatchSignature",
      "defaultWriteSignature",
      "freeformPatchSignature",
      "multiEditSignature",
      "snakeCaseWriteSignature",
      "writeSignatureMessages",
    ]);
    expect(signature.CODEX_PATCH_GRAMMAR).toBe(patch.CODEX_PATCH_GRAMMAR);
  });
});
