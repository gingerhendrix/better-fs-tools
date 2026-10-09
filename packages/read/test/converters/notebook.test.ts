import { describe, expect, test } from "bun:test";

import {
  defaultClassifiers,
  notebookClassifier,
  notebookConverter,
  textOf,
} from "../../src/index.ts";
import { corpus } from "../fixtures/corpus.ts";
import { notebookText } from "../fixtures/notebooks.ts";
import { expectOk, expectUnsupported, harness, lineText } from "../helpers.ts";

// The default chain reads a notebook as JSON text, so the converter needs the
// notebook classifier in front of it.
const classifiers = [notebookClassifier(), ...defaultClassifiers()];

const RENDERED = [
  "[cell 1: markdown]",
  "# Title",
  "",
  "Some text.",
  "",
  "[cell 2: code]",
  "print('hi')",
  "[output]",
  "hi",
  "",
  "[cell 3: code]",
  "1 + 1",
  "[output]",
  "2",
  "[output]",
  "[image/png output not shown]",
  "[output]",
  "ValueError: bad",
  "",
  "[cell 4: raw]",
];

describe("notebookConverter", () => {
  test("renders cells and text outputs as lines", async () => {
    const { read } = harness({
      files: { "/n.ipynb": notebookText },
      deps: { classifiers, converters: [notebookConverter()] },
    });
    const result = expectOk(await read({ path: "/n.ipynb" }));
    expect(lineText(result)).toEqual(RENDERED);
    expect(result.conversion).toEqual({ converter: "notebook", mimeType: "text/plain" });
    expect(result.classification.code).toBe("NOTEBOOK");
  });

  test("with the default chain the converter is not used and the notebook reads as JSON", async () => {
    const { read } = harness({
      files: { "/n.ipynb": notebookText },
      deps: { converters: [notebookConverter()] },
    });
    const result = expectOk(await read({ path: "/n.ipynb" }));
    expect(result.conversion).toBeNull();
    expect(result.classification.kind).toBe("text");
    expect(lineText(result)[0]).toBe("{");
  });

  test("outputs: false leaves the outputs out", async () => {
    const { read } = harness({
      files: { "/n.ipynb": notebookText },
      deps: { classifiers, converters: [notebookConverter({ outputs: false })] },
    });
    const lines = lineText(expectOk(await read({ path: "/n.ipynb" })));
    expect(lines).not.toContain("[output]");
    expect(lines).toContain("1 + 1");
  });

  test("the rendered lines page with offset and limit", async () => {
    const { read } = harness({
      files: { "/n.ipynb": notebookText },
      deps: { classifiers, converters: [notebookConverter()] },
    });
    const result = expectOk(await read({ path: "/n.ipynb", offset: 6, limit: 4 }));
    expect(lineText(result)).toEqual(RENDERED.slice(5, 9));
    expect(result.continuation.next).toEqual({ path: "/n.ipynb", offset: 10, limit: 4 });
  });

  test("the corpus notebook with no cells gives an empty view", async () => {
    const { read } = harness({
      files: { "/analysis.ipynb": corpus["analysis.ipynb"] ?? "" },
      deps: { classifiers, converters: [notebookConverter()] },
    });
    const result = expectOk(await read({ path: "/analysis.ipynb" }));
    expect(result.view.lines).toEqual([]);
    expect(textOf(result)).toBe("");
  });

  test("broken notebook JSON is refused as INVALID_NOTEBOOK", async () => {
    const { read } = harness({
      files: { "/n.ipynb": '{"nbformat": 4, "cells": [ {"cell_type": 1} ], "metadata": {}}' },
      deps: { classifiers, converters: [notebookConverter()] },
    });
    const result = expectUnsupported(await read({ path: "/n.ipynb" }), "INVALID_NOTEBOOK");
    expect(result.notes[0]?.code).toBe("invalid-notebook");
  });

  test("rejects outputs that is not a boolean", () => {
    expect(() => notebookConverter({ outputs: "yes" as never })).toThrow(TypeError);
  });
});
