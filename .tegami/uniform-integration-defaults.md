---
packages:
  "@better-fs-tools/pi": minor
  "@better-fs-tools/pi-durable": minor
---

## Every integration has the same default signatures

The Pi tools, `createAgentCoreFsTools()`, and `createDurableFsTools()` now have the same default signatures as the AI SDK tools. Before, they copied the input, prompt text, and output schemas of Pi's own tools. This is a breaking change for Pi users.

| Tool          | New default                                                                | Old Pi default                                                    |
| ------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `edit`        | `defaultEditSignature()`: `{ path, old_string, new_string, replace_all? }` | `multiEditSignature()`: `{ path, edits: [{ oldText, newText }] }` |
| `apply_patch` | `defaultPatchSignature()`: `{ patch }` as JSON                             | `freeformPatchSignature()`, with the Codex grammar                |
| `bash`        | `defaultBashSignature()`: `{ command, timeout?, cwd? }`, milliseconds      | `{ command, timeout? }`, seconds, no `cwd`                        |

- `read` and `write` keep their input, which was the same.
- The Pi `promptSnippet` is now the first sentence of the signature description, and `promptGuidelines` is `[]`. Pi lists a tool under "Available tools" only when it has a snippet, so every tool still has one.
- No tool declares an `outputSchema` or returns `structuredContent` any more. A codemode script gets the text of the result, and a result with `isError: true` makes the call reject. The `PiReadOutput` and `PiBashOutput` types are removed. `createDurableFsTools()` bash has no `structuredOutputSchema`.
- `createDurableFsTools()` now defaults to `state: null`, as every other bundle. Pass `state: "document"` to keep read records in the conversation's documents.
- `piToolRenderers(tools)` is new. Pi draws a tool named `read`, `edit`, `write`, or `bash` with its built-in renderer, which reads Pi's own argument names. The resolver gives that renderer the arguments in Pi's names, so the edit preview and the bash timeout show correctly. The extension entry registers it. When you register the tools yourself, call `pi.registerToolRenderer(piToolRenderers([...]))`. `PiExtensionApi` now needs `registerToolRenderer`.

To keep the old model-facing shapes, pass the presets as signatures:

```ts
createPiFsTools({
  edit: { signature: multiEditSignature() },
  applyPatch: { signature: freeformPatchSignature() },
});
createPiBashTool({ signature: defaultBashSignature({ timeoutUnit: "s", cwd: false }) });
```

Kept differences, each for a host need: Pi's `locks` default `piMutationQueueLocks()`, `nodeDigest()` on Node, and the pi-durable `outputLimits`. `docs/hosts.md` in `@better-fs-tools/write` lists them.
