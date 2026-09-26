# @better-fs-tools/ai-sdk

The Better Read tool for [AI SDK 7](https://ai-sdk.dev). `createAiSdkReadTool()` gives a tool object that you put in a `ToolSet`.

## Install

```sh
npm install @better-fs-tools/ai-sdk @better-fs-tools/read ai
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
- The model sees the signature's name, description, and JSON Schema. The tool is `strict: true`. The default signature is `defaultSignature()`: `read` with `path`, `offset`, and `limit`.
- The schema's `validate` hook runs `signature.toRead` and then the core input check. A refusal names the host's parameters, and `generateText` reports it as a tool error.
- `execute` passes AI SDK's `ToolExecutionOptions` object to the core as `ctx.call.host`, with `abortSignal` as the signal and `toolCallId` as `callId`. Host functions can read `ctx.call.host.context`. `execute` returns the whole `ReadResult`. If `toRead` refuses an input that reached `execute`, `execute` rejects with that `TypeError`.
- Retry text in notes uses the signature's names. `result.continuation.next` stays canonical.
- `toModelOutput` maps text parts to text parts, and media parts to base64 `file` parts. `toAiSdkOutput(result)` does the same mapping for your own tool.

For a Cloudflare Agents host, pass `fs: shellWorkspaceFileSystem(workspace, { root })` from `@better-fs-tools/cloudflare-shell`. No other wrapper is needed.

## Links

- [`@better-fs-tools/read`](https://www.npmjs.com/package/@better-fs-tools/read): every read option, and the signature builders
- [`@better-fs-tools/cloudflare-shell`](https://www.npmjs.com/package/@better-fs-tools/cloudflare-shell): a filesystem for Cloudflare Agents
