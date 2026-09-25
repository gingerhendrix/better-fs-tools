import { describe, expect, test } from "bun:test";

import { defaultClassifiers, utf8Classifier } from "../../src/index.ts";
import type { ClassificationSample } from "../../src/index.ts";
import { sample } from "./sample.ts";

function classify(input: ClassificationSample) {
  for (const classifier of defaultClassifiers()) {
    const result = classifier.classify(input);
    if (result !== null) return { id: classifier.id, result };
  }
  return null;
}

describe("default chain", () => {
  test("runs image, pdf, office, notebook, binary, utf8 in that order", () => {
    expect(defaultClassifiers().map((classifier) => classifier.id)).toEqual([
      "image",
      "pdf",
      "office",
      "notebook",
      "binary",
      "utf8",
    ]);
  });

  test("text wins for ordinary source", () => {
    const decided = classify(sample("const a = 1;\n"));
    expect(decided?.id).toBe("utf8");
    expect(decided?.result.kind).toBe("text");
  });

  test("a PNG signature refuses with an image note", () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    const decided = classify(sample(png, { path: "logo.png" }));
    if (decided?.result.kind !== "unsupported") throw new Error("expected unsupported");
    expect(decided.result.code).toBe("IMAGE");
    expect(decided.result.mimeType).toBe("image/png");
    expect(decided.result.note.message).toContain("vision tool");
  });

  test("JPEG, GIF, and WebP signatures are images", () => {
    const encode = (value: string) => new TextEncoder().encode(value);
    const jpeg = classify(sample(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])));
    const gif = classify(sample("GIF89a"));
    const webp = classify(
      sample(new Uint8Array([...encode("RIFF"), 0, 0, 0, 0, ...encode("WEBP")])),
    );
    expect([jpeg, gif, webp].map((decided) => decided?.result.mimeType)).toEqual([
      "image/jpeg",
      "image/gif",
      "image/webp",
    ]);
  });

  test("a PDF signature refuses with extraction advice", () => {
    const decided = classify(sample("%PDF-1.7\n%binary"));
    if (decided?.result.kind !== "unsupported") throw new Error("expected unsupported");
    expect(decided.result.code).toBe("PDF");
    expect(decided.result.note.message).toContain("PDF extraction tool");
  });

  test("an office zip is distinguished from a plain zip", () => {
    const zip = (tail: string) =>
      new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...new TextEncoder().encode(tail)]);
    const office = classify(sample(zip("word/document.xml"), { path: "report.docx" }));
    if (office?.result.kind !== "unsupported") throw new Error("expected unsupported");
    expect(office.result.code).toBe("OFFICE_DOCUMENT");

    const archive = classify(sample(zip("hello.txt"), { path: "bundle.zip" }));
    if (archive?.result.kind !== "unsupported") throw new Error("expected unsupported");
    expect(archive.result.code).toBe("BINARY");
    expect(archive.result.mimeType).toBe("application/zip");
  });

  test("a NUL byte refuses as binary", () => {
    const decided = classify(sample(new Uint8Array([0x61, 0x00, 0x62])));
    if (decided?.result.kind !== "unsupported") throw new Error("expected unsupported");
    expect(decided.result.code).toBe("BINARY");
    expect(decided.result.reasons).toContain("nul-byte");
  });

  test("a notebook refuses with a handler hint", () => {
    const notebook = '{"cells": [], "nbformat": 4, "metadata": {}}';
    const decided = classify(sample(notebook, { path: "analysis.ipynb" }));
    if (decided?.result.kind !== "unsupported") throw new Error("expected unsupported");
    expect(decided.result.code).toBe("NOTEBOOK");
  });

  test("SVG stays text with an SVG mime type", () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"></svg>';
    const decided = classify(sample(svg, { path: "icon.svg" }));
    if (decided?.result.kind !== "text") throw new Error("expected text");
    expect(decided.result.mimeType).toBe("image/svg+xml");
  });

  test("a note override replaces the refusal a classifier owns", () => {
    const [image] = defaultClassifiers({
      notes: {
        IMAGE: {
          code: "vision-available",
          message: (context) => `Call the vision tool with ${context.path}.`,
          data: { tool: "vision" },
        },
      },
    });
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const decided = image?.classify(sample(png, { path: "logo.png" }));
    if (decided?.kind !== "unsupported") throw new Error("expected unsupported");
    expect(decided.note.code).toBe("vision-available");
    expect(decided.note.message).toBe("Call the vision tool with logo.png.");
    expect(decided.note.data).toEqual({ tool: "vision" });
  });
});

describe("utf8Classifier", () => {
  test("an incomplete multi-byte suffix is tolerated mid-stream and refused at EOF", () => {
    const truncated = new Uint8Array([0xe2, 0x82]);
    const streaming = utf8Classifier().classify(sample(truncated, { complete: false }));
    if (streaming?.kind !== "text") throw new Error("expected text");
    expect(streaming.confidence).toBe("medium");

    const complete = utf8Classifier().classify(sample(truncated, { complete: true }));
    if (complete?.kind !== "unsupported") throw new Error("expected unsupported");
    expect(complete.code).toBe("UNKNOWN_ENCODING");
  });

  test("a UTF-8 BOM produces an advisory note", () => {
    const decided = utf8Classifier().classify(sample(new Uint8Array([0xef, 0xbb, 0xbf, 0x61])));
    if (decided?.kind !== "text") throw new Error("expected text");
    expect(decided.notes?.[0]?.code).toBe("utf8-bom");
  });

  test("uses the backend mime type hint for text", () => {
    const decided = utf8Classifier().classify(sample("x", { mimeType: "text/x-custom" }));
    expect(decided?.mimeType).toBe("text/x-custom");
  });

  test("owns the encoding refusal", () => {
    const refusal = utf8Classifier().encodingFailure?.(sample("x"));
    expect(refusal?.code).toBe("UNKNOWN_ENCODING");
  });
});
