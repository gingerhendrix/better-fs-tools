# @better-fs-tools/ai-sdk

The Better Read tool and the `edit`, `write`, and `apply_patch` tools for [AI SDK 7](https://ai-sdk.dev). Each factory gives a tool object that you put in a `ToolSet`.

## Install

```sh
npm install @better-fs-tools/ai-sdk @better-fs-tools/read @better-fs-tools/write ai
```

`ai` is a required peer (`^7.0.77`). Add a filesystem package too, for example `@better-fs-tools/node` or `@better-fs-tools/cloudflare-shell`.

## Example

```ts
import { generateText, isStepCount } from "ai";
import type { LanguageModel } from "ai";
import { createAiSdkReadTool } from "@better-fs-tools/ai-sdk";
import { nodeDigest, nodeFileSystem } from "@better-fs-tools/node";
import { lineRangeSignature } from "@better-fs-tools/read/signature";

const cwd = process.cwd();
const read = createAiSdkReadTool({
  fs: nodeFileSystem({ cwd, allowedRoots: [cwd] }),
  digest: nodeDigest(),
  signature: lineRangeSignature({
    name: "read_file",
    names: { path: "file_path", start: "start_line", end: "end_line" },
  }),
});

export async function ask(model: LanguageModel, prompt: string): Promise<string> {
  const result = await generateText({
    model,
    prompt,
    tools: { [read.name]: read },
    stopWhen: isStepCount(5),
  });
  return result.text;
}
```

## What the tool does

- `createAiSdkReadTool(options)` takes every `createReadTool()` option, plus `signature`. `fs` is required. `digest` defaults to `null`, as in the core.
- The model sees the signature's name, description, and JSON Schema. The tool is `strict: true`. For strict mode, the provider schema lists every property in `required`, makes each optional property nullable, and sets `additionalProperties: false` on every object. The tool maps a `null` back to an absent parameter before the signature reads the input. The default signature is `defaultReadSignature()`: `read` with `path`, `offset`, and `limit`.
- The schema's `validate` hook runs `signature.toInput` and then the core input check. A refusal names the host's parameters, and `generateText` reports it as a tool error.
- `execute` passes AI SDK's `ToolExecutionOptions` object to the core as `ctx.call.host`, with `abortSignal` as the signal and `toolCallId` as `callId`. Host functions can read `ctx.call.host.context`. `execute` returns the whole `ReadResult`. If `toInput` refuses an input that reached `execute`, `execute` rejects with that `TypeError`.
- Retry text in notes uses the signature's names. `result.continuation.next` stays canonical.
- `toModelOutput` maps text parts to text parts, and media parts to base64 `file` parts. `toAiSdkOutput(result)` does the same mapping for your own tool.

For a Cloudflare Agents host, pass `fs: cloudflareShellFileSystem(workspace, { allowedRoots: [root] })` from `@better-fs-tools/cloudflare-shell`. No other wrapper is needed.

## Write tools

`createAiSdkEditTool()`, `createAiSdkWriteTool()`, and `createAiSdkApplyPatchTool()` wrap the tools from [`@better-fs-tools/write`](https://www.npmjs.com/package/@better-fs-tools/write). Give the read tool and the write tools the same `state` and `digest`, so `edit` and `write` know what the model has read:

```ts
import { generateText, isStepCount } from "ai";
import type { LanguageModel } from "ai";
import {
  createAiSdkApplyPatchTool,
  createAiSdkEditTool,
  createAiSdkReadTool,
  createAiSdkWriteTool,
} from "@better-fs-tools/ai-sdk";
import { nodeDigest, nodeFileSystem } from "@better-fs-tools/node";
import { createMemoryStore } from "@better-fs-tools/read";
import { memoryLocks } from "@better-fs-tools/write";

const cwd = process.cwd();
// One filesystem, store, and digest for all four tools. One lock manager for the three writers.
const shared = {
  fs: nodeFileSystem({ cwd, allowedRoots: [cwd] }),
  state: createMemoryStore(),
  digest: nodeDigest(),
};
const locks = memoryLocks();

const read = createAiSdkReadTool(shared);
const edit = createAiSdkEditTool({ ...shared, locks });
const write = createAiSdkWriteTool({ ...shared, locks });
const applyPatch = createAiSdkApplyPatchTool({ ...shared, locks });

export async function change(model: LanguageModel, prompt: string): Promise<string> {
  const result = await generateText({
    model,
    prompt,
    tools: {
      [read.name]: read,
      [edit.name]: edit,
      [write.name]: write,
      [applyPatch.name]: applyPatch,
    },
    stopWhen: isStepCount(10),
  });
  return result.text;
}
```

- Each factory takes every option of its core factory, plus `signature`. `fs` is required. `state` and `digest` default to `null`, so without them every update carries a `read-before-write-off` note. A `state` needs a `digest`: the options type refuses one without the other, and the factory throws `TypeError`.
- The default signatures are `defaultEditSignature()` (`edit` with `path`, `old_string`, `new_string`, and `replace_all`), `defaultWriteSignature()` (`write` with `path` and `content`), and `defaultPatchSignature()` (`apply_patch` with `patch`). Error texts use the signature's names.
- The tools are `strict: true`. The schema's `validate` hook runs `signature.toInput` and the core input check.
- `execute` passes the `ToolExecutionOptions` object as `ctx.call.host`, and returns the whole `MutationResult`. `toModelOutput` gives the model the formatter's text.
- AI SDK tools take JSON only. A signature with a grammar, such as `freeformPatchSignature()`, still works, but the grammar is not sent.

## Bash tool

`createAiSdkBashTool({ runner, env })` adapts the `bash` tool from [`@better-fs-tools/shell`](https://www.npmjs.com/package/@better-fs-tools/shell). This package starts no process and reads no `process.env`, so `runner` and `env` are required. The default signature takes the timeout in milliseconds and names the runner in the description.

```ts
import { generateText, isStepCount } from "ai";
import type { LanguageModel } from "ai";
import { createAiSdkBashTool } from "@better-fs-tools/ai-sdk";
import { nodeCommandRunner } from "@better-fs-tools/node";
import { shellEnv } from "@better-fs-tools/shell";

// The AI SDK package starts no process. Give it a runner.
const bash = createAiSdkBashTool({
  runner: nodeCommandRunner(),
  env: shellEnv(() => process.env),
});

export async function run(model: LanguageModel, prompt: string): Promise<string> {
  const result = await generateText({
    model,
    prompt,
    tools: { [bash.name]: bash },
    stopWhen: isStepCount(5),
  });
  return result.text;
}
```

## Links

- [`@better-fs-tools/read`](https://www.npmjs.com/package/@better-fs-tools/read): every read option, and the signature builders
- [`@better-fs-tools/write`](https://www.npmjs.com/package/@better-fs-tools/write): every write option, and the write signatures
- [`@better-fs-tools/cloudflare-shell`](https://www.npmjs.com/package/@better-fs-tools/cloudflare-shell): a filesystem for Cloudflare Agents
