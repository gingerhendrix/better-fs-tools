import { describe, expect, test } from "bun:test";

import { defaultNoteLine, lineNumberFormatter, textOf } from "../../src/index.ts";
import { expectOk, harness } from "../helpers.ts";

describe("lineNumberFormatter", () => {
  test("the gutter and clamp marker are formatter concerns", async () => {
    const { read } = harness({
      files: { "/a.txt": "abcdefgh\n" },
      limits: { maxCharsPerLine: 3 },
      deps: {
        formatter: lineNumberFormatter({
          gutter: (line) => `${String(line.number).padStart(4, " ")}  `,
          clampMarker: () => " >>>",
        }),
      },
    });
    const result = expectOk(await read({ path: "/a.txt" }));
    expect(textOf(result).split("\n")[0]).toBe("   1  abc >>>");
    // The byte ceiling measures source text, not the rendered gutter.
    expect(result.view.bytes).toBe(3);
  });

  test("header and footer wrap the body, notes follow a blank line", async () => {
    const { read } = harness({
      files: { "/a.txt": "one\ntwo\n" },
      deps: {
        formatter: lineNumberFormatter({
          header: (outcome) =>
            outcome.status === "ok" ? `<file ${outcome.file.displayPath}>` : null,
          footer: () => "</file>",
        }),
      },
    });
    const result = await read({ path: "/a.txt", limit: 1 });
    expect(textOf(result)).toBe(
      [
        "<file /a.txt>",
        "1|one",
        "</file>",
        "",
        '[read:continue] Output stopped at the line limit. Continue with {"path":"/a.txt","offset":2,"limit":1}.',
      ].join("\n"),
    );
  });

  test("a null or empty header is left out", async () => {
    const { read } = harness({
      files: { "/a.txt": "one\n" },
      deps: { formatter: lineNumberFormatter({ header: () => null, footer: () => "" }) },
    });
    expect(textOf(await read({ path: "/a.txt" }))).toBe("1|one");
  });

  test("the notes option filters and rewrites notes", async () => {
    const { read } = harness({
      files: { "/a.txt": "one\ntwo\n" },
      limits: { maxLines: 1 },
      deps: {
        formatter: lineNumberFormatter({
          notes: (note) => (note.code === "continue" ? { ...note, message: "more" } : null),
          noteLine: (note) => `(${note.code}: ${note.message})`,
        }),
      },
    });
    const result = await read({ path: "/a.txt" });
    expect(textOf(result)).toBe("1|one\n\n(continue: more)");
    expect(result.notes[0]?.message).not.toBe("more");
  });

  test("notes: () => null hides every note", async () => {
    const { read } = harness({
      files: { "/a.txt": "one\ntwo\n" },
      limits: { maxLines: 1 },
      deps: { formatter: lineNumberFormatter({ notes: () => null }) },
    });
    const result = await read({ path: "/a.txt" });
    expect(textOf(result)).toBe("1|one");
    expect(result.notes.length).toBeGreaterThan(0);
  });

  test("view mode returns the body only", () => {
    const formatter = lineNumberFormatter({ header: () => "HEADER" });
    const text = formatter.format(
      {
        status: "error",
        code: "NOT_FOUND",
        request: null,
        file: null,
        notes: [{ code: "not-found", severity: "warning", message: "gone" }],
      },
      { digest: null, limits: { maxLines: 1 } as never, mode: "view", call: { host: undefined } },
    );
    expect(text).toBe("");
  });

  test("defaultNoteLine prints the code and message", () => {
    expect(defaultNoteLine({ code: "x", severity: "info", message: "hello" })).toBe(
      "[read:x] hello",
    );
  });
});
