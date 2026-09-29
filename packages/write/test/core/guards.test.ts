import { describe, expect, test } from "bun:test";

import type { Guard } from "../../src/index.ts";
import { errorOf, codes, errorCode, harness, text } from "../helpers.ts";

describe("guards (section 5.8)", () => {
  test("the default guards are on, and guards: [] turns them off", async () => {
    const files = { "/a.ts": "const a = 1;\nconst b = 2;\nconst c = 3;\n" };
    const content = "const a = 1;\n// ... rest of code\n";
    const on = harness({ files });
    await on.read({ path: "/a.ts" });
    expect(errorCode(await on.write({ path: "/a.ts", content }))).toBe("GUARD_REFUSED");
    const off = harness({ files, deps: { guards: [] } });
    await off.read({ path: "/a.ts" });
    expect((await off.write({ path: "/a.ts", content })).status).toBe("ok");
  });

  test("guards run in order, and allow notes are kept", async () => {
    const order: string[] = [];
    const guard = (id: string): Guard<unknown> => ({
      id,
      check: () => {
        order.push(id);
        return { allow: true, notes: [{ code: id, severity: "info", message: id }] };
      },
    });
    const { write } = harness({ deps: { guards: [guard("first"), guard("second")] } });
    const result = await write({ path: "/a.txt", content: "x" });
    expect(order).toEqual(["first", "second"]);
    expect(codes(result)).toEqual(["first", "second"]);
  });

  test("the first refusal is GUARD_REFUSED with the guard's message, and later guards do not run", async () => {
    let ranSecond = false;
    const { fs, write } = harness({
      deps: {
        guards: [
          {
            id: "refuse",
            check: () => ({
              allow: false,
              note: { code: "placeholder", severity: "warning", message: "Send the whole file." },
            }),
          },
          {
            id: "second",
            check: () => {
              ranSecond = true;
              return { allow: true };
            },
          },
        ],
      },
    });
    const result = await write({ path: "/a.txt", content: "x" });
    expect(errorOf(result)).toEqual({
      message: expect.any(String),
      code: "GUARD_REFUSED",
      phase: "guards",
      data: { guard: "refuse", path: "/a.txt", source: "placeholder" },
    });
    expect(result.notes[0]?.message).toBe("Send the whole file.");
    expect(ranSecond).toBe(false);
    expect(text(fs, "/a.txt")).toBeNull();
  });

  test("a refusal without a note gets the default guard-refused note", async () => {
    const { write } = harness({
      deps: { guards: [{ id: "quiet", check: () => ({ allow: false }) }] },
    });
    const result = await write({ path: "/a.txt", content: "x" });
    expect(result.notes).toEqual([
      {
        code: "guard-refused",
        severity: "warning",
        message: "The quiet check refused the change to /a.txt.",
        data: { guard: "quiet", path: "/a.txt" },
      },
    ]);
    expect(errorOf(result)).toMatchObject({ code: "GUARD_REFUSED", phase: "guards" });
  });

  test("guards get the classifiers", async () => {
    let count = -1;
    const { write } = harness({
      deps: {
        guards: [
          {
            id: "look",
            check: (_change, ctx) => {
              count = ctx.classifiers.length;
              return { allow: true };
            },
          },
        ],
      },
    });
    await write({ path: "/a.txt", content: "x" });
    expect(count).toBeGreaterThan(0);
  });

  test.each([
    [
      "a throw",
      () => {
        throw new Error("boom");
      },
    ],
    ["a malformed note", () => ({ allow: false, note: { code: 1 } })],
    ["malformed notes", () => ({ allow: true, notes: [{}] })],
  ])("%s is EXTENSION_FAILED with the guard id", async (_name, check) => {
    const { write } = harness({ deps: { guards: [{ id: "bad", check: check as never }] } });
    const result = await write({ path: "/a.txt", content: "x" });
    expect(errorOf(result)).toEqual({
      message: expect.any(String),
      code: "EXTENSION_FAILED",
      phase: "guards",
      data: { extension: "guards", phase: "guards", id: "bad" },
    });
  });
});
