import { describe, expect, test } from "bun:test";

import { expectOk, harness } from "../helpers.ts";

describe("observations", () => {
  test("no digest means no observation", async () => {
    const { read } = harness({ files: { "/a.txt": "one\n" }, deps: { digest: null } });
    expect(expectOk(await read({ path: "/a.txt" })).observation).toBeNull();
  });

  test("the default has no digest", async () => {
    const { fs } = harness({ files: { "/a.txt": "one\n" } });
    const { createReadTool } = await import("../../src/index.ts");
    expect(expectOk(await createReadTool({ fs })({ path: "/a.txt" })).observation).toBeNull();
  });

  test("ids are deterministic with a fixed digest and clock", async () => {
    const { read } = harness({ files: { "/a.txt": "one\ntwo\n" } });
    const first = expectOk(await read({ path: "/a.txt" })).observation;
    const second = expectOk(await read({ path: "/a.txt" })).observation;
    expect(first).toEqual(second);
    expect(first).toEqual({
      id: expect.stringMatching(/^fnv:[0-9a-f]{8}$/u),
      statId: expect.stringMatching(/^fnv:/u),
      contentId: expect.stringMatching(/^fnv:/u),
      viewId: expect.stringMatching(/^fnv:/u),
      observedAt: "2026-08-22T00:00:00.000Z",
      wholeFileVisible: true,
    });
  });

  test("contentId hashes source bytes; viewId hashes what the model saw", async () => {
    const { read } = harness({ files: { "/a.txt": "one\ntwo\nthree\n" } });
    const whole = expectOk(await read({ path: "/a.txt" })).observation;
    const window = expectOk(await read({ path: "/a.txt", offset: 2, limit: 1 })).observation;
    expect(window?.contentId).toBe(whole?.contentId as string);
    expect(window?.viewId).not.toBe(whole?.viewId as string);
    expect(window?.wholeFileVisible).toBe(false);
  });

  test("an edit changes contentId and statId", async () => {
    const { read, fs } = harness({ files: { "/a.txt": "one\n" } });
    const before = expectOk(await read({ path: "/a.txt" })).observation;
    fs.setFile("/a.txt", "two\n");
    const after = expectOk(await read({ path: "/a.txt" })).observation;
    expect(after?.contentId).not.toBe(before?.contentId as string);
    expect(after?.statId).not.toBe(before?.statId as string);
  });
});
