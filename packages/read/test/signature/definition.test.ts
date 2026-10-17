import { describe, expect, test } from "bun:test";

import { memoryFileSystem } from "@better-fs-tools/fs";

import { jsonFormatter, memoryStore, textOf } from "../../src/index.ts";
import { defaultReadSignature, readToolDefinition } from "../../src/signature/index.ts";
import { expectOk } from "../helpers.ts";

const files = { "/a.txt": "one\ntwo\nthree\n" };
const call = { host: undefined };

describe("readToolDefinition", () => {
  test("defaults to defaultReadSignature() and copies its name, description, and schema", () => {
    const definition = readToolDefinition({ fs: memoryFileSystem({ files }) });
    const signature = defaultReadSignature();
    expect(definition.name).toBe("read");
    expect(definition.description).toBe(signature.description);
    expect(definition.inputSchema).toEqual(signature.schema);
    expect(Object.hasOwn(definition, "grammar")).toBe(false);
    expect(Object.isFrozen(definition)).toBe(true);
  });

  test("execute maps model input with the signature, and retry text uses its names", async () => {
    const signature = defaultReadSignature({ names: { path: "file", limit: "count" } });
    const definition = readToolDefinition({ fs: memoryFileSystem({ files }), signature });
    const result = expectOk(await definition.execute({ file: "/a.txt", count: 1 }, call));
    expect(result.view.lines.map((line) => line.text)).toEqual(["one"]);
    expect(textOf(result)).toContain('Continue with {"file":"/a.txt","offset":2,"count":1}.');
  });

  test("host messages win over the signature's", async () => {
    const definition = readToolDefinition({
      fs: memoryFileSystem({ files }),
      messages: { retry: (next) => `read ${next.path} from ${next.offset}` },
    });
    const result = await definition.execute({ path: "/a.txt", limit: 1 }, call);
    expect(textOf(result)).toContain("Continue with read /a.txt from 2.");
  });

  test("validate runs the signature and the core check, and returns canonical input", () => {
    const definition = readToolDefinition({
      fs: memoryFileSystem({ files }),
      signature: defaultReadSignature({ names: { offset: "from" } }),
    });
    expect(definition.validate({ path: "/a.txt", from: 2 })).toEqual({ path: "/a.txt", offset: 2 });
    expect(() => definition.validate({ path: "/a.txt", offset: 2 })).toThrow(
      "Unknown read input key: offset",
    );
    expect(() => definition.validate({ path: "/a.txt", from: 0 })).toThrow(TypeError);
  });

  test("limits, formatter, and digest are the ones the tool uses", async () => {
    const formatter = jsonFormatter();
    const definition = readToolDefinition({
      fs: memoryFileSystem({ files }),
      limits: { maxLines: 2 },
      formatter,
    });
    expect(definition.limits.maxLines).toBe(2);
    expect(definition.formatter).toBe(formatter);
    expect(definition.digest?.id).toBe("sha256");
    const off = readToolDefinition({ fs: memoryFileSystem({ files }), digest: null });
    expect(off.digest).toBeNull();
    const result = expectOk(await definition.execute({ path: "/a.txt" }, call));
    expect(result.view.lines).toHaveLength(2);
  });

  test("a state takes the default digest; state with digest null throws TypeError", () => {
    const fs = memoryFileSystem({ files });
    expect(() => readToolDefinition({ fs, state: memoryStore() })).not.toThrow();
    expect(() => readToolDefinition({ fs, state: memoryStore(), digest: null } as never)).toThrow(
      "state needs a digest",
    );
    expect(() => readToolDefinition(null as never)).toThrow(
      "readToolDefinition options must be an object",
    );
  });
});
