import { describe, expect, test } from "bun:test";

import { memoryFileSystem } from "@better-fs-tools/fs";

import { createReadTool, textOf } from "../../src/index.ts";
import type { ReadResult } from "../../src/index.ts";
import { CORPUS_ROOT, corpus, corpusDirectories, corpusRequests } from "../fixtures/corpus.ts";
import { FIXED_DATE, testDigest } from "../helpers.ts";

const MAX_TEXT_LINES = 60;
const EDGE_LINES = 10;

/** Long texts keep their edges, their line count, and a digest of the whole text. */
function goldenText(text: string) {
  const lines = text.split("\n");
  if (lines.length <= MAX_TEXT_LINES) return text;
  return {
    lines: lines.length,
    digest: testDigest().hash(text),
    head: lines.slice(0, EDGE_LINES),
    tail: lines.slice(-EDGE_LINES),
  };
}

/** The parts of a result a reviewer checks in a golden file. */
function summary(result: ReadResult) {
  const base = {
    status: result.status,
    ...(result.status === "ok" ? {} : { code: result.code }),
    notes: result.notes.map((note) => note.code),
    text: goldenText(textOf(result)),
  };
  if (result.status !== "ok") return base;
  return {
    ...base,
    view: {
      startLine: result.view.startLine,
      endLine: result.view.endLine,
      bytes: result.view.bytes,
    },
    truncation: result.truncation.reasons,
    next: result.continuation.next,
    totals: result.totals,
    wholeFileVisible: result.observation?.wholeFileVisible ?? null,
  };
}

describe("golden corpus, default formatter", () => {
  const files = Object.fromEntries(
    Object.entries(corpus).map(([name, bytes]) => [`${CORPUS_ROOT}/${name}`, bytes]),
  );

  for (const request of corpusRequests) {
    test(request.id, async () => {
      const read = createReadTool({
        fs: memoryFileSystem({ files, directories: corpusDirectories }),
        digest: testDigest(),
        clock: () => FIXED_DATE,
        ...(request.limits === undefined ? {} : { limits: request.limits }),
      });
      expect(summary(await read(request.input))).toMatchSnapshot();
    });
  }
});
