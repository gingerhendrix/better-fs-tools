import { describe, expect, test } from "bun:test";

import type { ToolRenderers } from "@earendil-works/pi-coding-agent";

import {
  createPiApplyPatchTool,
  createPiBashTool,
  createPiEditTool,
  createPiReadTool,
  createPiWriteTool,
  piToolRenderers,
} from "../src/index.ts";

type Call = NonNullable<ToolRenderers["renderCall"]>;
type Result = NonNullable<ToolRenderers["renderResult"]>;

/** A stand-in for Pi's built-in renderer: it records the arguments it gets. */
function spyRenderers() {
  const calls: unknown[] = [];
  const results: unknown[] = [];
  const renderers: ToolRenderers = {
    renderCall: ((args, _theme, context) => {
      calls.push({ args, contextArgs: context.args });
      return {} as never;
    }) as Call,
    renderResult: ((_result, _options, _theme, context) => {
      results.push(context.args);
      return {} as never;
    }) as Result,
  };
  return { calls, results, renderers };
}

function draw(resolver: ReturnType<typeof piToolRenderers>, name: string, args: unknown) {
  const spy = spyRenderers();
  const resolved = resolver(name, () => spy.renderers);
  const context = { args, cwd: "/", state: {} } as never;
  resolved?.renderCall?.(args as never, {} as never, context);
  resolved?.renderResult?.({ content: [], details: undefined }, {} as never, {} as never, context);
  return spy;
}

describe("piToolRenderers", () => {
  test("gives Pi's edit renderer { path, edits } for the shared edit signature", () => {
    const edit = createPiEditTool();
    const spy = draw(piToolRenderers([edit]), "edit", {
      path: "a.txt",
      old_string: "one",
      new_string: "two",
    });
    const expected = { path: "a.txt", edits: [{ oldText: "one", newText: "two" }] };
    expect(spy.calls).toEqual([{ args: expected, contextArgs: expected }]);
    expect(spy.results).toEqual([expected]);
  });

  test("a replace-all edit gets only the path, so Pi shows the diff of the result", () => {
    const spy = draw(piToolRenderers([createPiEditTool()]), "edit", {
      path: "a.txt",
      old_string: "a",
      new_string: "b",
      replace_all: true,
    });
    expect(spy.calls).toEqual([{ args: { path: "a.txt" }, contextArgs: { path: "a.txt" } }]);
  });

  test("gives Pi's bash renderer the timeout in seconds", () => {
    const spy = draw(piToolRenderers([createPiBashTool()]), "bash", {
      command: "ls",
      timeout: 1_500,
      cwd: "sub",
    });
    expect(spy.calls).toEqual([
      { args: { command: "ls", timeout: 1.5 }, contextArgs: { command: "ls", timeout: 1.5 } },
    ]);
  });

  test("read and write get the canonical input, which has Pi's names", () => {
    const resolver = piToolRenderers([createPiReadTool(), createPiWriteTool()]);
    expect(draw(resolver, "read", { path: "a.txt", offset: 2 }).calls).toEqual([
      { args: { path: "a.txt", offset: 2 }, contextArgs: { path: "a.txt", offset: 2 } },
    ]);
    expect(draw(resolver, "write", { path: "a.txt", content: "x" }).calls).toEqual([
      { args: { path: "a.txt", content: "x" }, contextArgs: { path: "a.txt", content: "x" } },
    ]);
  });

  test("arguments that do not parse yet go to the renderer as they are", () => {
    const partial = { path: "a.txt", old_string: "on" };
    const spy = draw(piToolRenderers([createPiEditTool()]), "edit", partial);
    expect(spy.calls).toEqual([{ args: partial, contextArgs: partial }]);
  });

  test("other tools, apply_patch, and tools without a renderer are left as they are", () => {
    const resolver = piToolRenderers([createPiApplyPatchTool(), createPiEditTool()]);
    const base = spyRenderers().renderers;
    expect(resolver("apply_patch", () => base)).toBe(base);
    expect(resolver("grep", () => base)).toBe(base);
    expect(resolver("edit", () => undefined)).toBeUndefined();
  });
});
