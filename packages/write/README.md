# @better-fs-tools/write

Edit, write, and apply_patch tools for TypeScript agents.

This package is in progress. It has the shared mutation core, the `write`, `edit`, and `apply_patch` tools, and the built-in guards and hooks. The signatures come in a later batch of the write tools build.

`createWriteTool({ fs })` takes a `WritableFileSystem` from `@better-fs-tools/fs`. It creates a missing file, or replaces an existing one. With the read tool's `state` store and a `digest`, an existing file must be read in full first, and a file that changed since the read is refused as `STALE`. A replace keeps the file's BOM and CRLF line endings. Same content gives `no-change` and writes nothing.

`createEditTool({ fs })` replaces text in an existing file. Its input is a path and one or more `{ oldText, newText, replaceAll? }` pairs, all matched against one snapshot of the file. Each old text must match once, unless `replaceAll` is set. The replacement is a literal splice: `$&` and `$1` in the new text stay as written, and every byte outside the matched ranges stays the same. With a store, the file must be read first, but a partial read is enough, and a second edit needs no new read. When the file changed since the read, the edit still goes ahead if every old text matches exactly once, with a `stale-rematched` note.

Matching tries `exactMatcher()` first, then `normalizedMatcher()` (trailing whitespace, Unicode normalization, curly quotes, dashes, and special spaces), then `escapeMatcher()` (escape sequences written out). The result says when a loose match was used. `lineTrimmedMatcher()`, `indentationMatcher()`, and `blockAnchorMatcher()` are opt-in through the `matchers` dependency. A miss shows the closest region of the file. An edit that is already in the file gives `no-change` with a note. The model text is a short header and the new lines around each change; the full diff is in `changes[].diff`.

`createApplyPatchTool({ fs })` applies a patch in the Codex format to several files in one call: `*** Add File`, `*** Update File` (with an optional `*** Move to`), and `*** Delete File` between `*** Begin Patch` and `*** End Patch`. `parsePatch` from `@better-fs-tools/write/patch` accepts a fenced block, a heredoc wrapper, CRLF line breaks, and a missing final newline. Every operation is checked before any file changes: an Add on an existing file, an Update or Delete on a missing file, a move onto an existing file, two operations on one file, and a hunk that does not match all give `PATCH_VERIFY`, with every problem listed and no file modified. Each hunk matches at the first place after the previous hunk, as Codex does. The chain is `exactMatcher()`, `normalizedMatcher()`, and `lineTrimmedMatcher()` on whole lines, and a loose match is named in the result. Context lines keep the file's own bytes, and the BOM and line endings stay. The commit stages every new file when the backend can, then publishes in patch order. When a step fails, the steps already published are undone, and the result says so. When an undo step also fails, the code is `PARTIAL_COMMIT` and the result lists the state of every file. A host can pass its own `patchParser` for another patch format.

Guards check each planned change before anything is written. `defaultGuards()` is on unless the `guards` dependency replaces it (`guards: []` turns them off). It refuses new text that carries the read tool's line-number gutter (`readPrefixGuard`), a read note line or clamp marker (`truncationNoticeGuard`), or a placeholder such as `// ... rest of code` in place of real lines (`omissionGuard`). It refuses an update that makes a valid `.json` file invalid (`syntaxGuard`, which takes host parsers for other extensions), and new content that the classifiers do not call text, such as a new `.ipynb` (`nonTextGuard`). Each guard lets through the near miss: lines that are already in the file, a file that was already broken, or a create. `generatedFileGuard()` is opt-in and refuses updates to files that look generated.

`protectPaths()` is an authorizer. It denies changes to `AGENTS.md`, `CLAUDE.md`, and `.git/**` before any content byte is read. With an `ask` function it asks once for each such path in a call. Two after-write hooks are opt-in: `executableShebang()` creates a new file that starts with `#!` with mode `0o755`, and `verifyWrite()` reads each committed file back and adds a warning when it does not match what was written.

## Install

```sh
npm install @better-fs-tools/write @better-fs-tools/read @better-fs-tools/fs
```

## Entries

| Entry                              | Contents                                                                                                                                                                                                                                                                                                                                   |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@better-fs-tools/write`           | `createWriteTool`, `createEditTool`, `createApplyPatchTool`, the matchers, the guards and `defaultGuards`, the mutation core's types, `utf8Codec`, `memoryLocks`, `askBeforeWrite`, `writeAuthorizers`, `protectPaths`, `executableShebang`, `verifyWrite`, `defaultWriteFormatter`, `createInvalidator`, `parsePatch`, `codexPatchParser` |
| `@better-fs-tools/write/patch`     | `parsePatch`, `codexPatchParser`, and the patch types                                                                                                                                                                                                                                                                                      |
| `@better-fs-tools/write/signature` | Empty for now                                                                                                                                                                                                                                                                                                                              |

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
