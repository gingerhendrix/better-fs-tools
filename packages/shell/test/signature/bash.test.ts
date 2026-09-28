import { describe, expect, test } from "bun:test";

import { createBashTool, resolveShellMessages } from "@better-fs-tools/shell";
import { bashSignatureMessages, defaultBashSignature } from "@better-fs-tools/shell/signature";

import { scriptedRunner } from "../helpers.ts";

describe("defaultBashSignature", () => {
  test("milliseconds by default: the preset's timeout becomes the same timeoutMs", () => {
    const signature = defaultBashSignature();
    expect(signature.name).toBe("bash");
    expect(signature.toInput({ command: "ls", timeout: 5_000 })).toEqual({
      command: "ls",
      timeoutMs: 5_000,
    });
    expect(signature.schema).toMatchObject({
      required: ["command"],
      properties: {
        timeout: {
          description:
            "Timeout in milliseconds. Default 120000 milliseconds, maximum 600000 milliseconds.",
        },
      },
    });
  });

  test("seconds: the preset's timeout is multiplied by 1 000", () => {
    const signature = defaultBashSignature({ timeoutUnit: "s", cwd: false });
    expect(signature.toInput({ command: "ls", timeout: 2.5 })).toEqual({
      command: "ls",
      timeoutMs: 2_500,
    });
    expect(Object.keys(signature.schema.properties as object)).toEqual(["command", "timeout"]);
    expect(() => signature.toInput({ command: "ls", cwd: "/" })).toThrow(
      "Unknown bash input key: cwd",
    );
    expect(signature.param("cwd")).toBe("");
  });

  test("the seconds unit reaches the clamp note through the messages", async () => {
    const signature = defaultBashSignature({ timeoutUnit: "s" });
    const bash = createBashTool({
      runner: scriptedRunner(),
      messages: bashSignatureMessages(signature),
    });
    const result = await bash(signature.toInput({ command: "x", timeout: 3_600 }));
    expect(result.notes[0]?.message).toBe(
      "The requested timeout of 3600 seconds is over the maximum, so 600 seconds was used.",
    );
  });

  test("the description names the runner and the limits", () => {
    const signature = defaultBashSignature({
      runner: "just-bash (emulated)",
      limits: { defaultTimeoutMs: 30_000 },
    });
    expect(signature.description).toContain("Commands run in: just-bash (emulated).");
    expect(signature.description).toContain("stops after 30 s");
    expect(signature.description).toContain("Each call starts a new shell");
  });

  test("toInput refuses bad input with host names", () => {
    const signature = defaultBashSignature();
    expect(() => signature.toInput({ command: "" })).toThrow("command must be a non-blank string");
    expect(() => signature.toInput({ command: "x", timeout: -1 })).toThrow(
      "timeout must be a positive number",
    );
    expect(() => signature.toInput(null)).toThrow(TypeError);
  });

  test("names renames each parameter in the schema, toInput, param, and errors", () => {
    const signature = defaultBashSignature({
      timeoutUnit: "s",
      names: { command: "script", timeout: "timeout_seconds", cwd: "dir" },
      describe: { command: "The script." },
    });
    expect(Object.keys(signature.schema.properties as object)).toEqual([
      "script",
      "timeout_seconds",
      "dir",
    ]);
    expect(signature.schema).toMatchObject({
      required: ["script"],
      properties: { script: { description: "The script." } },
    });
    expect(signature.toInput({ script: "ls", timeout_seconds: 2, dir: "src" })).toEqual({
      command: "ls",
      timeoutMs: 2_000,
      cwd: "src",
    });
    expect(signature.param("command")).toBe("script");
    expect(signature.param("timeoutMs")).toBe("timeout_seconds");
    expect(signature.param("cwd")).toBe("dir");
    expect(() => signature.toInput({ command: "ls" })).toThrow("Unknown bash input key: command");
    expect(() => signature.toInput({ script: " " })).toThrow("script must be a non-blank string");
    expect(() => signature.toInput({ script: "x", timeout_seconds: 0 })).toThrow(
      "timeout_seconds must be a positive number",
    );
  });

  test("bad names are TypeErrors", () => {
    expect(() => defaultBashSignature({ names: { command: "" } })).toThrow(
      "names.command must be a non-blank string",
    );
    expect(() => defaultBashSignature({ names: { timeout: "command" } })).toThrow(
      "Parameter name command is used twice",
    );
    expect(() => defaultBashSignature({ cwd: false, names: { cwd: "dir" } })).toThrow(
      "Unknown parameter in names: cwd",
    );
  });

  test("option errors are TypeErrors", () => {
    expect(() => defaultBashSignature({ timeoutUnit: "min" as never })).toThrow(TypeError);
    expect(() => defaultBashSignature({ describe: { nope: "x" } as never })).toThrow(TypeError);
  });

  test("a cwd advice line uses the host name and leaves it out when there is none", () => {
    const withCwd = resolveShellMessages(bashSignatureMessages(defaultBashSignature()));
    expect(withCwd.cwdNotFound({ cwd: "x" })).toContain("Check the cwd value.");
    const without = resolveShellMessages(
      bashSignatureMessages(defaultBashSignature({ cwd: false })),
    );
    expect(without.cwdNotFound({ cwd: "x" })).toBe("The working directory x does not exist.");
  });
});
