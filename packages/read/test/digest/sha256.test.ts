import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";

import { sha256Digest } from "../../src/index.ts";

const ENCODER = new TextEncoder();

/* FIPS 180-4 example vectors, and a non-ASCII string. */
const VECTORS: readonly (readonly [string, string])[] = [
  ["", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"],
  ["abc", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"],
  [
    "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq",
    "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
  ],
  [
    "abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu",
    "cf5b16a778af8380036ce59e7b0492370b249b11e8f07a51afac45037afee9d1",
  ],
];

function nodeHash(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

describe("sha256Digest", () => {
  test("has the id and format of nodeDigest", () => {
    const digest = sha256Digest();
    expect(digest.id).toBe("sha256");
    expect(Object.isFrozen(digest)).toBe(true);
  });

  test.each(VECTORS)("hashes %p to the published digest", (input, hex) => {
    expect(sha256Digest().hash(input)).toBe(`sha256:${hex}`);
    const stream = sha256Digest().create();
    stream.update(ENCODER.encode(input));
    expect(stream.digest()).toBe(`sha256:${hex}`);
  });

  test("hashes a non-ASCII string as UTF-8", () => {
    const value = "héllo wörld, 日本語, 🙂";
    expect(sha256Digest().hash(value)).toBe(nodeHash(ENCODER.encode(value)));
  });

  test("a million 'a' bytes give the published digest", () => {
    const stream = sha256Digest().create();
    const chunk = new Uint8Array(1000).fill(0x61);
    for (let i = 0; i < 1000; i++) stream.update(chunk);
    expect(stream.digest()).toBe(
      "sha256:cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0",
    );
  });

  test("matches node:crypto for every length around the block and padding edges", () => {
    const bytes = new Uint8Array(300);
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 31 + 7) & 0xff;
    for (let length = 0; length <= bytes.length; length++) {
      const input = bytes.subarray(0, length);
      const stream = sha256Digest().create();
      stream.update(input);
      expect(stream.digest()).toBe(nodeHash(input));
    }
  });

  test("any split into chunks gives the one-shot hash", () => {
    const bytes = new Uint8Array(257);
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 13) & 0xff;
    const expected = nodeHash(bytes);
    for (const size of [1, 3, 55, 56, 63, 64, 65, 128, 200]) {
      const stream = sha256Digest().create();
      for (let offset = 0; offset < bytes.length; offset += size) {
        stream.update(bytes.subarray(offset, offset + size));
      }
      expect(stream.digest()).toBe(expected);
    }
  });

  test("an empty update changes nothing", () => {
    const stream = sha256Digest().create();
    stream.update(new Uint8Array(0));
    stream.update(ENCODER.encode("abc"));
    stream.update(new Uint8Array(0));
    expect(stream.digest()).toBe(sha256Digest().hash("abc"));
  });

  test("each stream is independent", () => {
    const digest = sha256Digest();
    const first = digest.create();
    const second = digest.create();
    first.update(ENCODER.encode("abc"));
    expect(second.digest()).toBe(digest.hash(""));
    expect(first.digest()).toBe(digest.hash("abc"));
  });

  test("a finished stream refuses more use", () => {
    const stream = sha256Digest().create();
    stream.digest();
    expect(() => stream.update(new Uint8Array(1))).toThrow(TypeError);
    expect(() => stream.digest()).toThrow(TypeError);
  });

  test("backs the read tool and gives the node:crypto content hash", async () => {
    const { memoryFileSystem } = await import("@better-fs-tools/fs");
    const { createReadTool, memoryStore } = await import("../../src/index.ts");
    const state = memoryStore();
    const read = createReadTool({
      fs: memoryFileSystem({ files: { "/a.txt": "one\ntwo\n" } }),
      state,
      digest: sha256Digest(),
    });
    const result = await read({ path: "/a.txt" });
    expect(result.status).toBe("ok");
    const record = await state.get("/a.txt");
    expect(record?.contentId).toBe(nodeHash(ENCODER.encode("one\ntwo\n")));
  });
});
