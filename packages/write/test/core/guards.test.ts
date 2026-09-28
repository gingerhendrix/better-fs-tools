import { describe, expect, test } from "bun:test";

import type { Guard } from "../../src/index.ts";
import { codes, harness, text } from "../helpers.ts";

describe("guards (section 5.8)", () => {
  test("the default is no guards", async () => {
    const { write } = harness();
    expect((await write({ path: "/a.txt", content: "// ... rest of code" })).status).toBe("ok");
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
    expect(result.error).toEqual({
      code: "GUARD_REFUSED",
      phase: "guards",
      data: { guard: "refuse", path: "/a.txt", source: "placeholder" },
    });
    expect(result.notes[0]?.message).toBe("Send the whole file.");
    expect(ranSecond).toBe(false);
    expect(text(fs, "/a.txt")).toBeNull();
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
    ["a malformed decision", () => ({ allow: false })],
    ["malformed notes", () => ({ allow: true, notes: [{}] })],
  ])("%s is EXTENSION_FAILED with the guard id", async (_name, check) => {
    const { write } = harness({ deps: { guards: [{ id: "bad", check: check as never }] } });
    const result = await write({ path: "/a.txt", content: "x" });
    expect(result.error).toEqual({
      code: "EXTENSION_FAILED",
      phase: "guards",
      data: { extension: "guards", phase: "guards", id: "bad" },
    });
  });
});
