# @better-fs-tools/write

Edit, write, and apply_patch tools for TypeScript agents. They share one mutation core with the read tool in [`@better-fs-tools/read`](https://www.npmjs.com/package/@better-fs-tools/read): the same filesystem contract, the same read store, and the same resolvers and authorizers.

- `edit` replaces text in an existing file. Each old text must match once, and every byte outside the matched ranges stays the same.
- `write` creates a file, or replaces a whole file.
- `apply_patch` applies a patch in the Codex format to several files, and undoes the files it already changed when a later step fails.

All three refuse to change a file the model has not read, refuse a file that changed since the read, keep a file's BOM and line endings, refuse obvious damage such as pasted line numbers, and say in the result what the backend could not promise.

## Install

```sh
npm install @better-fs-tools/write @better-fs-tools/read @better-fs-tools/fs
```

The package has no peers and imports no `node:` module. It depends on `@better-fs-tools/shell` for the optional bash tool of `createFsTools()`. Add a filesystem package, for example `@better-fs-tools/node`.

## Quick start

`createFsTools({ fs })` builds all four tools over any `WritableFileSystem`. On Node, `createNodeFsTools()` from [`@better-fs-tools/node`](https://www.npmjs.com/package/@better-fs-tools/node) does the same with a Node filesystem and `nodeDigest()`:

```ts
import { memoryFileSystem } from "@better-fs-tools/fs";
import { textOf } from "@better-fs-tools/read";
import { createFsTools } from "@better-fs-tools/write";

const fs = memoryFileSystem({ files: { "/src/app.ts": "export const a = 1;\n" } });

// read, edit, write, and apply_patch with one store, one sha256Digest(), and
// one lock manager, so edit and write know what the model has read.
const { read, edit, write } = createFsTools({ fs });

console.log(textOf(await edit({ path: "/src/app.ts", edits: [{ oldText: "1", newText: "2" }] })));
// [edit:not-read] Read /src/app.ts with the read tool before changing it.

await read({ path: "/src/app.ts" });
const edited = await edit({ path: "/src/app.ts", edits: [{ oldText: "1", newText: "2" }] });
console.log(textOf(edited));
// Edited /src/app.ts: 1 replacement at line 1.
// 1|export const a = 2;

const created = await write({ path: "/src/b.ts", content: "export const b = 1;\n" });
console.log(textOf(created)); // Created /src/b.ts (1 line).
```

A tool call is `tool(input, ctx?)`. `ctx` is the read tool's call context: `{ signal?, callId?, host }`. The core passes the same object to every host function as `ctx.call`.

## One bundle for every tool

`createFsTools(options)` takes a `WritableFileSystem`, or a factory that returns one for each call, and builds `read`, `edit`, `write`, and `apply_patch`. They share one `state` (one store, not a per-call factory; default `createMemoryStore({ clock })`, `null` turns read-before-write off), one `digest` (default `sha256Digest()`), one `locks` (default `memoryLocks()`), and one `clock`. It imports no `node:` module, so a Worker needs no host digest. Each tool's other options go under `read`, `edit`, `write`, and `applyPatch`.

Bash is off unless you ask. `bash: { runner, env, ... }` adds a bash tool from [`@better-fs-tools/shell`](https://www.npmjs.com/package/@better-fs-tools/shell) that gets the same `digest` and `clock`. The allowed roots of the filesystem do not limit a command.

The result also has `state`, `digest`, `locks`, `clock`, and `invalidate(path, call?)`, which deletes the record for a path so the next edit needs a read. It returns an `InvalidateOutcome`. When `fs` is a factory, pass the call context, for example `ctx.call` in a bash `afterRun` hook.

An unknown option key, a shared key (`fs`, `state`, `digest`, `locks`, or `clock`) inside a tool's options, or `bash: true` throws `TypeError`. `createNodeFsTools()`, `createPiFsTools()`, and `createAiSdkFsTools()` wrap it.

## Hosts

| Host                                  | Package                                                                                                   | Factories                                                                                                      |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Any                                   | this package                                                                                              | `createFsTools({ fs })`, `createEditTool()`, `createWriteTool()`, `createApplyPatchTool()`                     |
| Node or Bun                           | [`@better-fs-tools/node`](https://www.npmjs.com/package/@better-fs-tools/node)                            | `createNodeFsTools()`, `createNodeEditTool()`, `createNodeWriteTool()`, `createNodeApplyPatchTool()`           |
| AI SDK 7                              | [`@better-fs-tools/ai-sdk`](https://www.npmjs.com/package/@better-fs-tools/ai-sdk)                        | `createAiSdkFsTools({ fs })`, `createAiSdkEditTool()`, `createAiSdkWriteTool()`, `createAiSdkApplyPatchTool()` |
| Pi coding agent                       | [`@better-fs-tools/pi`](https://www.npmjs.com/package/@better-fs-tools/pi)                                | `createPiFsTools()`, one factory for each tool, and a `pi.extensions` entry                                    |
| Cloudflare Shell, Computer, just-bash | `@better-fs-tools/cloudflare-shell`, `@better-fs-tools/cloudflare-computer`, `@better-fs-tools/just-bash` | Writable filesystems for `createFsTools()`, `createAiSdkFsTools()`, or the single factories                    |

The standalone factories (`createNodeEditTool()`, `createAiSdkEditTool()`, `createPiEditTool()`, and the others) default to `state: null`. Every update then carries a `read-before-write-off` note. Use a bundle (`createFsTools()`, `createNodeFsTools()`, `createPiFsTools()`, or `createAiSdkFsTools()`), or pass the same `state`, `digest`, and `locks` to the read tool and the write tools.

[docs/hosts.md](docs/hosts.md) lists the defaults of every bundle and single factory, the default signature of each tool in each host, and what each backend can do.

## edit

`createEditTool({ fs })`. The input is a path and one or more `{ oldText, newText, replaceAll? }` pairs, all matched against one snapshot of the file. Each old text must match once, unless `replaceAll` is set. Pairs must not overlap. The replacement is a literal splice: `$&` and `$1` in the new text stay as written.

Matching tries `exactMatcher()` first, then `normalizedMatcher()` (trailing whitespace, Unicode normalization, curly quotes, dashes, and special spaces), then `escapeMatcher()` (escape sequences written out). A loose match gives a `fuzzy-match` note that names the lines. `lineTrimmedMatcher()`, `indentationMatcher()`, and `blockAnchorMatcher()` are opt-in through the `matchers` dependency.

When a pair does not match, the error shows the closest region of the file with line numbers. When the new text is already in the file and the old text is not, the pair is `already-applied` and the status is `no-change`. After three misses in a row on one file, the tool adds a `repeated-miss` note that asks the model to read the file again. The model text is a short header and the new lines around each change. The full diff is in `changes[].diff`.

## write

`createWriteTool({ fs })` creates a missing file, or replaces an existing one. Missing parent folders are created. A replace needs a read of the whole file first. A partial read is not enough. The same content gives `no-change` and writes nothing, so the modification time stays.

## apply_patch

`createApplyPatchTool({ fs })` takes a patch between `*** Begin Patch` and `*** End Patch` with `*** Add File`, `*** Update File` (with an optional `*** Move to`), and `*** Delete File` operations. `parsePatch` from `@better-fs-tools/write/patch` accepts a fenced block, a heredoc wrapper, CRLF line breaks, and a missing final newline.

```ts
import { memoryFileSystem } from "@better-fs-tools/fs";
import { nodeDigest } from "@better-fs-tools/node";
import { createMemoryStore, createReadTool, textOf } from "@better-fs-tools/read";
import { createApplyPatchTool } from "@better-fs-tools/write";

const fs = memoryFileSystem({
  files: { "/src/app.ts": "const a = 1;\nconst b = 2;\n", "/src/old.ts": "gone\n" },
});
const state = createMemoryStore();
const digest = nodeDigest();
const read = createReadTool({ fs, state, digest });
const applyPatch = createApplyPatchTool({ fs, state, digest });

await read({ path: "/src/app.ts" });
await read({ path: "/src/old.ts" });

const result = await applyPatch({
  patch: `*** Begin Patch
*** Update File: /src/app.ts
@@
 const a = 1;
-const b = 2;
+const b = 3;
*** Add File: /src/new.ts
+export const c = 4;
*** Delete File: /src/old.ts
*** End Patch`,
});
console.log(textOf(result));
// Success. Updated the following files:
// M /src/app.ts
// A /src/new.ts
// D /src/old.ts
```

Every operation is checked before any file changes. An Add on an existing file, an Update or Delete on a missing file, a move onto an existing file, two operations on one file, and a hunk that does not match all give `PATCH_VERIFY`, with every problem listed. Each hunk matches at the first place after the previous hunk, as Codex does. The chain is `exactMatcher()`, `normalizedMatcher()`, and `lineTrimmedMatcher()` on whole lines. Context lines keep the file's own bytes.

The commit stages every new file when the backend has `stage()`, then publishes in patch order. Without `stage()` it writes each file in turn. When a step fails, the steps already done are undone from the end, and `result.commit` says so. When an undo step also fails, the code is `PARTIAL_COMMIT` and `result.commit.files` lists the state of every file. A host can pass its own `patchParser` for another patch format.

## Read before write

With the read tool's `state` store and a `digest`, the write tools check what the model has seen:

- An existing file needs a record from a read. `edit` and `apply_patch` accept a partial read. `write` needs a read of the whole file.
- A file that changed since the read gives `STALE`, with one exception: `edit` and `apply_patch` go ahead when every old text still matches exactly once, with a `stale-rematched` note. `write` always refuses.
- On a backend with stable identity, the check compares the backend `version`. On every other backend it compares the content hash.
- After a commit, the tool stores a record with `origin: "write"`. A second edit needs no new read. When an authorizer replaced the content, a hook rewrote the file, or an edit went ahead on a stale file, the record says the model has not seen the whole file, so a following `write` needs a read.
- `createInvalidator({ fs, state })` returns `invalidate(path)`. Call it when something else, for example a shell tool, may have changed a file. The next edit then needs a read. It never throws. It resolves to an `InvalidateOutcome`: `{ ok: true, resolvedPath, recorded }`, where `recorded` says whether a record was there, or `{ ok: false, phase }` when the stat (`phase: "stat"`, with the backend `error`) or the store (`phase: "state"`, with a `detail`) failed. After `ok: false` the record may still be there.
- `preconditions: { requireRead: "off" }` turns the check off. `partialRead` and `onStale` change the other two rules.

`state` without `digest` is a `TypeError`, as in the read tool, and the `StateNeedsDigest` type refuses it at compile time. `state: null` turns the check off, and every update carries a `read-before-write-off` note.

## Dependencies

Every dependency except `fs` has a default. Pass them to `createEditTool()`, `createWriteTool()`, or `createApplyPatchTool()`, or to a host factory.

| Dependency      | Default                                                                     | Meaning                                                                                                   |
| --------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `fs`            | required                                                                    | A `WritableFileSystem`, or a factory of the call context that runs once for each call                     |
| `state`         | `null`                                                                      | The read tool's store, or a factory. Needs `digest`                                                       |
| `digest`        | `null`                                                                      | Content hashes for records and `changes[].after.contentId`                                                |
| `locks`         | `memoryLocks()`                                                             | Orders writers to one path inside the process. Share one across the three tools. `timeoutMs` default 30 s |
| `resolve`       | `null`                                                                      | A read `PathResolver`, for example `unicodeRepair()`                                                      |
| `authorize`     | `null`                                                                      | A `WriteAuthorizer`, or a read `ToolAuthorizer` such as `denyPaths()`                                     |
| `guards`        | `defaultGuards()`                                                           | Checks on each planned change. `[]` turns them off                                                        |
| `hooks`         | `[]`                                                                        | Run after each committed file                                                                             |
| `matchers`      | edit: `defaultEditMatchers()`; patch: `defaultPatchMatchers()`              | The match chain, in order                                                                                 |
| `preconditions` | `{ requireRead: "existing", partialRead: "edit-only", onStale: "rematch" }` | Read-before-write rules                                                                                   |
| `limits`        | `defaultWriteLimits`                                                        | See below                                                                                                 |
| `messages`      | `defaultWriteMessages`                                                      | Every model-facing text. Merged key by key                                                                |
| `formatter`     | `defaultWriteFormatter()`                                                   | Turns the report into content parts. `{ diff: true }` adds the full diff to the model text                |
| `classifiers`   | the read tool's default classifiers                                         | Refuse a target that is not text before it is decoded                                                     |
| `codecs`        | `[utf8Codec()]`                                                             | Decode and encode. `utf8Codec` keeps a BOM, CRLF, and mixed line endings                                  |
| `clock`         | `() => new Date()`                                                          | Record times                                                                                              |
| `patchParser`   | `codexPatchParser()`                                                        | `apply_patch` only                                                                                        |

| Limit              | Default | Meaning                                        |
| ------------------ | ------- | ---------------------------------------------- |
| `maxFileBytes`     | 8 MiB   | Bytes of an existing file that any tool loads  |
| `maxWriteBytes`    | 8 MiB   | Encoded bytes of new content for one file      |
| `maxPatchBytes`    | 4 MiB   | UTF-8 bytes of patch text                      |
| `maxPatchFiles`    | 100     | Operations in one patch                        |
| `maxEdits`         | 100     | Pairs in one edit call                         |
| `sampleBytes`      | 8 192   | Bytes given to the classifiers and codecs      |
| `snippetLines`     | 3       | Context lines around each change in a snippet  |
| `maxSnippetLines`  | 40      | Snippet lines for one file in the model text   |
| `maxDiffLines`     | 2 000   | Lines of unified diff kept in `changes[].diff` |
| `maxHintLines`     | 12      | Lines in a closest-region hint                 |
| `maxListedMatches` | 10      | Line numbers listed for an ambiguous match     |
| `maxPatchProblems` | 20      | Problems listed for a failed patch verify      |

A `sampleBytes` that you set above `maxFileBytes` throws `TypeError`. When you set only `maxFileBytes` below 8 192, the default `sampleBytes` is lowered to it. The same limits rule holds in read, write, and bash. A per-call value over its ceiling is clamped, with a `clamped` info note. Two limits that you set and that conflict throw `TypeError` when the tool is built. A default that is over a ceiling you set is lowered to that ceiling.

Every tool has one parse helper with the same pattern: `parseReadInput`, `parseEditInput`, `parseWriteInput`, `parseApplyPatchInput`, and `parseBashInput`. Each takes the canonical input and the resolved limits, returns the request, and throws `TypeError` for input it refuses. The tool turns that throw into `INVALID_INPUT`. A clamp is not an error: the helper returns the clamped value, and the tool adds the `clamped` note.

## Authorize

An authorizer runs twice. The access stage runs for each target after `stat` and before any content byte is read, with `change: null`. The change stage runs for each planned change with the diff, after the guards. `writeAuthorizers(...steps)` runs steps left to right. The first deny wins. A read `ToolAuthorizer`, such as `denyPaths()`, is a valid step.

```ts
import { memoryFileSystem } from "@better-fs-tools/fs";
import { denyPaths, textOf } from "@better-fs-tools/read";
import {
  askBeforeWrite,
  createWriteTool,
  protectPaths,
  writeAuthorizers,
} from "@better-fs-tools/write";

const fs = memoryFileSystem({ directories: ["/repo"] });

const write = createWriteTool({
  fs,
  authorize: writeAuthorizers(
    // A tool-neutral authorizer from read works here too. It runs before any content byte is read.
    denyPaths(["**/.env", "**/.env.*"]),
    // AGENTS.md, CLAUDE.md, and .git/** are refused unless `ask` says yes.
    protectPaths(),
    // One question for the whole plan, with every diff.
    askBeforeWrite(async (plan) => {
      for (const change of plan) console.log(change.diff);
      return true; // or false, or { content } with the user's own text
    }),
  ),
});

console.log(textOf(await write({ path: "/repo/.env", content: "TOKEN=1\n" })));
// [write:denied] /repo/.env was refused by policy (the path matches a denied pattern).
console.log(textOf(await write({ path: "/repo/AGENTS.md", content: "# Rules\n" })));
// [write:denied] /repo/AGENTS.md was refused by policy (the path is protected).
console.log((await write({ path: "/repo/notes.md", content: "hello\n" })).status); // "ok"
```

An authorizer may allow with `content` for `edit` and `write`. The tool then writes that text instead, adds a `user-modified` note, and sets `changes[].userModified`. `apply_patch` does not take content.

## Guards and hooks

Guards check each planned change before anything is written. `defaultGuards()` is on unless the `guards` dependency replaces it. It refuses new text that carries the read tool's line-number gutter (`readPrefixGuard`), a read note line or clamp marker (`truncationNoticeGuard`), or a placeholder such as `// ... rest of code` in place of real lines (`omissionGuard`). It refuses an update that makes a valid `.json` file invalid (`syntaxGuard`), and new content that the classifiers do not call text (`nonTextGuard`). Each guard lets the near miss through: lines already in the file, a file that was already broken, or a create. `generatedFileGuard()` is opt-in. It refuses updates to files that look generated.

Hooks run after each committed file. `executableShebang()` gives a new file that starts with `#!` mode `0o755`, through the hook's `newFileMode()`. `verifyWrite()` reads each committed file back and adds a warning when it does not match what was written. A hook failure is a warning note: the file is already committed, so the status stays `ok`.

```ts
import { memoryFileSystem } from "@better-fs-tools/fs";
import { textOf } from "@better-fs-tools/read";
import {
  createWriteTool,
  defaultGuards,
  executableShebang,
  generatedFileGuard,
  syntaxGuard,
  verifyWrite,
} from "@better-fs-tools/write";
import type { Guard, WriteHook } from "@better-fs-tools/write";

// A host guard: refuse tabs in new YAML text.
const noTabsInYaml: Guard<unknown> = {
  id: "no-tabs-in-yaml",
  check(change) {
    const yaml = /\.ya?ml$/u.test(change.resolvedPath);
    if (!yaml || !change.fragments.some((fragment) => fragment.newText.includes("\t"))) {
      return { allow: true };
    }
    return {
      allow: false,
      note: {
        code: "guard-refused",
        severity: "warning",
        message: `${change.displayPath}: YAML does not allow tabs for indentation.`,
      },
    };
  },
};

// A host hook: log each committed change.
const logChanges: WriteHook<unknown> = {
  id: "log-changes",
  afterWrite(change) {
    console.log(`${change.kind} ${change.path} (+${change.linesAdded} -${change.linesRemoved})`);
    return {};
  },
};

const write = createWriteTool({
  fs: memoryFileSystem({ directories: ["/repo"] }),
  // defaultGuards() is the default. Passing guards replaces the whole list.
  guards: [
    ...defaultGuards().filter((guard) => guard.id !== "syntax"),
    syntaxGuard({ parsers: { yaml: (text) => void text } }),
    generatedFileGuard(),
    noTabsInYaml,
  ],
  hooks: [executableShebang(), verifyWrite(), logChanges],
});

console.log(textOf(await write({ path: "/repo/ci.yaml", content: "a:\n\tb: 1\n" })));
// [write:guard-refused] /repo/ci.yaml: YAML does not allow tabs for indentation.

console.log(textOf(await write({ path: "/repo/run.sh", content: "#!/bin/sh\necho hi\n" })));
// create /repo/run.sh (+2 -0)
// Created /repo/run.sh (2 lines).
//
// [write:executable] Made /repo/run.sh executable (mode 755) because it starts with "#!".
```

## Signatures

A signature is what the model sees: a name, a description, and a JSON Schema. `toInput` checks model input and maps it to the core's canonical input, and `param(name)` gives the host name of a canonical parameter for messages. Every write signature is a `ToolSignature` from `@better-fs-tools/read`, the base that the read and bash signatures share. The host adapters take a `signature` option.

Every preset takes the shared `SignatureDocs` options: `name`, `description`, `describe`, and `names`. `describe` and `names` use the preset's own parameter names as keys, so `camelCaseEditSignature` takes `oldString` and `defaultEditSignature` takes `old_string`. `camelCaseEditSignature` and `snakeCaseWriteSignature` are the default presets with the names two popular hosts use.

```ts
import { memoryFileSystem } from "@better-fs-tools/fs";
import { createEditTool } from "@better-fs-tools/write";
import {
  camelCaseEditSignature,
  defaultEditSignature,
  freeformPatchSignature,
  multiEditSignature,
  writeSignatureMessages,
} from "@better-fs-tools/write/signature";

// What the model sees: a name, a description, and a JSON Schema.
const signature = camelCaseEditSignature({ name: "edit_file" });
console.log(signature.name, Object.keys(signature.schema.properties ?? {}));
// edit_file [ "filePath", "oldString", "newString", "replaceAll" ]

// toInput checks model input and maps it to the core's canonical input.
console.log(signature.toInput({ filePath: "a.ts", oldString: "x", newString: "y" }));
// { path: "a.ts", edits: [ { oldText: "x", newText: "y" } ] }

// Behind a signature, pass its message names, so errors name filePath, not path.
const edit = createEditTool({
  fs: memoryFileSystem({ files: { "/a.ts": "x\n" } }),
  messages: writeSignatureMessages(signature),
});
export async function run(input: unknown) {
  return edit(signature.toInput(input));
}

// The other presets.
export const presets = [
  defaultEditSignature(), // edit({ path, old_string, new_string, replace_all? })
  multiEditSignature(), // edit({ path, edits: [{ oldText, newText }] }), Pi's shape
  freeformPatchSignature(), // apply_patch({ patch }) plus a Lark grammar for grammar-tool hosts
];

// Every preset takes names. The keys are the preset's own parameter names.
export const renamed = defaultEditSignature({
  names: { path: "file", old_string: "find", new_string: "replace" },
}); // edit({ file, find, replace, replace_all? })
```

`freeformPatchSignature()` adds `grammar.lark`, the Codex patch grammar. The Pi adapter sends it as a grammar tool to models that support one. The AI SDK adapter ignores it and sends the JSON schema.

## The result

Every call returns a `MutationResult`: `tool`, `status` (`ok`, `no-change`, or `error`), `error` on an error result only, with a stable `code`, the `phase` that stopped the call, and the error note's `message`, `changes` with one `FileChange` for each committed file, `notes`, `commit` for a failed patch commit, and `content` for the model. [docs/result-schema.md](docs/result-schema.md) lists every field, code, and note.

```ts
import { memoryFileSystem } from "@better-fs-tools/fs";
import { textOf } from "@better-fs-tools/read";
import { createEditTool } from "@better-fs-tools/write";
import type { MutationResult } from "@better-fs-tools/write";

const edit = createEditTool({
  fs: memoryFileSystem({ files: { "/app.ts": "const a = 1;\nconst b = 2;\n" } }),
});

const result: MutationResult = await edit({
  path: "/app.ts",
  edits: [{ oldText: "const b = 2;", newText: "const b = 3;" }],
});

if (result.status === "error") {
  // A stable code, the stage that stopped the call, and the data of the error note.
  console.log(result.error.code, result.error.phase, result.error.data);
} else {
  for (const change of result.changes) {
    console.log(change.kind, change.path, `+${change.linesAdded} -${change.linesRemoved}`);
    console.log(change.diff); // The full unified diff. The model text has only a snippet.
    console.log(change.after?.version); // The backend version after the commit
  }
}
// Without a state store, every update carries a read-before-write-off note.
console.log(result.notes.map((note) => note.code)); // [ "read-before-write-off" ]
console.log(textOf(result)); // What the model sees
```

## Backends

The core adds a note when the backend cannot keep a promise: `not-atomic` when a reader could see a partial file, `no-compare-and-swap` when the backend cannot check the version at the moment of the write, and `mode-not-kept` when a replace may change the file's permissions.

| Backend                          | `atomic` | `compareAndSwap`    | `preserveMode` | `stage()` | `remove()` |
| -------------------------------- | -------- | ------------------- | -------------- | --------- | ---------- |
| `memoryFileSystem()`             | yes      | yes                 | yes            | yes       | yes        |
| `nodeFileSystem()`               | yes      | yes, in one process | yes            | yes       | yes        |
| `cloudflareShellFileSystem()`    | no       | no                  | no             | no        | yes        |
| `cloudflareComputerFileSystem()` | yes      | no                  | yes            | no        | yes        |
| `justBashFileSystem()`           | no       | no                  | yes            | no        | yes        |

Without compare-and-swap, the core checks the version with a fresh `stat` just before the write. Another writer can still change the file between that check and the write.

## Known limits

- `apply_patch` rollback lives in process memory. A crash or a killed process during the commit leaves some files changed and no report.
- Undoing a create removes the file but leaves the parent folders the create made.
- The repeated-miss count lives in each tool instance. A host that builds a new tool for each call never sees the `repeated-miss` note.
- After-commit hooks are not raced against the abort signal. A hook that never settles holds the call open. From the first commit step on, the signal is ignored, so a started commit finishes.
- `createMemoryStore()` forgets a read after 30 minutes, and keeps at most 1 000 records. A file read longer ago needs a new read before `edit`, and the result says so (`NOT_READ`).
- A match with a loose matcher writes the model's new text as given. When the normalized matcher matched ASCII quotes against curly quotes, the model's ASCII quotes are written.

## Entries

| Entry                              | Contents                                                                                                                                                                                                                                                                                                                  |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@better-fs-tools/write`           | `createFsTools`, `createWriteTool`, `createEditTool`, `createApplyPatchTool`, the matchers, the guards and `defaultGuards`, the mutation core's types, `utf8Codec`, `memoryLocks`, `askBeforeWrite`, `writeAuthorizers`, `protectPaths`, `executableShebang`, `verifyWrite`, `defaultWriteFormatter`, `createInvalidator` |
| `@better-fs-tools/write/patch`     | `parsePatch`, `codexPatchParser`, `CODEX_PATCH_GRAMMAR`, and the patch types. The only home of these                                                                                                                                                                                                                      |
| `@better-fs-tools/write/signature` | `defaultEditSignature`, `multiEditSignature`, `camelCaseEditSignature`, `defaultWriteSignature`, `snakeCaseWriteSignature`, `defaultPatchSignature`, `freeformPatchSignature`, and `writeSignatureMessages`                                                                                                               |

The package builds on the tool-neutral base types in `@better-fs-tools/read`, such as `ToolCallContext`, `PathResolver`, and `ToolAuthorizer`. An authorizer or resolver typed on them works for the read tool and for the write tools:

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

## More

- [docs/architecture.md](docs/architecture.md): the pipeline, the stages, and why they are fixed
- [docs/result-schema.md](docs/result-schema.md): every field of the result, every error code, and every note, plus one table of the statuses and error codes of all five tools
- [docs/hosts.md](docs/hosts.md): the defaults of every host and bundle, and what each backend can do
- [`@better-fs-tools/fs`](https://www.npmjs.com/package/@better-fs-tools/fs): the `WritableFileSystem` contract and its conformance suite

## License

MIT
