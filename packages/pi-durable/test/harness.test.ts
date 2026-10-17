import { describe, expect, test } from "bun:test";

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { createModels } from "@earendil-works/pi-ai/models";
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux";
import {
  createRegistry,
  Harness,
  MemoryStorage,
  ToolResultEntry,
  UserEntry,
} from "@earendil-works/pi-durable";
import type { Extension } from "@earendil-works/pi-durable";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { openNodeJsonlStorage } from "@earendil-works/pi-durable/storage/jsonl/node";
import { CodingTools } from "@earendil-works/pi-durable/tools";

import { shellEnv } from "@better-fs-tools/shell";
import { CODEX_PATCH_GRAMMAR } from "@better-fs-tools/write/patch";
import { freeformPatchSignature } from "@better-fs-tools/write/signature";

import {
  createDurableFsTools,
  documentReadStore,
  durableEnvFileSystem,
  durableEnvRunner,
  ReadStateDoc,
} from "../src/index.ts";
import { context, fixtures } from "./helpers.ts";

const fixture = fixtures();
const MODEL = { provider: "faux", modelId: "faux-1" };

type Call = readonly [name: string, args: Record<string, unknown>];

/** A faux model that makes each call in turn, one per answer, then says "done". */
function fauxModel(calls: readonly Call[]) {
  const faux = fauxProvider();
  const models = createModels();
  models.setProvider(faux.provider);
  faux.setResponses([
    ...calls.map(([name, args], index) =>
      fauxAssistantMessage([fauxToolCall(name, args as never, { id: `c${index}` })], {
        stopReason: "toolUse",
      }),
    ),
    fauxAssistantMessage("done"),
  ]);
  return models;
}

async function openHarness(
  storage: Parameters<typeof Harness.open>[0],
  calls: readonly Call[],
  extensions: readonly Extension[],
) {
  const registry = createRegistry();
  registry.install(CodingTools);
  for (const extension of extensions) registry.install(extension);
  return Harness.open(
    storage,
    {
      models: fauxModel(calls),
      registry,
      env: ({ cwd }) => new NodeExecutionEnv({ cwd: cwd ?? process.cwd() }),
    },
    context,
  );
}

/** The text of each tool result of the conversation, oldest first, with its error flag. */
async function toolResults(root: Awaited<ReturnType<Harness["root"]>>) {
  const page = await root.entries({}, 50, undefined, context);
  return [...page.items]
    .reverse()
    .filter((entry) => ToolResultEntry.is(entry))
    .map((entry) => {
      const message = entry.model![0] as {
        toolName: string;
        isError: boolean;
        content: { type: string; text?: string }[];
      };
      return {
        tool: message.toolName,
        isError: message.isError,
        text: message.content.map((part) => part.text ?? "").join(""),
      };
    });
}

async function run(harness: Harness, cwd: string, prompt: string) {
  const root = await harness.root(context, { agent: { model: MODEL, cwd } });
  const settled = await (
    await root.submit({ type: "input", content: prompt }, context)
  ).wait(context);
  expect(settled.status).toBe("done");
  return root;
}

describe("createDurableFsTools in the Harness", () => {
  test("replaces read, edit, and write of CodingTools; bash stays", async () => {
    const cwd = await fixture({ "a.txt": "one\n" });
    const harness = await openHarness(
      new MemoryStorage(),
      [
        ["read", { path: "a.txt" }],
        ["edit", { path: "a.txt", old_string: "one", new_string: "two" }],
        ["bash", { command: "cat a.txt" }],
      ],
      [createDurableFsTools({ fs: durableEnvFileSystem() })],
    );
    try {
      const root = await run(harness, cwd, "change it");
      const results = await toolResults(root);
      expect(results.map((result) => [result.tool, result.isError])).toEqual([
        ["read", false],
        ["edit", false],
        ["bash", false],
      ]);
      // The Better FS Tools read numbers its lines; Durable's own read does not.
      expect(results[0]?.text).toBe("1|one");
      expect(results[1]?.text).toContain("a.txt");
      expect(results[2]?.text).toContain("two");
      expect(await readFile(path.join(cwd, "a.txt"), "utf8")).toBe("two\n");
    } finally {
      await harness.close(context);
    }
  });

  test("no read-before-write by default, as in every integration", async () => {
    const cwd = await fixture({ "a.txt": "one\n" });
    const harness = await openHarness(
      new MemoryStorage(),
      [["edit", { path: "a.txt", old_string: "one", new_string: "two" }]],
      [createDurableFsTools({ fs: durableEnvFileSystem() })],
    );
    try {
      const root = await run(harness, cwd, "change it");
      expect((await toolResults(root)).at(-1)).toMatchObject({ tool: "edit", isError: false });
      expect(await readFile(path.join(cwd, "a.txt"), "utf8")).toBe("two\n");
    } finally {
      await harness.close(context);
    }
  });

  test("with documentReadStore(), an edit before a read is an error result; the record is a document", async () => {
    const cwd = await fixture({ "a.txt": "one\n" });
    const harness = await openHarness(
      new MemoryStorage(),
      [
        ["edit", { path: "a.txt", old_string: "one", new_string: "two" }],
        ["read", { path: "a.txt" }],
      ],
      [createDurableFsTools({ fs: durableEnvFileSystem(), state: documentReadStore() })],
    );
    try {
      const root = await run(harness, cwd, "change it");
      const [edit] = await toolResults(root);
      expect(edit?.isError).toBe(true);
      expect(edit?.text).toMatch(/^\[edit:not-read\]/u);
      expect(await readFile(path.join(cwd, "a.txt"), "utf8")).toBe("one\n");
      const doc = await harness.snapshot(
        ReadStateDoc,
        root.id,
        `node:local:${path.join(cwd, "a.txt")}`,
        context,
      );
      expect(doc?.record).toMatchObject({ origin: "read", resolvedPath: path.join(cwd, "a.txt") });
    } finally {
      await harness.close(context);
    }
  });

  test("the read record stays after a restart, so the next process can edit", async () => {
    const cwd = await fixture({ "a.txt": "one\n" });
    const directory = await mkdtemp(path.join(tmpdir(), "better-fs-tools-durable-storage-"));
    try {
      const first = await openHarness(
        await openNodeJsonlStorage(directory, context),
        [["read", { path: "a.txt" }]],
        [createDurableFsTools({ fs: durableEnvFileSystem(), state: documentReadStore() })],
      );
      await run(first, cwd, "read it");
      await first.close(context);

      const second = await openHarness(
        await openNodeJsonlStorage(directory, context),
        [["edit", { path: "a.txt", old_string: "one", new_string: "two" }]],
        [createDurableFsTools({ fs: durableEnvFileSystem(), state: documentReadStore() })],
      );
      try {
        const root = await run(second, cwd, "now change it");
        const results = await toolResults(root);
        expect(results.at(-1)).toMatchObject({ tool: "edit", isError: false });
        expect(await readFile(path.join(cwd, "a.txt"), "utf8")).toBe("two\n");
      } finally {
        await second.close(context);
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("a fork keeps the read records its parent had at the fork entry", async () => {
    const cwd = await fixture({ "a.txt": "one\n" });
    const harness = await openHarness(
      new MemoryStorage(),
      [["read", { path: "a.txt" }]],
      [createDurableFsTools({ fs: durableEnvFileSystem(), state: documentReadStore() })],
    );
    try {
      const root = await run(harness, cwd, "read it");
      const page = await root.entries({}, 50, undefined, context);
      const user = page.items.find((entry) => UserEntry.is(entry));
      const last = page.items[0];
      if (user === undefined || last === undefined) throw new Error("no entries");
      const key = `node:local:${path.join(cwd, "a.txt")}`;
      const ownerless = { ownership: { kind: "ownerless" as const } };

      const before = await root.fork(user.id, ownerless, context);
      const after = await root.fork(last.id, ownerless, context);
      expect((await harness.snapshot(ReadStateDoc, before.id, key, context))?.record ?? null).toBe(
        null,
      );
      expect((await harness.snapshot(ReadStateDoc, after.id, key, context))?.record).toMatchObject({
        origin: "read",
      });
    } finally {
      await harness.close(context);
    }
  });

  test("the files stay inside the working directory", async () => {
    const outer = await fixture({ "secret.txt": "no\n", "work/a.txt": "a\n" });
    const harness = await openHarness(
      new MemoryStorage(),
      [
        ["read", { path: "../secret.txt" }],
        ["write", { path: "../made.txt", content: "x\n" }],
      ],
      [createDurableFsTools({ fs: durableEnvFileSystem(), state: null })],
    );
    try {
      const root = await run(harness, path.join(outer, "work"), "escape");
      const results = await toolResults(root);
      expect(results.map((result) => result.isError)).toEqual([true, true]);
      expect(results[0]?.text).toMatch(/^\[read:outside-allowed-roots\]/u);
    } finally {
      await harness.close(context);
    }
  });

  test("bash with durableEnvRunner() runs over the environment, with the shared signature", async () => {
    const cwd = await fixture({ "sub/b.txt": "b\n" });
    const harness = await openHarness(
      new MemoryStorage(),
      [
        ["bash", { command: "echo hi" }],
        ["bash", { command: "exit 4" }],
        ["bash", { command: "pwd", cwd: "sub", timeout: 5_000 }],
      ],
      [
        createDurableFsTools({
          fs: durableEnvFileSystem(),
          bash: { runner: durableEnvRunner(), env: shellEnv() },
        }),
      ],
    );
    try {
      const root = await run(harness, cwd, "run");
      const results = await toolResults(root);
      expect(results.map((result) => [result.tool, result.isError])).toEqual([
        ["bash", false],
        ["bash", true],
        ["bash", false],
      ]);
      expect(results[0]?.text).toMatch(/^Exit code 0 · [\d.]+ s\nhi$/u);
      expect(results[2]?.text).toContain(path.join(cwd, "sub"));
    } finally {
      await harness.close(context);
    }
  });

  test("a signature with a grammar reaches the model as constrainedSampling", async () => {
    const cwd = await fixture();
    const faux = fauxProvider();
    const models = createModels();
    models.setProvider(faux.provider);
    const seen: Record<string, unknown> = {};
    faux.setResponses([
      (request) => {
        for (const message of request.messages) {
          if (message.role !== "system") continue;
          for (const tool of message.toolsAdded ?? []) seen[tool.name] = tool.constrainedSampling;
        }
        return fauxAssistantMessage("done");
      },
    ]);
    const registry = createRegistry();
    registry.install(CodingTools);
    registry.install(
      createDurableFsTools({
        fs: durableEnvFileSystem(),
        applyPatch: { signature: freeformPatchSignature() },
      }),
    );
    const harness = await Harness.open(
      new MemoryStorage(),
      {
        models,
        registry,
        env: ({ cwd: dir }) => new NodeExecutionEnv({ cwd: dir ?? process.cwd() }),
      },
      context,
    );
    try {
      await run(harness, cwd, "patch it");
      expect(seen.apply_patch).toEqual({
        type: "grammar",
        variants: { openai_lark: CODEX_PATCH_GRAMMAR },
      });
      // Tools with no grammar keep the Harness default.
      expect(seen.edit).toBeUndefined();
    } finally {
      await harness.close(context);
    }
  });

  test("a call without an execution environment is an error result", async () => {
    const registry = createRegistry();
    registry.install(createDurableFsTools({ fs: durableEnvFileSystem() }));
    const harness = await Harness.open(
      new MemoryStorage(),
      { models: fauxModel([["read", { path: "a.txt" }]]), registry },
      context,
    );
    try {
      const root = await harness.root(context, { agent: { model: MODEL } });
      await (await root.submit({ type: "input", content: "read" }, context)).wait(context);
      const [read] = await toolResults(root);
      expect(read).toMatchObject({ tool: "read", isError: true });
      expect(read?.text).toContain("needs an execution environment");
    } finally {
      await harness.close(context);
    }
  });

  test("checks its options as createFsTools() does", () => {
    const fs = durableEnvFileSystem();
    expect(() => createDurableFsTools({ fs, cwd: "/" } as never)).toThrow(
      "Unknown createDurableFsTools option: cwd",
    );
    expect(() => createDurableFsTools({} as never)).toThrow(TypeError);
    expect(() => createDurableFsTools({ fs, bash: true } as never)).toThrow(
      "createDurableFsTools bash must be an object with a runner and an env",
    );
    expect(() => createDurableFsTools({ fs, allowedRoots: ["."] } as never)).toThrow(
      "Unknown createDurableFsTools option: allowedRoots",
    );
    const names = createDurableFsTools({
      fs,
      applyPatch: true,
      bash: { runner: durableEnvRunner(), env: shellEnv() },
    }).tools?.map((tool) => tool.name);
    expect(names).toEqual(["read", "edit", "write", "apply_patch", "bash"]);
  });

  test("the helpers refuse a context in their options", () => {
    expect(() => durableEnvFileSystem({ context } as never)).toThrow(
      "durableEnvFileSystem options cannot set context",
    );
    expect(() => durableEnvRunner({ context } as never)).toThrow(
      "durableEnvRunner options cannot set context",
    );
  });
});
