import { describe, expect, test } from "bun:test";

import { memoryFileSystem } from "@better-fs-tools/fs";

import { createReadTool, sizeCeiling } from "../../src/index.ts";
import { expectFailure, expectOk } from "../helpers.ts";
import { hookContext, listTarget, readTarget } from "./context.ts";

const BIG = "x\n".repeat(50);

describe("sizeCeiling", () => {
  test("denies a read over maxBytes, and allows one at maxBytes", async () => {
    const ceiling = sizeCeiling({ maxBytes: 10 });
    expect(await ceiling.authorize(readTarget("/a", 10), hookContext())).toEqual({ allow: true });
    expect(await ceiling.authorize(readTarget("/a", 11), hookContext())).toEqual({
      allow: false,
      note: {
        code: "denied",
        severity: "warning",
        message: "/d/a.txt was refused by policy (11 bytes is over the 10-byte ceiling).",
        data: { size: 11, maxBytes: 10 },
      },
    });
  });

  test("allows an unknown size and every list", async () => {
    const ceiling = sizeCeiling({ maxBytes: 0 });
    expect((await ceiling.authorize(readTarget("/a", null), hookContext())).allow).toBe(true);
    expect((await ceiling.authorize(listTarget("/d"), hookContext())).allow).toBe(true);
  });

  test("without unrangedOnly a ranged read is denied too", async () => {
    const read = createReadTool({
      fs: memoryFileSystem({ files: { "/big.txt": BIG } }),
      authorize: sizeCeiling({ maxBytes: 10 }),
    });
    expectFailure(await read({ path: "/big.txt", offset: 2, limit: 3 }), "DENIED");
  });

  test("unrangedOnly allows a ranged read", async () => {
    const read = createReadTool({
      fs: memoryFileSystem({ files: { "/big.txt": BIG } }),
      authorize: sizeCeiling({ maxBytes: 10, unrangedOnly: true }),
    });
    expect(expectOk(await read({ path: "/big.txt", limit: 3 })).view.lines).toHaveLength(3);
    expectOk(await read({ path: "/big.txt", offset: 40 }));
  });

  test("unrangedOnly denies a whole-file read with a ranged retry in host wording", async () => {
    const read = createReadTool({
      fs: memoryFileSystem({ files: { "/big.txt": BIG } }),
      limits: { maxLines: 20 },
      messages: { retry: (next) => `read(${next.path}, from ${next.offset})` },
      authorize: sizeCeiling({ maxBytes: 10, unrangedOnly: true }),
    });
    const note = expectFailure(await read({ path: "/big.txt" }), "DENIED").notes[0];
    expect(note?.retry).toEqual({ path: "/big.txt", offset: 1, limit: 20 });
    expect(note?.message).toBe(
      "/big.txt was refused by policy (100 bytes is over the 10-byte ceiling for a whole-file read; a ranged read such as read(/big.txt, from 1) is allowed).",
    );
    expectOk(await read(note?.retry ?? { path: "" }));
  });

  test("has a stable id and refuses bad options", () => {
    expect(sizeCeiling({ maxBytes: 1 }).id).toBe("size-ceiling");
    expect(() => sizeCeiling({ maxBytes: -1 })).toThrow(TypeError);
    expect(() => sizeCeiling({ maxBytes: 1.5 })).toThrow(TypeError);
    expect(() => sizeCeiling({ maxBytes: 1, unrangedOnly: "yes" as never })).toThrow(TypeError);
    expect(() => sizeCeiling(undefined as never)).toThrow(TypeError);
  });
});
