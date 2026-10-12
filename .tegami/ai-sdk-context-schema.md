---
packages:
  "@better-fs-tools/ai-sdk": minor
---

## The AI SDK tools take a `contextSchema`

`createAiSdkReadTool()`, `createAiSdkEditTool()`, `createAiSdkWriteTool()`, `createAiSdkApplyPatchTool()`, `createAiSdkBashTool()`, and `createAiSdkFsTools()` take a new `contextSchema` option. The tool passes it to the AI SDK, which validates the `toolsContext` entry of the tool before `execute`. In the bundle, every tool gets the same schema.

The tool types now have an optional `contextSchema` field. With it, the AI SDK types accept a `toolsContext` of the factory's context type, for example `createAiSdkFsTools<{ root: string }>()`. Before, `generateText` refused any `toolsContext` for these tools, so a caller needed a cast. Because of the new field, a tool of one context type no longer fits a variable of another context type.
