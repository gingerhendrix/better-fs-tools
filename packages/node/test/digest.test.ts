import { describe, expect, test } from "bun:test";

import { nodeDigest } from "../src/index.ts";

const ABC = "sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";

describe("nodeDigest", () => {
  test("hashes a string with SHA-256", () => {
    const digest = nodeDigest();
    expect(digest.id).toBe("sha256");
    expect(digest.hash("abc")).toBe(ABC);
  });

  test("the stream hash over chunks equals the one-shot hash", () => {
    const stream = nodeDigest().create();
    stream.update(new TextEncoder().encode("a"));
    stream.update(new TextEncoder().encode("bc"));
    expect(stream.digest()).toBe(ABC);
  });

  test("each stream is independent", () => {
    const digest = nodeDigest();
    const first = digest.create();
    const second = digest.create();
    first.update(new TextEncoder().encode("abc"));
    expect(second.digest()).toBe(digest.hash(""));
    expect(first.digest()).toBe(ABC);
  });
});
