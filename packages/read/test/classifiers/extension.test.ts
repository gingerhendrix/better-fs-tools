import { describe, expect, test } from "bun:test";

import { defaultClassifiers, extensionClassifier } from "../../src/index.ts";
import { expectOk, expectUnsupported, harness } from "../helpers.ts";
import { sample } from "./sample.ts";

describe("extensionClassifier", () => {
  const classifier = extensionClassifier({
    unsupported: {
      ".PNG": { code: "IMAGE", mimeType: "image/png" },
      sqlite: { code: "DATABASE", note: { message: "Use the database tool." } },
    },
    text: ["log", ".DAT"],
  });

  test("refuses a listed extension without reading the bytes", () => {
    const decided = classifier.classify(sample("plain text", { path: "/x/logo.png" }));
    if (decided?.kind !== "unsupported") throw new Error("expected unsupported");
    expect(decided).toEqual({
      kind: "unsupported",
      code: "IMAGE",
      mimeType: "image/png",
      confidence: "medium",
      reasons: ["extension:png"],
      note: {
        code: "unsupported-image",
        severity: "warning",
        message: "Files with the .png extension are not supported as UTF-8 text.",
      },
    });
  });

  test("applies a note override", () => {
    const decided = classifier.classify(sample("", { path: "db.sqlite" }));
    if (decided?.kind !== "unsupported") throw new Error("expected unsupported");
    expect(decided.note).toEqual({
      code: "unsupported-database",
      severity: "warning",
      message: "Use the database tool.",
    });
  });

  test("forces listed extensions to text, case-insensitively", () => {
    const decided = classifier.classify(sample(new Uint8Array([0, 1]), { path: "app.LOG" }));
    expect(decided).toEqual({
      kind: "text",
      mimeType: "text/plain",
      confidence: "medium",
      reasons: ["extension:log"],
    });
    expect(classifier.classify(sample("", { path: "a.dat" }))?.kind).toBe("text");
  });

  test("has no opinion on other names", () => {
    for (const path of ["a.txt", "Makefile", ".png", "dir.png/file", "trailing."]) {
      expect(classifier.classify(sample("", { path }))).toBeNull();
    }
  });

  test("placed before the default chain it decides first", async () => {
    const { read } = harness({
      files: { "/a.png": "not really an image\n", "/b.log": "a\u0000b\n" },
      deps: { classifiers: [classifier, ...defaultClassifiers()] },
    });
    const refused = expectUnsupported(await read({ path: "/a.png" }), "IMAGE");
    expect(refused.classification.classifier).toBe("extension");
    const forced = expectOk(await read({ path: "/b.log" }));
    expect(forced.view.lines[0]?.text).toBe("a\u0000b");
  });
});
