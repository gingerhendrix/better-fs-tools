import { describe, expect, test } from "bun:test";

describe("package entries", () => {
  test("the root and ./signature entries load", async () => {
    for (const specifier of ["@better-fs-tools/shell", "@better-fs-tools/shell/signature"]) {
      expect(await import(specifier)).toBeDefined();
    }
  });

  test("./signature exports the preset and the messages helper", async () => {
    const signature = await import("@better-fs-tools/shell/signature");
    expect(Object.keys(signature).sort()).toEqual([
      "bashSignatureMessages",
      "defaultBashSignature",
    ]);
  });

  test("the root exports the tool, defaults, and helpers", async () => {
    const root = await import("@better-fs-tools/shell");
    expect(Object.keys(root).sort()).toEqual([
      "createBashTool",
      "defaultShellEnv",
      "defaultShellFormatter",
      "defaultShellLimits",
      "defaultShellMessages",
      "formatBytes",
      "formatDuration",
      "parseBashInput",
      "resolveShellLimits",
      "resolveShellMessages",
      "shellEnv",
      "textOf",
    ]);
  });
});
