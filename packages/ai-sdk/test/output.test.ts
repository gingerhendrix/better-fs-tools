import { describe, expect, test } from "bun:test";

import type { ReadResult } from "@better-fs-tools/read";

import { toAiSdkOutput } from "../src/index.ts";

describe("toAiSdkOutput", () => {
  test("maps each text part to one text part, in order", () => {
    const result = {
      status: "error",
      code: "IO_ERROR",
      request: null,
      file: null,
      notes: [],
      content: [
        { type: "text", text: "first" },
        { type: "text", text: "second" },
      ],
    } satisfies ReadResult;

    expect(toAiSdkOutput(result)).toEqual({
      type: "content",
      value: [
        { type: "text", text: "first" },
        { type: "text", text: "second" },
      ],
    });
  });

  test("an empty content list gives an empty value", () => {
    const result: ReadResult = {
      status: "error",
      code: "IO_ERROR",
      request: null,
      file: null,
      notes: [],
      content: [],
    };
    expect(toAiSdkOutput(result)).toEqual({ type: "content", value: [] });
  });
});
