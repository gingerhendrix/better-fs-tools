import { describe, expect, test } from "bun:test";

import { textOf, utf8Classifier } from "../../src/index.ts";
import type { Classifier } from "../../src/index.ts";
import { expectFailure, expectOk, expectUnsupported, harness } from "../helpers.ts";

describe("classification through the tool", () => {
  test("an unsupported file returns its classifier's note and code", async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 9]);
    const { read } = harness({ files: { "/logo.png": png } });
    const result = expectUnsupported(await read({ path: "/logo.png" }), "IMAGE");
    expect(result.classification.classifier).toBe("image");
    expect(result.classification.code).toBe("IMAGE");
    expect(textOf(result)).toContain("[read:unsupported-image]");
  });

  test("a text result has classification code null", async () => {
    const { read } = harness({ files: { "/a.txt": "x\n" } });
    const result = expectOk(await read({ path: "/a.txt" }));
    expect(result.classification).toEqual({
      kind: "text",
      classifier: "utf8",
      code: null,
      mimeType: "text/plain",
      confidence: "high",
      reasons: ["utf8"],
    });
  });

  test("invalid UTF-8 found after the sample refuses with the encoding note", async () => {
    const bytes = new Uint8Array(9_000);
    bytes.fill(0x61);
    bytes[8_500] = 0xff;
    const { read } = harness({ files: { "/late.txt": bytes }, fsOptions: { chunkBytes: 1_024 } });
    const result = expectUnsupported(await read({ path: "/late.txt" }), "UNKNOWN_ENCODING");
    expect(result.notes[0]?.code).toBe("unsupported-unknown-encoding");
    expect(result.classification.classifier).toBe("utf8");
  });

  test("late invalid UTF-8 with no encoding refusal is a configuration problem", async () => {
    const lenient: Classifier = {
      id: "lenient",
      classify: () => ({ kind: "text", mimeType: null, confidence: "low", reasons: [] }),
    };
    const { read } = harness({
      files: { "/late.txt": new Uint8Array([0x61, 0x0a, 0xff]) },
      deps: { classifiers: [lenient] },
    });
    expectFailure(await read({ path: "/late.txt" }), "UNSUPPORTED_BACKEND");
  });

  test("a chain with no opinion is reported as a configuration problem", async () => {
    const silent: Classifier = { id: "silent", classify: () => null };
    const { read } = harness({ files: { "/a.txt": "x\n" }, deps: { classifiers: [silent] } });
    expectFailure(await read({ path: "/a.txt" }), "UNSUPPORTED_BACKEND");
  });

  test("classifier order decides the outcome", async () => {
    const notebook = '{"cells": [], "nbformat": 4, "metadata": {}}';
    const { read } = harness({
      files: { "/a.ipynb": notebook },
      deps: { classifiers: [utf8Classifier()] },
    });
    expectOk(await read({ path: "/a.ipynb" }));
  });

  test("classifiers see only the bounded sample", async () => {
    const seen: number[] = [];
    const spy: Classifier = {
      id: "spy",
      classify: (sample) => {
        seen.push(sample.bytes.byteLength);
        return null;
      },
    };
    const { read } = harness({
      files: { "/a.txt": "x".repeat(1_000) },
      limits: { sampleBytes: 16 },
      deps: { classifiers: [spy, utf8Classifier()] },
    });
    expectOk(await read({ path: "/a.txt" }));
    expect(seen).toEqual([16]);
  });
});
