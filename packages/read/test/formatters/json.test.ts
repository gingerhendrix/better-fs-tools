import { describe, expect, test } from "bun:test";

import { jsonFormatter, textOf } from "../../src/index.ts";
import { harness } from "../helpers.ts";

describe("jsonFormatter", () => {
  test("round-trips the outcome", async () => {
    const { read } = harness({
      files: { "/a.txt": "alpha\n" },
      deps: { formatter: jsonFormatter() },
    });
    const result = await read({ path: "/a.txt" });
    const parsed = JSON.parse(textOf(result));
    expect(parsed.status).toBe("ok");
    expect(parsed.view.lines[0].text).toBe("alpha");
    expect(parsed.content).toBeUndefined();
  });

  test("pick chooses the JSON fields", async () => {
    const { read } = harness({
      files: { "/a.txt": "alpha\n" },
      deps: {
        formatter: jsonFormatter({
          pick: (outcome) => ({ status: outcome.status, notes: outcome.notes.length }),
          space: 1,
        }),
      },
    });
    expect(textOf(await read({ path: "/a.txt" }))).toBe('{\n "status": "ok",\n "notes": 0\n}');
  });

  test('notes "after" moves notes out of the JSON into note lines', async () => {
    const { read } = harness({
      files: { "/a.txt": "one\ntwo\n" },
      limits: { maxLines: 1 },
      deps: {
        formatter: jsonFormatter({
          pick: (outcome) => ({ status: outcome.status, notes: outcome.notes.map((n) => n.code) }),
          notes: "after",
        }),
      },
    });
    const text = textOf(await read({ path: "/a.txt" }));
    const [json, notes] = text.split("\n\n");
    expect(JSON.parse(json ?? "")).toEqual({ status: "ok" });
    expect(notes).toStartWith("[read:continue] ");
  });

  test("view mode leaves notes out", () => {
    const text = jsonFormatter().format(
      {
        status: "error",
        code: "NOT_FOUND",
        request: null,
        file: null,
        notes: [{ code: "not-found", severity: "warning", message: "gone" }],
      },
      { digest: null, limits: { maxLines: 1 } as never, mode: "view", call: { host: undefined } },
    );
    expect(JSON.parse(text as string)).toEqual({
      status: "error",
      code: "NOT_FOUND",
      request: null,
      file: null,
    });
  });
});
