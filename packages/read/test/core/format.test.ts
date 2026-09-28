import { describe, expect, test } from "bun:test";

import { createReadTool, textOf } from "../../src/index.ts";
import type { FormatContext, Formatter, ReadResult } from "../../src/index.ts";
import { harness } from "../helpers.ts";

describe("formatter call", () => {
  test("a string becomes one text part", async () => {
    const { read } = harness({ files: { "/a.txt": "one\n" } });
    const result = await read({ path: "/a.txt" });
    expect(result.content).toEqual([{ type: "text", text: "1|one" }]);
  });

  test("an array of parts passes through", async () => {
    const parts: Formatter<unknown> = {
      id: "parts",
      format: () => [
        { type: "text", text: "a" },
        { type: "text", text: "b" },
      ],
    };
    const { read } = harness({ files: { "/a.txt": "one\n" }, deps: { formatter: parts } });
    const result = await read({ path: "/a.txt" });
    expect(result.content).toHaveLength(2);
    expect(textOf(result)).toBe("a\nb");
  });

  test("runs in model mode with the call object, digest, and limits", async () => {
    const seen: FormatContext<unknown>[] = [];
    const spy: Formatter<unknown> = {
      id: "spy",
      format: (_outcome, ctx) => {
        seen.push(ctx);
        return "";
      },
    };
    const { fs } = harness({ files: { "/a.txt": "one\n" } });
    const call = { callId: "c1" };
    await createReadTool({ fs, formatter: spy, limits: { maxLines: 7 } })({ path: "/a.txt" }, call);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.mode).toBe("model");
    expect(seen[0]?.call === call).toBe(true);
    expect(seen[0]?.digest).toBeNull();
    expect(seen[0]?.limits.maxLines).toBe(7);
  });

  test("a formatter that throws falls back to the default formatter with a warning", async () => {
    const broken: Formatter<unknown> = {
      id: "broken",
      format: () => {
        throw new Error("formatter bug");
      },
    };
    const { read } = harness({ files: { "/a.txt": "one\n" }, deps: { formatter: broken } });
    const result = await read({ path: "/a.txt" });
    expect(result.status).toBe("ok");
    expect(result.notes.at(-1)).toEqual({
      code: "extension-failed",
      severity: "warning",
      message: "The broken formatter failed, so the default formatter formatted this result.",
      data: { extension: "formatter", id: "broken" },
    });
    expect(textOf(result)).toContain("1|one");
    expect(textOf(result)).toContain("[read:extension-failed]");
  });

  test("a formatter that returns neither a string nor an array falls back too", async () => {
    const wrong = { id: "wrong", format: () => 42 } as unknown as Formatter<unknown>;
    const { read } = harness({ files: { "/a.txt": "one\n" }, deps: { formatter: wrong } });
    const result = await read({ path: "/missing.txt" });
    expect(result.status).toBe("error");
    expect(result.notes.map((note) => note.code)).toContain("extension-failed");
    expect(textOf(result)).not.toBe("");
  });
});

describe("textOf", () => {
  test("joins text parts with a newline", () => {
    const result = {
      tool: "read",
      status: "error",
      error: { code: "IO_ERROR", phase: "open", message: "" },
      request: null,
      file: null,
      notes: [],
      content: [
        { type: "text", text: "one" },
        { type: "text", text: "two" },
      ],
    } satisfies ReadResult;
    expect(textOf(result)).toBe("one\ntwo");
  });

  test("the result has no text field", async () => {
    const { read } = harness({ files: { "/a.txt": "one\n" } });
    expect("text" in (await read({ path: "/a.txt" }))).toBe(false);
  });
});
