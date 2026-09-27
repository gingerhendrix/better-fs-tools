# @better-fs-tools/write

Edit, write, and apply_patch tools for TypeScript agents.

This package is a skeleton. It has no tools yet. The `edit`, `write`, and `apply_patch` tools come in later batches of the write tools build.

## Install

```sh
npm install @better-fs-tools/write @better-fs-tools/read @better-fs-tools/fs
```

## Entries

| Entry                              | Contents      |
| ---------------------------------- | ------------- |
| `@better-fs-tools/write`           | Empty for now |
| `@better-fs-tools/write/patch`     | Empty for now |
| `@better-fs-tools/write/signature` | Empty for now |

The package imports no `node:` module. It builds on the tool-neutral base types in `@better-fs-tools/read`, such as `ToolCallContext`, `PathResolver`, and `ToolAuthorizer`. An authorizer or resolver typed on them works for the read tool now, and for the write tools when they land:

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
