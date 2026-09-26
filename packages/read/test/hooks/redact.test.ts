import { describe, expect, test } from "bun:test";

import { redact, textOf } from "../../src/index.ts";
import type { FileConverter, ReadRecord, ReadStateStore } from "../../src/index.ts";
import { expectMedia, expectOk, harness, lineText, note, testDigest } from "../helpers.ts";

const SECRET = "AKIAABCDEFGHIJKLMNOP";
const FILE = `key=${SECRET}\nplain\nagain ${SECRET} and ${SECRET}\n`;

/** A store that keeps every put as JSON text, as a remote store would. */
function jsonStore(): ReadStateStore & { texts: string[] } {
  const texts: string[] = [];
  const records = new Map<string, string>();
  return {
    texts,
    get: async (key) => {
      const text = records.get(key);
      return text === undefined ? null : (JSON.parse(text) as ReadRecord);
    },
    put: async (key, record) => {
      const text = JSON.stringify(record);
      texts.push(text);
      records.set(key, text);
    },
    delete: async (key) => {
      records.delete(key);
    },
  };
}

describe("redact", () => {
  test("replaces matches in view lines, and the store never holds the secret", async () => {
    const state = jsonStore();
    const { read } = harness({
      files: { "/a.txt": FILE },
      deps: { hooks: [redact({ patterns: [/AKIA[0-9A-Z]{16}/g] })], state },
    });
    const plain = expectOk(await harness({ files: { "/a.txt": FILE } }).read({ path: "/a.txt" }));
    const result = expectOk(await read({ path: "/a.txt" }));

    expect(lineText(result)).toEqual([
      "key=[REDACTED]",
      "plain",
      "again [REDACTED] and [REDACTED]",
    ]);
    expect(textOf(result)).not.toContain(SECRET);
    expect(JSON.stringify(result)).not.toContain(SECRET);
    expect(result.view.bytes).toBe("key=[REDACTED]\nplain\nagain [REDACTED] and [REDACTED]".length);

    const observation = result.observation;
    if (observation === null || plain.observation === null)
      throw new Error("expected observations");
    expect(observation.wholeFileVisible).toBe(false);
    expect(plain.observation.wholeFileVisible).toBe(true);
    expect(observation.viewId).toBe(
      testDigest().hash("key=[REDACTED]\nplain\nagain [REDACTED] and [REDACTED]"),
    );
    expect(observation.viewId).not.toBe(plain.observation.viewId);
    expect(note(result, "view-modified")?.data).toEqual({ hook: "redact" });

    expect(state.texts).toHaveLength(1);
    expect(state.texts[0]).not.toContain(SECRET);
    const record = JSON.parse(state.texts[0] as string) as ReadRecord;
    expect(record.viewId).toBe(observation.viewId);
    expect(record.wholeFileVisible).toBe(false);
  });

  test("with no match the outcome is unchanged and has no view-modified note", async () => {
    const hooks = [redact({ patterns: [/nothing-here/g] })];
    const { read } = harness({ files: { "/a.txt": "plain\n" }, deps: { hooks } });
    const plain = expectOk(
      await harness({ files: { "/a.txt": "plain\n" } }).read({ path: "/a.txt" }),
    );
    const result = expectOk(await read({ path: "/a.txt" }));
    expect(result.notes).toEqual([]);
    expect(result.observation).toEqual(plain.observation);
  });

  test("applies every pattern, and the replacement is literal", async () => {
    const hooks = [redact({ patterns: [/secret/g, /token=\w+/g], replacement: "$&-gone" })];
    const { read } = harness({ files: { "/a.txt": "a secret token=abc\n" }, deps: { hooks } });
    expect(lineText(expectOk(await read({ path: "/a.txt" })))).toEqual(["a $&-gone $&-gone"]);
  });

  test("a pattern works again on the next read", async () => {
    const pattern = /x+/g;
    const { read } = harness({
      files: { "/a.txt": "xx\nxx\n" },
      deps: { hooks: [redact({ patterns: [pattern], replacement: "-" })] },
    });
    expect(lineText(expectOk(await read({ path: "/a.txt" })))).toEqual(["-", "-"]);
    expect(lineText(expectOk(await read({ path: "/a.txt" })))).toEqual(["-", "-"]);
  });

  test("replaces matches in text parts of a media outcome", async () => {
    const converter: FileConverter<unknown> = {
      id: "parts",
      target: "file",
      accepts: () => true,
      convert: async () => ({
        kind: "media",
        parts: [
          { type: "text", text: `caption ${SECRET}` },
          { type: "media", mediaType: "image/png", data: new Uint8Array([1]) },
        ],
      }),
    };
    const { read } = harness({
      files: { "/a.txt": "x\n" },
      deps: { converters: [converter], hooks: [redact({ patterns: [/AKIA[0-9A-Z]{16}/g] })] },
    });
    const result = expectMedia(await read({ path: "/a.txt" }));
    expect(result.parts[0]).toEqual({ type: "text", text: "caption [REDACTED]" });
    expect(result.parts[1]?.type).toBe("media");
    expect(note(result, "view-modified")).toBeDefined();
  });

  test("a pattern without the g flag, or a bad option, throws TypeError", () => {
    expect(() => redact({ patterns: [/AKIA/] })).toThrow(TypeError);
    expect(() => redact({ patterns: [/AKIA/g, /x/i] })).toThrow(
      'must be a RegExp with the "g" flag',
    );
    expect(() => redact({ patterns: ["AKIA" as unknown as RegExp] })).toThrow(TypeError);
    expect(() => redact({} as never)).toThrow(TypeError);
    expect(() => redact({ patterns: [/a/g], replacement: 1 as never })).toThrow(TypeError);
  });
});
