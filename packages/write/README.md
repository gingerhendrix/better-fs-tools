# @better-fs-tools/write

Edit, write, and apply_patch tools for TypeScript agents.

This package is in progress. It has the shared mutation core and the `write` tool. The `edit` and `apply_patch` tools, the built-in guards, and the signatures come in later batches of the write tools build.

`createWriteTool({ fs })` takes a `WritableFileSystem` from `@better-fs-tools/fs`. It creates a missing file, or replaces an existing one. With the read tool's `state` store and a `digest`, an existing file must be read in full first, and a file that changed since the read is refused as `STALE`. A replace keeps the file's BOM and CRLF line endings. Same content gives `no-change` and writes nothing.

## Install

```sh
npm install @better-fs-tools/write @better-fs-tools/read @better-fs-tools/fs
```

## Entries

| Entry                              | Contents                                                                                                                                                     |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@better-fs-tools/write`           | `createWriteTool`, the mutation core's types, `utf8Codec`, `memoryLocks`, `askBeforeWrite`, `writeAuthorizers`, `defaultWriteFormatter`, `createInvalidator` |
| `@better-fs-tools/write/patch`     | Empty for now                                                                                                                                                |
| `@better-fs-tools/write/signature` | Empty for now                                                                                                                                                |

The package imports no `node:` module. It builds on the tool-neutral base types in `@better-fs-tools/read`, such as `ToolCallContext`, `PathResolver`, and `ToolAuthorizer`. An authorizer or resolver typed on them works for the read tool and for the write tools:

```ts
import { compileGlob } from "@better-fs-tools/read";
import type { ToolAuthorizer } from "@better-fs-tools/read";

const generated = compileGlob("**/dist/**");

// Tool-neutral: it sees only the fields every tool's target has.
export const noGenerated: ToolAuthorizer<unknown> = {
  id: "no-generated",
  authorize: (target, ctx) =>
    generated(target.resolvedPath)
      ? {
          allow: false,
          note: {
            code: "denied",
            severity: "warning",
            message: ctx.messages.denied({ path: target.requestedPath, detail: "generated" }),
          },
        }
      : { allow: true },
};
```

## License

MIT
