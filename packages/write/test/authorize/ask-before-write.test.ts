import { describe, expect, test } from "bun:test";

import { askBeforeWrite } from "../../src/index.ts";
import type { PlannedChange } from "../../src/index.ts";
import { errorCode, harness, note, text } from "../helpers.ts";

describe("askBeforeWrite", () => {
  test("allows the access stage and asks once with the whole plan", async () => {
    const plans: (readonly PlannedChange[])[] = [];
    const { fs, write } = harness({
      deps: {
        authorize: askBeforeWrite(async (plan) => {
          plans.push(plan);
          return true;
        }),
      },
    });
    const result = await write({ path: "/a.txt", content: "x" });
    expect(result.status).toBe("ok");
    expect(plans).toHaveLength(1);
    expect(plans[0]?.map((change) => [change.kind, change.displayPath])).toEqual([
      ["create", "/a.txt"],
    ]);
    expect(text(fs, "/a.txt")).toBe("x");
  });

  test("a later target of the same call gets the same answer without a prompt", async () => {
    let prompts = 0;
    const authorizer = askBeforeWrite<unknown>(async () => {
      prompts += 1;
      return true;
    });
    const call = { host: undefined };
    const target = {
      action: "create" as const,
      tool: "write" as const,
      requestedPath: "a",
      resolvedPath: "/a",
      displayPath: "/a",
      change: {} as PlannedChange,
      plan: [],
    };
    const ctx = { call } as never;
    expect(await authorizer.authorize(target, ctx)).toEqual({ allow: true });
    expect(await authorizer.authorize(target, ctx)).toEqual({ allow: true });
    expect(prompts).toBe(1);
    await authorizer.authorize(target, { call: { host: undefined } } as never);
    expect(prompts).toBe(2);
  });

  test("{ content } writes the user's content (W6)", async () => {
    const { fs, write } = harness({
      deps: { authorize: askBeforeWrite(async () => ({ content: "edited by user\n" })) },
    });
    const result = await write({ path: "/a.txt", content: "x" });
    expect(result.changes[0]?.userModified).toBe(true);
    expect(note(result, "user-modified")).toBeDefined();
    expect(text(fs, "/a.txt")).toBe("edited by user\n");
  });

  test.each([
    ["false", async () => false],
    [
      "a throw",
      async () => {
        throw new Error("closed");
      },
    ],
    ["anything else", async () => "sure" as never],
  ])("%s denies", async (_name, prompt) => {
    const { fs, write } = harness({ deps: { authorize: askBeforeWrite(prompt) } });
    const result = await write({ path: "/a.txt", content: "x" });
    expect(errorCode(result)).toBe("DENIED");
    expect(note(result, "denied")?.message).toBe(
      "/a.txt was refused by policy (the user did not approve the change).",
    );
    expect(text(fs, "/a.txt")).toBeNull();
  });

  test("rejects a non-function prompt", () => {
    expect(() => askBeforeWrite(1 as never)).toThrow(TypeError);
  });
});
