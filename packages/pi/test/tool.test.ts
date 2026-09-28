import { describe, expect, test } from "bun:test";

import { createReadToolDefinition as createBuiltInPiReadTool } from "@earendil-works/pi-coding-agent";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { nodeFileSystem } from "@better-fs-tools/node";
import {
  askUser,
  createReadTool,
  denyPaths,
  jsonFormatter,
  lineNumberFormatter,
  textOf as coreText,
  unicodeRepair,
} from "@better-fs-tools/read";
import type {
  ContentPart,
  ReadFormatContext,
  ReadFormatter,
  ReadContext,
} from "@better-fs-tools/read";
import { defaultReadSignature, lineRangeSignature } from "@better-fs-tools/read/signature";

import { createPiReadTool } from "../src/index.ts";
import { execute, fixtures, piContext, textOf } from "./helpers.ts";

const fixture = fixtures();

describe("pi tool shape", () => {
  test("matches Pi's built-in read name, label, prompt text, and parameter keys", () => {
    const tool = createPiReadTool();
    const builtIn = createBuiltInPiReadTool(process.cwd());

    expect(tool.name).toBe("read");
    expect(tool.name).toBe(builtIn.name);
    expect(tool.label).toBe("read");
    expect(tool.label).toBe(builtIn.label);
    expect(tool.promptSnippet).toBe("Read file contents");
    expect(tool.promptSnippet).toBe(builtIn.promptSnippet as string);
    expect(tool.promptGuidelines).toEqual(["Use read to examine files instead of cat or sed."]);
    expect(tool.promptGuidelines).toEqual(builtIn.promptGuidelines as string[]);
    expect(tool.description).toBe(defaultReadSignature().description);

    const parameters = tool.parameters as unknown as {
      type: string;
      required: string[];
      properties: Record<string, { type: string; description?: string }>;
    };
    const builtInParameters = builtIn.parameters as unknown as typeof parameters;
    expect(parameters.type).toBe(builtInParameters.type);
    expect(parameters.required).toEqual(builtInParameters.required);
    expect(Object.keys(parameters.properties)).toEqual(Object.keys(builtInParameters.properties));
    // G7: one default schema. Pi's built-in says "number"; the signature says "integer".
    expect(parameters.properties.offset?.type).toBe("integer");
    expect(parameters.properties.limit?.type).toBe("integer");

    // Pi's inherited read renderer is the point of the details record, so
    // neither hook may be present, not even as an undefined own property.
    expect(Object.hasOwn(tool, "renderCall")).toBe(false);
    expect(Object.hasOwn(tool, "renderResult")).toBe(false);
    expect(Object.hasOwn(builtIn, "renderCall")).toBe(true);
  });

  test("parameters are Type.Unsafe of the signature schema", () => {
    const signature = lineRangeSignature({ name: "view_file", names: { path: "file_path" } });
    const tool = createPiReadTool({ signature });

    expect(tool.name).toBe("view_file");
    expect(tool.label).toBe("view_file");
    expect(tool.description).toBe(signature.description);
    expect({ ...tool.parameters }).toEqual({ ...signature.schema });
  });

  test("prompt options replace the defaults", () => {
    const tool = createPiReadTool({ promptSnippet: "Read", promptGuidelines: ["Prefer read."] });
    expect(tool.promptSnippet).toBe("Read");
    expect(tool.promptGuidelines).toEqual(["Prefer read."]);
  });

  test("rejects fs, cwd, and allowedRoots", () => {
    for (const key of ["fs", "cwd", "allowedRoots"]) {
      expect(() => createPiReadTool({ [key]: undefined } as never)).toThrow(
        `Pi read tool options cannot set ${key}`,
      );
    }
    expect(() => createPiReadTool(null as never)).toThrow(TypeError);
    expect(() => createPiReadTool([] as never)).toThrow(TypeError);
    expect(() => createPiReadTool({ input: {} } as never)).toThrow(
      "Unknown read tool dependency: input",
    );
  });
});

describe("pi model-facing output", () => {
  test("forwards Pi's abort signal", async () => {
    const root = await fixture({ "large.txt": "alpha\n".repeat(400_000) });
    const controller = new AbortController();
    const pending = execute(createPiReadTool(), { path: "large.txt" }, root, controller.signal);
    setImmediate(() => controller.abort());

    expect(textOf(await pending)).toMatch(/^\[read:aborted\]/u);
  });

  test("works when Pi supplies no signal", async () => {
    const root = await fixture({ "a.txt": "alpha" });
    expect(textOf(await execute(createPiReadTool(), { path: "a.txt" }, root))).toBe("1|alpha");
  });

  test("content mirrors the core result for every status", async () => {
    const root = await fixture({
      "text.txt": "alpha\nbeta\n",
      "empty.txt": "",
      "binary.bin": new Uint8Array([0, 1, 2, 3, 0, 255]),
      "dir/file.txt": "nested",
    });
    const tool = createPiReadTool();
    const read = createReadTool({ fs: nodeFileSystem({ cwd: root, allowedRoots: [root] }) });

    const statuses: string[] = [];
    const inputs: { path: string; limit?: number }[] = [
      { path: "text.txt", limit: 1 },
      { path: "empty.txt" },
      { path: "binary.bin" },
      { path: "missing.txt" },
      { path: "dir" },
    ];
    for (const input of inputs) {
      const canonical = await read(input);
      const actual = await execute(tool, input, root);
      statuses.push(canonical.status);
      expect(actual.content).toEqual([{ type: "text", text: coreText(canonical) }]);
    }
    expect(statuses).toEqual(["ok", "ok", "unsupported", "error", "error"]);
  });

  test("toRead refusals throw TypeError that names host parameters", async () => {
    const root = await fixture({ "a.txt": "alpha" });
    await expect(execute(createPiReadTool(), { file_path: "a.txt" }, root)).rejects.toThrow(
      "Unknown read input key: file_path. Expected path, offset, limit",
    );
    const range = createPiReadTool({ signature: lineRangeSignature() });
    await expect(execute(range, { path: "a.txt", start: 3, end: 2 }, root)).rejects.toThrow(
      "end (2) must not be less than start (3)",
    );
  });

  test("continuation text uses host names; the retry note stays canonical", async () => {
    const root = await fixture({ "a.txt": "one\ntwo\nthree\nfour\n" });
    const tool = createPiReadTool({
      signature: lineRangeSignature({
        names: { path: "file_path", start: "start_line", end: "end_line" },
      }),
    });
    const result = await execute(tool, { file_path: "a.txt", end_line: 2 }, root);

    expect(textOf(result)).toBe(
      '1|one\n2|two\n\n[read:continue] Output stopped at the line limit. Continue with {"file_path":"a.txt","start_line":3,"end_line":4}.',
    );
    expect(result.details.truncation?.maxLines).toBe(2);
  });
});

describe("pi resolve and suggest", () => {
  test("a miss suggests real neighbours under ctx.cwd", async () => {
    const root = await fixture({ "src/index.ts": "x\n" });
    const result = await execute(createPiReadTool(), { path: "src/index.tsx" }, root);
    expect(textOf(result)).toBe(
      '[read:not-found] src/index.tsx was not found. Nearby names: "index.ts".',
    );
  });

  test("a host-free unicodeRepair opens the real name and discloses it", async () => {
    const root = await fixture({ "report\u202f2026.txt": "q1\n" });
    const tool = createPiReadTool({ resolve: unicodeRepair() });
    const text = textOf(await execute(tool, { path: "report 2026.txt" }, root));
    expect(text).toStartWith("1|q1");
    expect(text).toContain("[read:path-repaired]");
  });
});

describe("pi authorize", () => {
  test("askUser asks through ctx.ui.confirm and a refusal gives DENIED", async () => {
    const root = await fixture({ "a.txt": "one\n" });
    const asked: string[] = [];
    let answer = false;
    const ctx = {
      cwd: root,
      ui: {
        confirm: async (title: string, message: string) => {
          asked.push(`${title}: ${message}`);
          return answer;
        },
      },
    } as unknown as ExtensionContext;
    const tool = createPiReadTool({
      authorize: askUser((target, hook) => hook.call.host.ui.confirm("Read", target.displayPath)),
    });

    const refused = await tool.execute("call-1", { path: "a.txt" }, undefined, undefined, ctx);
    expect(textOf(refused)).toBe(
      "[read:denied] a.txt was refused by policy (the user did not approve the read).",
    );
    expect(refused.details).toEqual({});
    answer = true;
    const allowed = await tool.execute("call-2", { path: "a.txt" }, undefined, undefined, ctx);
    expect(textOf(allowed)).toBe("1|one");
    expect(asked).toEqual(["Read: a.txt", "Read: a.txt"]);
  });

  test("a host-free denyPaths also denies the suggestion listing", async () => {
    const root = await fixture({ "secrets/key.txt": "k\n" });
    const tool = createPiReadTool({ authorize: denyPaths(["**/secrets", "**/secrets/**"]) });
    expect(textOf(await execute(tool, { path: "secrets/key.txt" }, root))).toStartWith(
      "[read:denied]",
    );
    expect(textOf(await execute(tool, { path: "secrets/key.tx" }, root))).toBe(
      "[read:not-found] secrets/key.tx was not found.",
    );
  });
});

describe("pi host context", () => {
  test("the formatter gets the same call object in model and view mode, with ctx as host", async () => {
    const root = await fixture({ "a.txt": "one\ntwo\nthree\n" });
    const seen: ReadFormatContext<ExtensionContext>[] = [];
    const base = lineNumberFormatter();
    const formatter: ReadFormatter<ExtensionContext> = {
      id: "spy",
      format(outcome, ctx) {
        seen.push(ctx);
        return base.format(outcome, ctx);
      },
    };
    const tool = createPiReadTool({ formatter });
    const ctx = piContext(root);
    const signal = new AbortController().signal;

    await tool.execute("call-9", { path: "a.txt", limit: 1 }, signal, undefined, ctx);
    expect(seen.map((entry) => entry.mode)).toEqual(["model", "view"]);
    expect(seen[0]?.call).toBe(seen[1]?.call as ReadContext<ExtensionContext>);
    expect(seen[0]?.call.host).toBe(ctx);
    expect(seen[0]?.call.callId).toBe("call-9");
    expect(seen[0]?.call.signal).toBe(signal);
  });

  test("the state factory gets ctx as host", async () => {
    const root = await fixture({ "a.txt": "one\n" });
    const hosts: ExtensionContext[] = [];
    const tool = createPiReadTool({
      state: (call) => {
        hosts.push(call.host);
        return null;
      },
    });
    const ctx = piContext(root);
    await tool.execute("call-1", { path: "a.txt" }, undefined, undefined, ctx);
    expect(hosts).toEqual([ctx]);
    expect(hosts[0]).toBe(ctx);
  });

  test("the resolver and suggest get the same call object, with ctx as host", async () => {
    const root = await fixture({ "a.txt": "one\n" });
    const calls: ReadContext<ExtensionContext>[] = [];
    const tool = createPiReadTool({
      resolve: {
        id: "spy",
        resolve(path, ctx) {
          calls.push(ctx.call);
          return { kind: "path", path };
        },
      },
      suggest: (ctx) => {
        calls.push(ctx.call);
        return [];
      },
    });
    const ctx = piContext(root);
    await tool.execute("call-2", { path: "b.txt" }, undefined, undefined, ctx);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toBe(calls[1]);
    expect(calls[0]?.host).toBe(ctx);
  });

  test("the authorizer gets ctx as host for a list and for a read", async () => {
    const root = await fixture({ "a.txt": "one\n" });
    const calls: ReadContext<ExtensionContext>[] = [];
    const tool = createPiReadTool({
      authorize: {
        id: "spy",
        authorize(_target, ctx) {
          calls.push(ctx.call);
          return { allow: true };
        },
      },
    });
    const ctx = piContext(root);
    await tool.execute("call-3", { path: "a.txt" }, undefined, undefined, ctx);
    await tool.execute("call-3", { path: "b.txt" }, undefined, undefined, ctx);
    expect(calls).toHaveLength(2);
    expect(calls[0]?.host).toBe(ctx);
    expect(calls[1]?.host).toBe(ctx);
  });

  test("hooks get the same call object, with ctx as host", async () => {
    const root = await fixture({ "a.txt": "one\n" });
    const calls: ReadContext<ExtensionContext>[] = [];
    const tool = createPiReadTool({
      hooks: [
        {
          id: "spy",
          afterRead(outcome, ctx) {
            calls.push(ctx.call);
            return outcome;
          },
        },
      ],
    });
    const ctx = piContext(root);
    await tool.execute("call-4", { path: "a.txt" }, undefined, undefined, ctx);
    await tool.execute("call-4", { path: "b.txt" }, undefined, undefined, ctx);
    expect(calls).toHaveLength(2);
    expect(calls[0]?.host).toBe(ctx);
    expect(calls[1]?.host).toBe(ctx);
  });

  test("rejects an execution without a usable ctx.cwd", async () => {
    const tool = createPiReadTool();
    for (const ctx of [null, undefined, {}, { cwd: "" }, { cwd: 7 }]) {
      await expect(
        tool.execute("pi-read-call", { path: "a.txt" }, undefined, undefined, ctx as never),
      ).rejects.toThrow("Pi read execution requires ctx.cwd");
    }
  });
});

describe("pi custom formatter", () => {
  test("details take their content from view mode", async () => {
    const root = await fixture({ "a.txt": "one\ntwo\nthree\n" });
    const formatter: ReadFormatter<unknown> = {
      id: "modes",
      format: (outcome, ctx) =>
        `${ctx.mode}:${outcome.status === "ok" ? outcome.view.lines.map((line) => line.text).join(",") : ""}`,
    };
    const result = await execute(
      createPiReadTool({ formatter }),
      { path: "a.txt", limit: 2 },
      root,
    );

    expect(textOf(result)).toBe("model:one,two");
    expect(result.details.truncation?.content).toBe("view:one,two");
    expect(result.details.truncation?.truncatedBy).toBe("lines");
  });

  test("a formatter that throws still returns the file, with a warning", async () => {
    const root = await fixture({ "a.txt": "one\ntwo\nthree\n" });
    const formatter: ReadFormatter<unknown> = {
      id: "broken",
      format: () => {
        throw new Error("format failed");
      },
    };
    const result = await execute(
      createPiReadTool({ formatter }),
      { path: "a.txt", limit: 2 },
      root,
    );

    expect(textOf(result)).toContain("1|one");
    expect(textOf(result)).toContain("[read:extension-failed]");
  });

  test("a formatter that returns parts gives {} details", async () => {
    const root = await fixture({ "a.txt": "one\ntwo\nthree\n" });
    const formatter: ReadFormatter<unknown> = {
      id: "parts",
      format: (outcome): readonly ContentPart[] => [{ type: "text", text: outcome.status }],
    };
    const result = await execute(
      createPiReadTool({ formatter }),
      { path: "a.txt", limit: 2 },
      root,
    );

    expect(result.content).toEqual([{ type: "text", text: "ok" }]);
    expect(result.details).toEqual({});
  });

  test("jsonFormatter details carry its view-mode JSON", async () => {
    const root = await fixture({ "a.txt": "one\ntwo\nthree\n" });
    const tool = createPiReadTool({ formatter: jsonFormatter() });
    const result = await execute(tool, { path: "a.txt", limit: 1 }, root);
    const view = result.details.truncation?.content ?? "";

    expect(() => JSON.parse(view)).not.toThrow();
    expect(textOf(result)).not.toBe(view);
  });
});
