# @better-fs-tools/read

A bounded file reader for TypeScript agent tools. You can change every part of it.

A read returns an exact, limited view of a file. You get structured lines, explicit truncation, a continuation that the model can copy, and content for the model. The package does not summarize. The core owns the safety rules. Your host owns everything else: the filesystem, path handling, permissions, file conversion, output format, limits, and the shape of the tool that the model sees.

## Install

```sh
npm install @better-fs-tools/read @better-fs-tools/fs
```

`read` depends on `@better-fs-tools/fs`. Install `fs` yourself when your code imports from it, for example `memoryFileSystem` or the `FileSystem` type.

Most hosts also install one adapter package. Each adapter lists its own peers:

| Package                                | Use it for                                                               | Install                                                                                         |
| -------------------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| `@better-fs-tools/read`                | The core, the helpers, and the `./signature` and `./formats` subpaths    | `npm install @better-fs-tools/read`                                                             |
| `@better-fs-tools/fs`                  | The `FileSystem` contract, `memoryFileSystem`, and the conformance suite | `npm install @better-fs-tools/fs`                                                               |
| `@better-fs-tools/node`                | Local reads on Node 24 or Bun, and `createNodeReadTool()`                | `npm install @better-fs-tools/node @better-fs-tools/read`                                       |
| `@better-fs-tools/ai-sdk`              | An AI SDK 7 tool                                                         | `npm install @better-fs-tools/ai-sdk @better-fs-tools/read ai`                                  |
| `@better-fs-tools/pi`                  | A Pi tool and a Pi extension                                             | `npm install @better-fs-tools/pi @better-fs-tools/read @earendil-works/pi-coding-agent typebox` |
| `@better-fs-tools/cloudflare-shell`    | A filesystem over a Cloudflare Shell Workspace                           | `npm install @better-fs-tools/cloudflare-shell @better-fs-tools/read`                           |
| `@better-fs-tools/cloudflare-computer` | A filesystem over a Cloudflare Computer workspace (experimental)         | `npm install @better-fs-tools/cloudflare-computer @better-fs-tools/read`                        |
| `@better-fs-tools/just-bash`           | A filesystem over a just-bash `IFileSystem`                              | `npm install @better-fs-tools/just-bash @better-fs-tools/read just-bash`                        |

All packages have the same version. Install matching versions.

## Quick start

On Node or Bun, `createNodeReadTool()` gives a working local reader with no options:

```ts
import { createNodeReadTool } from "@better-fs-tools/node";
import { textOf } from "@better-fs-tools/read";

// Rooted at process.cwd(), with SHA-256 observations.
const read = createNodeReadTool();

const result = await read({ path: "package.json", limit: 2 });
console.log(result.status); // "ok"
console.log(textOf(result));
// 1|{
// 2|  "name": "my-app",
//
// [read:continue] Output stopped at the line limit. Continue with {"path":"package.json","offset":3,"limit":2}.
```

`createNodeReadTool()` uses `nodeFileSystem` rooted at `process.cwd()`, and `nodeDigest()` for content hashes. It passes every other option to `createReadTool()`.

`createReadTool()` is the core. It needs a filesystem, and it works with any `FileSystem`:

```ts
import { memoryFileSystem } from "@better-fs-tools/fs";
import { createReadTool, textOf } from "@better-fs-tools/read";

const read = createReadTool({
  fs: memoryFileSystem({ files: { "/notes.txt": "one\ntwo\nthree\n" } }),
});

const result = await read({ path: "/notes.txt", offset: 2 });
console.log(result.content); // [{ type: "text", text: "2|two\n3|three" }]
console.log(textOf(result)); // "2|two\n3|three"
```

The result has `content`, the parts that the model sees. `textOf(result)` joins the text parts with `"\n"`. There is no `result.text`.

## Contents

- [How a read works](#how-a-read-works)
- [What you can change](#what-you-can-change)
- [Tool signature and docs](#tool-signature-and-docs)
- [Path resolution](#path-resolution)
- [Suggestions on a miss](#suggestions-on-a-miss)
- [Permissions](#permissions)
- [Binary detection](#binary-detection)
- [File conversion, images, and directories](#file-conversion-images-and-directories)
- [Limits and the token budget](#limits-and-the-token-budget)
- [After-read hooks](#after-read-hooks)
- [Output format](#output-format)
- [Messages and notes](#messages-and-notes)
- [The result](#the-result)
- [Host context and state](#host-context-and-state)
- [Security guarantees](#security-guarantees)
- [Host adapters](#host-adapters)
- [Exports](#exports)
- [A host that changes everything](#a-host-that-changes-everything)
- [Writing a filesystem adapter](#writing-a-filesystem-adapter)
- [Runtime](#runtime)

## How a read works

The core function always takes the same input: `read({ path, offset?, limit? }, ctx?)`. The tool that the model sees can use other names and another range model. The adapter translates them (see [Tool signature and docs](#tool-signature-and-docs)).

Each read goes through these steps in this order:

```text
model input
  │  signature (adapter) ...... tool name, schema, parameter names, range model
  ▼
read({ path, offset, limit }, ctx)
  │  input ................... strict validation, limit clamp
  │  fs(call) ................ your filesystem, or a factory called once for each read
  │  resolve ................. rewrite the path, or report not found
  │  fs.open ................. roots, deny roots, realpath, type check: one open for each read
  │     ├─ on a miss: suggest  one bounded listing, names only
  │     └─ on a directory .... a directory converter lists it, else NOT_A_FILE
  │  authorize ............... host policy on the open file, before the core reads content
  │  sample + classifiers .... text, image, PDF, notebook, binary, ...
  │  converters .............. other formats to text or media parts
  │  scan .................... lines, clamping, view bytes, token budget, scan limit
  │  verify .................. size check and change detection
  │  hooks ................... redaction, repeat-read guard, your own
  │  state ................... record the observation
  │  formatter ............... text or content parts for the model
  ▼
ReadResult
```

You cannot remove the input validation, the scan, the limits, the type check, or change detection. Every other step is a dependency that you can replace. [docs/architecture.md](docs/architecture.md) explains each stage.

## What you can change

Pass dependencies to `createReadTool()`, `createNodeReadTool()`, or an adapter factory (`createAiSdkReadTool()`, `createPiReadTool()`). The adapter passes them to the core.

| Dimension                                              | Dependency                  | Default                                                                                           |
| ------------------------------------------------------ | --------------------------- | ------------------------------------------------------------------------------------------------- |
| Tool name, parameters, range model, descriptions       | `signature` (adapters only) | `defaultReadSignature()`: `read` with `path`, `offset`, `limit`                                   |
| Filesystem, allowed roots, deny roots, symlinks        | `fs`                        | Required. `createNodeReadTool()` uses `nodeFileSystem` over `process.cwd()`                       |
| Path rewrites (`~`, `file://`, `@`, Unicode repair)    | `resolve`                   | `null` (the path is used as given)                                                                |
| Names to suggest when a file is missing                | `suggest`                   | `defaultSuggest()`                                                                                |
| Per-path policy, size ceiling, user approval           | `authorize`                 | `null` (allow)                                                                                    |
| Binary and format detection                            | `classifiers`               | `defaultClassifiers()`                                                                            |
| File conversion, images, directories                   | `converters`                | `[]`                                                                                              |
| Line, byte, scan, conversion, and media limits         | `limits`                    | `defaultReadLimits`                                                                               |
| Token limit                                            | `budget`                    | `null`                                                                                            |
| Redaction, repeat-read guard, your own after-read code | `hooks`                     | `[]`                                                                                              |
| Output text or content parts                           | `formatter`                 | `lineNumberFormatter()`                                                                           |
| Note and message wording                               | `messages`                  | `defaultReadMessages`                                                                             |
| Read records for later tools                           | `state`                     | `null`                                                                                            |
| Content hashes and observations                        | `digest`                    | `null`. `createNodeReadTool()` and the Pi tool use `nodeDigest()`. `sha256Digest()` runs anywhere |
| Timestamps                                             | `clock`                     | `() => new Date()`                                                                                |

`limits` and `messages` merge over their defaults key by key. Every other dependency replaces its default. To add to a list, include the default yourself:

```ts
import { createNodeReadTool } from "@better-fs-tools/node";
import { defaultClassifiers, extensionClassifier } from "@better-fs-tools/read";

export const read = createNodeReadTool({
  // A list dependency replaces the default. Include the default to add to it.
  classifiers: [
    extensionClassifier({ unsupported: { ".parquet": { code: "BINARY" } } }),
    ...defaultClassifiers(),
  ],
  // limits and messages merge over their defaults key by key.
  limits: { maxLines: 500 },
  messages: { notFound: ({ request }) => `No file at ${request.path}.` },
});
```

`createReadTool()` checks the dependencies once, when you call it. An unknown key, an empty classifier list, a limit that is not a positive safe integer, or a message that is not a function throws `TypeError`.

## Tool signature and docs

The model sees a tool name, a description, a parameter schema, and parameter descriptions. These belong to the adapter, and you set them with a `ReadSignature` from `@better-fs-tools/read/signature`. The core never sees the names that the model uses.

`ReadSignature` extends the `ToolSignature` base that the write and bash signatures share. A signature is a JSON Schema plus pure functions:

- `toInput(input)` checks the model input and maps it to `{ path, offset, limit }`. It throws `TypeError` with the host's parameter names.
- `param(name)` gives the host name of a canonical parameter, or `""` when the signature has none.
- `fromInput(retry)` maps a canonical retry back to the model's names. Notes use it when they tell the model how to continue. Only the read signature has it.

Two builders cover the common cases. Both take the shared `SignatureDocs` options: `name`, `description`, `describe`, and `names`. `describe` and `names` use the builder's own parameter names as keys.

```ts
import { defaultReadSignature, lineRangeSignature } from "@better-fs-tools/read/signature";

// The default schema, with your own descriptions.
export const documented = defaultReadSignature({
  description: "Read a file in the repository.",
  describe: { path: "Path relative to the repository root." },
});

// The same range model with other names.
export const renamed = defaultReadSignature({
  name: "read_file",
  names: { path: "file_path", offset: "start", limit: "max_lines" },
});

// Inclusive start_line and end_line in place of offset and limit.
export const lineRange = lineRangeSignature({
  name: "read_file",
  names: { path: "file_path", start: "start_line", end: "end_line" },
});
```

With `lineRangeSignature`, a truncated read tells the model to continue with `{"file_path":"src/a.ts","start_line":101,"end_line":200}`. The structured result stays canonical: `result.continuation.next` is still `{ path, offset, limit }`.

`createAiSdkReadTool()` and `createPiReadTool()` wire the retry wording for you with `readSignatureMessages(signature)`. If you call the core yourself behind a signature, pass `messages: readSignatureMessages(signature)`. Otherwise the retry text uses `path`, `offset`, and `limit`.

The core has no alias repair. The default signature refuses `file_path` or `start_line`. To accept those names, choose a signature that uses them. For another shape, write your own `ReadSignature`. Keep `toInput` pure and synchronous. The core still validates what `toInput` returns, so a signature cannot skip the path checks or the `maxLines` clamp.

The tool reads one path for each call. For multi-file reads or globs, call the core `read()` from your own tool.

## Path resolution

`resolve` rewrites the requested path before the filesystem opens it. A resolver returns one path, or reports "not found". It cannot grant access. The filesystem still checks roots, deny roots, realpath, and file type on the result.

```ts
import { homedir } from "node:os";
import { createNodeReadTool, nodeFileSystem } from "@better-fs-tools/node";
import { expandHome, pathResolvers, stripPrefixes, unicodeRepair } from "@better-fs-tools/read";

const cwd = process.cwd();
const home = homedir();

export const read = createNodeReadTool({
  fs: nodeFileSystem({ cwd, allowedRoots: [cwd, `${home}/.config/app`] }),
  resolve: pathResolvers(
    stripPrefixes(), // "file:///x" and "@src/x"
    expandHome({ home }), // "~" and "~/x"
    unicodeRepair(), // macOS U+202F screenshot names
  ),
});
```

| Resolver                                       | Effect                                                                                                                                                                                                                                        |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `stripPrefixes({ fileUrl, at })`               | Removes a `file://` prefix (percent-decoded) or a leading `@`. Both default to `true`.                                                                                                                                                        |
| `expandHome({ home })`                         | Expands `~` and `~/…`. Other `~user` forms pass through. A path outside the allowed roots still fails with `OUTSIDE_ALLOWED_ROOTS`.                                                                                                           |
| `reanchorLeadingSlash({ firstSegmentExists })` | Reads `/src/x` as `src/x` when your callback says that `src` exists under the tool root.                                                                                                                                                      |
| `unicodeRepair({ note })`                      | Lists the parent folder. When exactly one entry matches by Unicode form, narrow or non-breaking space, or typographic quote, it opens that entry. `note: true` (the default) adds a `path-repaired` note. `note: false` repairs with no note. |
| `pathResolvers(...steps)`                      | Runs resolvers left to right. The first "not found" stops the chain.                                                                                                                                                                          |

A read gets one bounded directory listing for its resolvers, through `ctx.list()`. `authorize` checks that listing with `action: "list"`. A second `ctx.list()` in the same read gets a refused outcome. `unicodeRepair()` uses the listing on every read, also when the file exists, so it is off by default.

When a resolver changes the path, `result.file.resolvedFrom` holds the path that the model sent. It is `null` when nothing changed. `file.requestedPath` is always the model's path. Retries and continuations use the model's path, so the resolver runs again on the next call.

`stripPrefixes()` also strips the `@` of a scoped name such as `@types/node/index.d.ts`. Pass `stripPrefixes({ at: false })` if your paths start with `@`.

To write your own resolver:

```ts
import type { PathResolver } from "@better-fs-tools/read";

export const workspaceAlias: PathResolver<unknown> = {
  id: "workspace-alias",
  resolve: (path) =>
    path.startsWith("$WS/")
      ? { kind: "path", path: `/workspace/${path.slice(4)}` }
      : { kind: "path", path },
};
```

A resolver that throws gives `EXTENSION_FAILED`.

`PathResolver` takes a `ToolResolveContext`: `tool`, `messages`, `digest`, `clock`, `call`, `paths`, and `list()`. It does not see the read request, so the same resolver works for the write tools. The read core passes its full context, with `request` and `limits`, and `ctx.tool` is `"read"`.

## Suggestions on a miss

When a file does not exist, the core lists the parent folder once, calls `suggest`, and returns `NOT_FOUND`. The names are in the note text and in `note.data.suggestions`. The core never opens a suggested name. The model must send a new call.

```text
[read:not-found] docs/Screen Shot 10.42 AM.png was not found. Nearby names: "Screen Shot 10.42 AM.png".
```

| Behaviour you want                       | Config                                                                |
| ---------------------------------------- | --------------------------------------------------------------------- |
| Suggestions only (Claude Code, OpenCode) | the default                                                           |
| Repair with a note                       | `resolve: unicodeRepair()`                                            |
| Repair with no note (Pi)                 | `resolve: unicodeRepair({ note: false })`                             |
| No listing on a miss                     | `suggest: null`                                                       |
| Your own ranking                         | `suggest: (ctx) => myRanker(ctx.name, ctx.entries).slice(0, ctx.max)` |

`defaultSuggest()` puts Unicode-equivalent names first, then close spellings. `limits.maxSuggestions` caps the list. The default does not repair: a miss that differs only by Unicode form returns `NOT_FOUND` with the correct name first, and the model retries once.

The listing goes through `authorize` with `action: "list"`. A denied listing, or a listing that fails, gives a plain `NOT_FOUND` with no names. A `suggest` function that throws gives `EXTENSION_FAILED`.

## Permissions

The filesystem owns the root policy: allowed roots, deny roots, and symlinks. `authorize` adds your own policy. The core calls it with `action: "read"` after the file is open and before the core reads any content byte. It also calls it with `action: "list"` before every directory listing.

What `open()` has fetched before `authorize` runs depends on the backend. `@better-fs-tools/cloudflare-shell` and `@better-fs-tools/just-bash` buffer the whole file inside `open()`, so those bytes have left the backend. `@better-fs-tools/cloudflare-computer` does not buffer: its `open()` starts a `readFile` stream, so the request reaches the backend, but it reads no chunk before `authorize`. `nodeFileSystem` streams, and `memoryFileSystem` already holds the bytes. In every case the core passes no byte to a classifier, a converter, or the model until `authorize` allows it. If a denied read must not reach the backend, refuse the path in the filesystem with a deny root, or leave it out of the allowed roots.

```ts
import { createNodeReadTool } from "@better-fs-tools/node";
import { askUser, readAuthorizers, denyPaths, sizeCeiling } from "@better-fs-tools/read";

// Your own prompt, for example a dialog in your UI.
declare function confirmInUi(question: string): Promise<boolean>;

export const read = createNodeReadTool({
  authorize: readAuthorizers(
    denyPaths(["**/.env", "**/.env.*", "**/*.pem"]),
    sizeCeiling({ maxBytes: 256 * 1024, unrangedOnly: true }),
    askUser(async (target) => confirmInUi(`Read ${target.displayPath}?`)),
  ),
});
```

| Authorizer                                | Effect                                                                                                                                                                                                                                                                                                                                             |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `denyPaths(globs)`                        | Refuses every action whose `resolvedPath` matches a glob (`**`, `*`, `?`). For a read, `resolvedPath` is the realpath, so a symlink `config -> .env` is refused too. It is a `ToolAuthorizer`, so it fits every tool. On the bash tool, `denyPaths()` sees the working directory, not the files a command touches, so it does not stop `cat .env`. |
| `sizeCeiling({ maxBytes, unrangedOnly })` | Refuses a read of a file larger than `maxBytes`. With `unrangedOnly: true`, a read with an explicit `offset` or `limit` is allowed, and the refusal note offers a ranged retry. A file with an unknown size is allowed.                                                                                                                            |
| `askUser(prompt)`                         | Calls `prompt(target, ctx)` for each read, not for listings. Only `true` allows. `false` or a throw refuses.                                                                                                                                                                                                                                       |
| `readAuthorizers(...steps)`               | Runs in order. The first refusal wins. Allow notes from every step are kept.                                                                                                                                                                                                                                                                       |

A custom authorizer returns `{ allow: true, notes? }` or `{ allow: false, note? }`:

```ts
import type { ReadAuthorizer } from "@better-fs-tools/read";

export const noLockfiles: ReadAuthorizer<unknown> = {
  id: "no-lockfiles",
  authorize: (target, ctx) =>
    target.action === "read" && target.resolvedPath.endsWith(".lock")
      ? {
          allow: false,
          note: {
            code: "denied",
            severity: "warning",
            message: ctx.messages.denied({
              path: target.requestedPath,
              detail: "lockfiles are off",
            }),
          },
        }
      : { allow: true },
};
```

`ctx.messages.denied({ path, detail })` gives the host's refusal text. It takes a path, not the read request, so tool-neutral authorizers can use it. A `ToolAuthorizer` sees only `action`, `requestedPath`, `resolvedPath`, and `displayPath`, and a context with no read request. It fits the read tool's `ReadAuthorizer` and the write tools' authorizers. Every authorizer type declares `authorize` as a function property, so TypeScript refuses a read authorizer such as `sizeCeiling()` in a write or bash tool, also through a `ToolAuthorizer` variable. `compileGlob(pattern)` is the matcher `denyPaths` uses.

A refusal always gives `DENIED`. The authorizer's note replaces the default `denied` message: the error note keeps its message, data, and retry, takes the code `denied` and severity `warning`, and has the authorizer's own code in `data.source`, as in write and bash. A `DENIED` result has `file: null`, so it does not show the real path behind a link. An authorizer that throws gives `EXTENSION_FAILED`.

An authorizer can only refuse. It never sees a file that the filesystem refused. `askUser` has no memory of earlier answers. To remember an answer, keep it in your host, for example through `ctx.call.host` (see [Host context and state](#host-context-and-state)).

While a prompt waits, the file stays open. If the file changes during the wait, the read returns `CHANGED_DURING_READ`. If the call is aborted, the read returns `ABORTED` and closes the file, also when the prompt ignores `ctx.call.signal`.

## Binary detection

`classifiers` is an ordered list. Each classifier sees a bounded sample of the file (`limits.sampleBytes`). The first classifier with an opinion wins.

The default chain detects images, PDFs, Office documents, notebooks, binary content, and text encodings. It returns these `unsupported` codes: `IMAGE`, `PDF`, `OFFICE_DOCUMENT`, `NOTEBOOK`, `BINARY`, and `UNKNOWN_ENCODING`. Each refusal has a note with code `unsupported-<code>`, for example `unsupported-pdf`.

To detect by extension, or to change a refusal message:

```ts
import { memoryFileSystem } from "@better-fs-tools/fs";
import { createReadTool, defaultClassifiers, extensionClassifier } from "@better-fs-tools/read";

export const read = createReadTool({
  fs: memoryFileSystem(),
  classifiers: [
    extensionClassifier({
      unsupported: {
        ".sqlite": { code: "BINARY" },
        ".png": { code: "IMAGE", mimeType: "image/png" },
      },
      text: [".lock"],
    }),
    ...defaultClassifiers({ notes: { PDF: { message: "PDFs are not supported here." } } }),
  ],
});
```

A classifier only decides what a file is. A converter changes the content.

## File conversion, images, and directories

`converters` is a list. It runs after classification. The first file converter whose `accepts` returns `true` handles the file. The first directory converter handles directories. With no converters, text is read, other formats are `unsupported`, and a directory gives `NOT_A_FILE`.

```ts
import { createNodeReadTool } from "@better-fs-tools/node";
import {
  directoryListing,
  imageConverter,
  notebookConverter,
  textConverter,
} from "@better-fs-tools/read";

// Your own PDF extraction, for example a pdftotext process that reads stdin.
declare function pdfToText(source: AsyncIterable<Uint8Array>): AsyncIterable<string>;

export const read = createNodeReadTool({
  converters: [
    imageConverter(),
    notebookConverter({ outputs: false }),
    textConverter({
      id: "pdftotext",
      accepts: (match) =>
        match.classification.kind === "unsupported" && match.classification.code === "PDF",
      mimeType: "text/plain",
      run: (source) => pdfToText(source),
    }),
    directoryListing({ trailingSlash: true }),
  ],
});
```

| Converter                                       | Result                                                                                                                                 |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `imageConverter({ transform })`                 | Accepts code `IMAGE`. Gives a `media` result with the image as one content part. `transform` can resize it.                            |
| `notebookConverter({ outputs })`                | Accepts code `NOTEBOOK`. Gives the cells as text. `outputs` defaults to `true`. Broken notebook JSON is refused as `INVALID_NOTEBOOK`. |
| `textConverter({ id, accepts, mimeType, run })` | Builds a text converter from a stream function, for example `pdftotext`, `pandoc`, or `markitdown` in your host.                       |
| `directoryListing({ trailingSlash, sort })`     | A directory becomes text, one entry for each line. `sort` is `"name"` (the default) or `"type-then-name"`.                             |

A converter returns one of these outcomes:

- `{ kind: "text", text, mimeType, notes? }`: a string, or an async stream of strings.
- `{ kind: "media", parts, notes? }`: content parts, for example an image. The result status is `media`.
- `{ kind: "refuse", code, note }`: an `unsupported` result with that code.

`accepts` is the only place where a converter can decline. It is synchronous.

Converted text goes through the normal scanner. `offset`, `limit`, line clamping, the byte limits, the budget, and continuation work on the converted lines. For a directory they work on entries. `ReadOk.conversion` names the converter. `classification` keeps what the classifier said, so a converted notebook still has `code: "NOTEBOOK"`.

A file converter reads the file through a stream that the core owns. It starts at byte 0 and stops at `limits.maxConvertBytes`. A larger file gives `unsupported` with code `TOO_LARGE`, also when the converter catches the error. Media parts larger than `limits.maxMediaBytes` in total also give `TOO_LARGE`. When a converter stops early, the core still reads the rest of the source within the cap. So `observation.contentId` is always the hash of the whole source, and the change check runs after every conversion. A converter never gets the path to open.

A directory listing goes through `authorize` with `action: "list"`, on the realpath that `fs.open()` reported. It stops at `limits.maxDirectoryEntries`, with a `directory-truncated` note. A directory result has `observation: null`, because a directory has no content to verify.

Conversion runs again on each continuation read. Cache inside your converter if it is slow. A converter that runs a process needs a process runtime, so it does not work in a Cloudflare Worker.

## Limits and the token budget

| Limit                 | Default | Meaning                                               |
| --------------------- | ------- | ----------------------------------------------------- |
| `maxLines`            | 2,000   | Lines in the view. Also the ceiling for `limit`.      |
| `maxViewBytes`        | 128 KiB | UTF-8 bytes of source text in the view                |
| `maxCharsPerLine`     | 2,000   | Characters in one line before it is clamped           |
| `maxScanBytes`        | 64 MiB  | Bytes scanned before totals and content identity stop |
| `sampleBytes`         | 8 KiB   | Bytes given to classifiers. At most `maxScanBytes`.   |
| `maxDirectoryEntries` | 200     | Entries in one listing                                |
| `maxSuggestions`      | 5       | Suggested names on a miss                             |
| `maxConvertBytes`     | 64 MiB  | Source bytes that a converter can read                |
| `maxMediaBytes`       | 5 MiB   | Total bytes of media parts in one result              |

These are defaults, not ceilings. You can set any positive safe integer.

A `limit` over `maxLines` is cut to `maxLines`, with a `clamped` info note. A `sampleBytes` that you set above `maxScanBytes` throws `TypeError`. When you set only `maxScanBytes` below 8 KiB, the default `sampleBytes` is lowered to it. The same limits rule holds in read, write, and bash.

Every tool has one parse helper with the same pattern: `parseReadInput`, `parseEditInput`, `parseWriteInput`, `parseApplyPatchInput`, and `parseBashInput`. Each takes the canonical input and the resolved limits, returns the request, and throws `TypeError` for input it refuses. The tool turns that throw into `INVALID_INPUT`. A clamp is not an error: the helper returns the clamped value, and the tool adds the `clamped` note.

For a token limit, set `budget`. The scanner stops at the last whole line that fits, and the result has a normal continuation. The truncation reason is `"budget"`.

```ts
import { createNodeReadTool } from "@better-fs-tools/node";
import { charsPerToken } from "@better-fs-tools/read";

export const read = createNodeReadTool({
  limits: { maxLines: 1_000, maxViewBytes: 64 * 1024 },
  budget: charsPerToken({ ratio: 4, max: 25_000 }),
});
```

`charsPerToken({ ratio, max })` costs each line `ceil(text.length / ratio) + 1`. You can write your own `ViewBudget` with a `measure(text)` function. It must be synchronous and fast, because the scanner calls it for each line. A budget can only stop the view earlier. It never stops the first line of a view, so a very long line cannot make the model repeat the same call. That line is still bounded by `maxViewBytes` and `maxCharsPerLine`.

For a size ceiling that refuses a whole file, use the `sizeCeiling` authorizer.

## After-read hooks

`hooks` is an ordered list of `afterRead` functions. They run after the scan and change detection, and before the result is recorded and formatted.

```ts
import { createNodeReadTool } from "@better-fs-tools/node";
import { memoryStore, redact, repeatReadGuard } from "@better-fs-tools/read";

// createNodeReadTool sets digest to nodeDigest(), which repeatReadGuard needs.
export const read = createNodeReadTool({
  state: memoryStore(),
  hooks: [repeatReadGuard(), redact({ patterns: [/AKIA[0-9A-Z]{16}/g] })],
});
```

| Hook                                | Effect                                                                                                                                                                                              |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `repeatReadGuard({ message })`      | When the model reads the same unchanged range again, it replaces the view with an empty one and adds a `repeat-read` note. Needs `state` and a `digest`. A record from a write tool never fires it. |
| `redact({ patterns, replacement })` | Replaces matches in the view lines and text parts before the model or the store sees them. Each pattern needs the `g` flag. The default replacement is `[REDACTED]`.                                |

A hook gets the outcome and a context with `previous`, the stored record from before this read (or `null`). It returns an outcome. A hook can change the view lines, the notes, and the content parts. It can also replace the view with an empty one. It cannot change `request`, `file`, `classification`, `conversion`, `truncation`, `continuation`, `totals`, or `observation`. It cannot turn an error or an `unsupported` result into a success. A hook that breaks a rule, or throws, gives `EXTENSION_FAILED`.

When a hook changes the view, the core adds a `view-modified` note that names the hook, recomputes `observation.viewId`, and sets `observation.wholeFileVisible` to `false`. A later write tool then does not treat a redacted view as the whole file.

Hooks run for every outcome that has a request, including failures and refusals. They do not run for `INVALID_INPUT` or `ABORTED`.

Hooks run as host code. If a hook reads other files, it does so with your own permissions, and the tool does not check those reads. For example, this hook adds a nearby `AGENTS.md` as a note:

```ts
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ReadHook } from "@better-fs-tools/read";

// Host code: it reads AGENTS.md with the host's own permissions.
export const agentsNote: ReadHook<unknown> = {
  id: "agents-note",
  async afterRead(outcome) {
    if (outcome.status !== "ok") return outcome;
    const path = join(dirname(outcome.file.resolvedPath), "AGENTS.md");
    const text = await readFile(path, "utf8").catch(() => null);
    if (text === null) return outcome;
    const note = { code: "agents-md", severity: "info" as const, message: text.slice(0, 4_000) };
    return { ...outcome, notes: [...outcome.notes, note] };
  },
};
```

A repeat read that the guard empties is recorded as it was shown, with `wholeFileVisible: false`. Redaction works line by line, so a secret split across two lines is not matched.

## Output format

The formatter turns the structured outcome into what the model sees. It returns a string or a list of content parts.

The default is `lineNumberFormatter()`:

```text
1|import { createReadTool } from "./index.js";
2|export { createReadTool };

[read:continue] Output stopped at the line limit. Continue with {"path":"src/a.ts","offset":3,"limit":2}.
```

Its options:

| Option                 | Use                                                                    |
| ---------------------- | ---------------------------------------------------------------------- |
| `gutter(line, ctx)`    | Line prefix. Default `1\|`.                                            |
| `clampMarker(line)`    | Text after a clamped line. Default `… [line truncated at 2000 chars]`. |
| `header(outcome, ctx)` | A line before the body, or `null` for none                             |
| `footer(outcome, ctx)` | A line after the body, or `null` for none                              |
| `notes(note)`          | Rewrite a note for display, or return `null` to hide it                |
| `noteLine(note)`       | The text of one note line. Default `[read:<code>] <message>`.          |

Helpers for common formats:

```ts
import { createNodeReadTool } from "@better-fs-tools/node";
import {
  eofFooter,
  fileHashHeader,
  hashlineGutter,
  lineNumberFormatter,
} from "@better-fs-tools/read";

export const read = createNodeReadTool({
  formatter: lineNumberFormatter({
    gutter: hashlineGutter({ width: 2 }), // "12:a3|text"
    header: fileHashHeader(), // "file-hash: sha256:..."
    footer: eofFooter((n) => `(End of file - total ${n} lines)`),
    notes: (note) => (note.severity === "info" ? null : note),
  }),
});
```

- `hashlineGutter({ width })` adds a short hash of each line, for example `12:a3|`. The hash comes from the `digest`, so it is stable across reads and changes when the line changes. With no digest it falls back to `12|`.
- `fileHashHeader()` prints `file-hash: <contentId>`. It prints nothing when there is no digest, or when the scan limit stopped before the end of the file.
- `eofFooter(text)` prints a line when the view reaches the end of the file. It skips directory listings.
- `plainFormatter()` gives the source with no gutter. A model can paste it back into an edit call.
- `jsonFormatter({ pick, notes, space })` gives JSON text. `pick` chooses the fields. `notes: "after"` puts note lines after the JSON. Media bytes are left out of the JSON and returned as media parts.

Presets that copy the read output of other harnesses are in `@better-fs-tools/read/formats`: `opencodeFormat()`, `deepAgentsFormat()`, `hashlineFormat()`, and `hermesFormat()`. They take no options.

```ts
import { createNodeReadTool } from "@better-fs-tools/node";
import { opencodeFormat } from "@better-fs-tools/read/formats";

export const read = createNodeReadTool({ formatter: opencodeFormat() });
```

A custom formatter implements `format(outcome, ctx)`. It is synchronous and pure over the outcome. `ctx` has the `digest`, the `limits`, the `call`, and a `mode`. The mode is `"model"` for model output and `"view"` for the body only, with no notes, header, or footer. The Pi adapter uses `"view"` for its truncation details. If your formatter returns parts in `"view"` mode, Pi leaves those details out. A formatter sees only the finished outcome. It cannot read the file. If the formatter throws or returns neither a string nor an array, the call still succeeds: the core formats the result with `lineNumberFormatter()` and adds no note.

## Messages and notes

Every note has a `code`, a `severity`, and a `message`. It can also have `data`, and a `retry` for notes that continue a read:

```text
{ code: "continue", severity: "info", message: "Output stopped at the line limit. Continue with ...",
  retry: { path: "src/a.ts", offset: 51, limit: 50 }, data: { reason: "lines" } }
```

Key your code on `code`, not on the wording. You can change notes in four places:

| To change                                | Use                                                     |
| ---------------------------------------- | ------------------------------------------------------- |
| The wording of a core note               | `messages`                                              |
| How a retry call is printed              | `messages.retry`, or `readSignatureMessages(signature)` |
| The wording of a format refusal          | `defaultClassifiers({ notes })`                         |
| How a note looks in the text, or hide it | formatter `notes` or `noteLine`                         |
| The note in the structured result        | an `afterRead` hook that rewrites `outcome.notes`       |

No default message names `offset` or `limit`. Every message that suggests a retry prints it with `messages.retry`. The structured `truncation` and `continuation` fields always stay in the result. If you hide the `continue` note, your code can still read `result.continuation`.

## The result

`ReadResult` is the outcome plus `content`, the formatter's parts for the model. Every result has `tool: "read"` and a `status`. The outcome is a union on `status`: only the `error` variant has `error: { code, phase, message, data? }`, the same shape as the write and bash errors.

| Status        | Meaning                                                                                         |
| ------------- | ----------------------------------------------------------------------------------------------- |
| `ok`          | A text view. `view.lines` has the structured lines. An empty file is `ok` with an `empty` note. |
| `media`       | Content parts from a converter, for example an image.                                           |
| `unsupported` | A classifier or converter refused the format. `code` is open, for example `PDF` or `TOO_LARGE`. |
| `error`       | `error.code` is one of thirteen `ReadErrorCode` values.                                         |

The error codes are `INVALID_INPUT`, `NOT_FOUND`, `NOT_A_FILE`, `DANGEROUS_PATH`, `OUTSIDE_ALLOWED_ROOTS`, `PERMISSION_DENIED`, `DENIED`, `TOO_LARGE`, `CHANGED_DURING_READ`, `ABORTED`, `UNSUPPORTED_BACKEND`, `EXTENSION_FAILED`, and `IO_ERROR`. `TOO_LARGE` is an `error` when a backend byte ceiling refuses the file, and an `unsupported` code when a converter or media limit stops it. `EXTENSION_FAILED` means that host code threw or broke a rule. Its note data names the dependency and the stage, for example `{ extension: "hooks", phase: "hooks", id: "redact" }`.

An `ok` result has structured lines, and an `error` result has its error:

```ts
import { memoryFileSystem } from "@better-fs-tools/fs";
import { createReadTool } from "@better-fs-tools/read";

const read = createReadTool({ fs: memoryFileSystem({ files: { "/a.ts": "const a = 1;\n" } }) });
const result = await read({ path: "/a.ts" });

if (result.status === "ok") {
  console.log(result.view.lines); // [{ number: 1, text: "const a = 1;", clamped: false, sourceChars: null }]
  console.log(result.view.bytes); // 12: source bytes, before the gutter
  console.log(result.continuation); // { available: false, next: null }
  console.log(result.totals); // { lines: 1, exact: true, bytes: 13 }
  console.log(result.file.resolvedFrom); // null: no resolver changed the path
} else if (result.status === "error") {
  console.log(result.error.code, result.error.phase); // only the error variant has `error`
}
```

A content part is `{ type: "text", text }` or `{ type: "media", mediaType, data, name? }`. `data` is a `Uint8Array`.

[docs/result-schema.md](docs/result-schema.md) lists every field, every error code with its phase, and every note code. `docs/result-schema.md` in [`@better-fs-tools/write`](https://www.npmjs.com/package/@better-fs-tools/write) has one table of the statuses and error codes of all five tools.

## Host context and state

Each call can carry a context: `{ signal?, callId?, host? }`. Adapters build it. The AI SDK adapter puts its `ToolExecutionOptions` in `host`, and the Pi adapter puts Pi's `ExtensionContext` there. The core passes the same `call` object to every stage and host function (`ctx.call`). The core never reads `host`, and `host` never appears in the result, the stored record, notes, or content.

With a host type, the context and its `host` are required. With no host type, the context is optional:

```ts
import { memoryFileSystem } from "@better-fs-tools/fs";
import { nodeDigest } from "@better-fs-tools/node";
import { askUser, createReadTool, memoryStore } from "@better-fs-tools/read";
import type { ReadStateStore } from "@better-fs-tools/read";

interface Session {
  readonly id: string;
  confirm(question: string): Promise<boolean>;
}

const stores = new Map<string, ReadStateStore>();

const read = createReadTool<Session>({
  fs: memoryFileSystem({ files: { "/a.txt": "alpha\n" } }),
  // Called at most once for each read, and only when the core needs a store.
  state: (call) => {
    let store = stores.get(call.host.id);
    if (store === undefined) stores.set(call.host.id, (store = memoryStore()));
    return store;
  },
  // A state needs a digest: a record names the digest that made it.
  digest: nodeDigest(),
  authorize: askUser<Session>((target, ctx) =>
    ctx.call.host.confirm(`Read ${target.displayPath}?`),
  ),
});

// With a host type, the context and its host are required.
const session: Session = { id: "s1", confirm: async () => true };
await read({ path: "/a.txt" }, { host: session, callId: "call-1" });
```

- `fs` can be a function of the call. It runs once for each read, before `resolve`. Use it to choose a backend for each call.
- `sha256Digest()` is SHA-256 in plain JavaScript. It is synchronous and needs no Node module, so it works in a Cloudflare Worker. Its id and its values (`sha256:<hex>`) are the same as `nodeDigest()`, so records from either one match.
- `state` needs a `digest`, because a record names the digest that made it. `createReadTool` throws `TypeError` for a `state` without a `digest`, and the dependency type (`StateNeedsDigest`) refuses it at compile time. `StateNeedsDigestOrDefault` is the same rule for a factory with its own default digest, such as the Node and Pi factories: leave `digest` out for the default, or pass `digest: null` with no `state`. The bundles (`createFsTools()` and the host bundles that wrap it) always have a digest, so they need neither.
- `state` can be a function of the call. It runs at most once for each read, and only when the core needs the store. Return `null` for no store. A factory that throws gives `EXTENSION_FAILED`. A store whose `get` or `put` fails never fails the read.
- The record key is `file.resolvedPath`. A read stores a `ReadRecord` with `schema: 2` and `origin: "read"`. It holds the backend `version`, the `digest` id, the content and view ids, and the read range. The write tools store records with `origin: "write"` and `request: null` after a commit. A record of another schema counts as absent.
- `result.file.version` is the backend's change token from `open()`, or `null`. It is kept when the backend has no identity capability.
- `memoryStore()` from `@better-fs-tools/read` keeps records in memory, with a size cap and a TTL. Its `clock` option is the same `Clock` (`() => Date`) that the tools take, so one fake clock fits both. It sits on the root of the package that owns `ReadStateStore`, as `memoryLocks()` sits on the root of `@better-fs-tools/write`, which owns `LockManager`.
- The helpers in this package are typed with `unknown` for the host, so they fit a tool with any host type. `askUser`, `imageConverter`, and `textConverter` can take your host type, as `askUser<Session>` does above.

## Security guarantees

Your dependencies can narrow access. They cannot widen it.

- The filesystem is the only place that grants access. It checks roots, deny roots, the realpath, and the type in one `open()` call. `resolve` runs before it and `authorize` runs after it.
- Each read opens at most one file. A resolver only changes the path that goes into that open.
- `nodeFileSystem` opens files with `O_NOFOLLOW | O_NONBLOCK` and checks the type first. It refuses directories, FIFOs, sockets, and devices before any content read. It refuses `/dev`, `/proc`, and `/sys` before it touches the filesystem.
- The core reads no content byte before `authorize` allows it, so no content reaches a classifier, a converter, or the model. `@better-fs-tools/cloudflare-shell` and `@better-fs-tools/just-bash` have already fetched the whole file in `open()`. `@better-fs-tools/cloudflare-computer` has started a `readFile` stream but read no chunk. If a denied read must not reach the backend, use a deny root, or leave the path out of the filesystem's allowed roots.
- The scan is bounded. Converters get a capped stream from the open file, never a path.
- Change detection runs after the scan and after conversion. A file that changed returns `CHANGED_DURING_READ`.
- A suggested name is never opened.
- A hook cannot turn a failure into a success. A hook that changes the view marks the observation as partial.
- A `DENIED` result does not show the file behind the path.

## Host adapters

Each adapter owns the signature, abort forwarding, and the mapping from `result.content` to the framework's content types. The adapters accept every core dependency and pass it through.

| Package                                                                            | Factory                        | Notes                                                                                                                                                  |
| ---------------------------------------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`@better-fs-tools/ai-sdk`](https://www.npmjs.com/package/@better-fs-tools/ai-sdk) | `createAiSdkReadTool(options)` | `execute` returns the whole `ReadResult`. `toModelOutput` maps media parts to AI SDK `file` parts. You pass `fs`.                                      |
| [`@better-fs-tools/pi`](https://www.npmjs.com/package/@better-fs-tools/pi)         | `createPiReadTool(options)`    | Each call is confined to Pi's `ctx.cwd`. `fs`, `cwd`, and `allowedRoots` are refused. The `pi.extensions` entry registers `read`, `edit`, and `write`. |
| [`@better-fs-tools/node`](https://www.npmjs.com/package/@better-fs-tools/node)     | `createNodeReadTool(options?)` | The core with Node defaults, for your own tool.                                                                                                        |

Cloudflare Agents hosts use `@better-fs-tools/ai-sdk` with `cloudflareShellFileSystem` from [`@better-fs-tools/cloudflare-shell`](https://www.npmjs.com/package/@better-fs-tools/cloudflare-shell). [`@better-fs-tools/cloudflare-computer`](https://www.npmjs.com/package/@better-fs-tools/cloudflare-computer) and [`@better-fs-tools/just-bash`](https://www.npmjs.com/package/@better-fs-tools/just-bash) are filesystems. Use them with `createReadTool()` or with an adapter.

`docs/hosts.md` in [`@better-fs-tools/write`](https://www.npmjs.com/package/@better-fs-tools/write) lists the defaults of every host and bundle, and what each backend can do.

## Exports

| Entry                             | Contents                                                                                                                                                                                  |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@better-fs-tools/read`           | `createReadTool`, `textOf`, `parseReadInput`, `memoryStore`, limits, messages, classifiers, resolvers, suggestions, authorizers, converters, hooks, the budget, formatters, and the types |
| `@better-fs-tools/read/signature` | `defaultReadSignature`, `lineRangeSignature`, `readSignatureMessages`, and the read signature types                                                                                       |
| `@better-fs-tools/read/formats`   | `opencodeFormat`, `deepAgentsFormat`, `hashlineFormat`, `hermesFormat`                                                                                                                    |

The package has no peers and imports no `node:` module, so it runs in Node, Bun, browsers, and Cloudflare Workers. It does not re-export the `fs` types. Import `FileSystem` and the other filesystem types from `@better-fs-tools/fs`. `ReadStateStore` and `ReadRecord` come from `@better-fs-tools/read`.

The root entry also exports the tool-neutral base types that `@better-fs-tools/write` builds on: `ToolCallContext`, `ToolName`, `Note`, `ToolError`, `ToolMessages`, `ToolHookContext`, `ToolResolveContext`, `AccessTarget`, `AccessDecision`, `ToolAuthorizer`, `ToolSignature`, and `SignatureDocs`. `ReadContext` extends `ToolCallContext`, `ReadNote` extends `Note`, `ReadMessageCatalog` extends `ToolMessages`, and `ReadSignature` extends `ToolSignature`.

## A host that changes everything

This Pi host sets most dimensions. You will usually need only a few of these options.

```ts
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createPiReadTool } from "@better-fs-tools/pi";
import { lineRangeSignature } from "@better-fs-tools/read/signature";
import {
  askUser,
  denyPaths,
  directoryListing,
  eofFooter,
  imageConverter,
  lineNumberFormatter,
  memoryStore,
  pathResolvers,
  readAuthorizers,
  redact,
  repeatReadGuard,
  sizeCeiling,
  stripPrefixes,
  unicodeRepair,
} from "@better-fs-tools/read";

const stores = new Map<string, ReturnType<typeof memoryStore>>();

export const read = createPiReadTool({
  signature: lineRangeSignature({
    name: "read",
    names: { path: "file_path", start: "start_line", end: "end_line" },
  }),
  resolve: pathResolvers(stripPrefixes(), unicodeRepair({ note: false })),
  authorize: readAuthorizers(
    denyPaths(["**/.env", "**/.env.*"]),
    sizeCeiling({ maxBytes: 256 * 1024, unrangedOnly: true }),
    askUser<ExtensionContext>(async (target, ctx) => {
      const pi = ctx.call.host;
      if (!pi.hasUI) return false;
      return pi.ui.confirm("Read file?", target.displayPath, { signal: ctx.call.signal });
    }),
  ),
  converters: [imageConverter(), directoryListing({ trailingSlash: true })],
  state: (call) => {
    const id = call.host.sessionManager.getSessionId();
    let store = stores.get(id);
    if (store === undefined) stores.set(id, (store = memoryStore()));
    return store;
  },
  hooks: [repeatReadGuard(), redact({ patterns: [/AKIA[0-9A-Z]{16}/g] })],
  formatter: lineNumberFormatter({ footer: eofFooter((n) => `(End of file, ${n} lines)`) }),
});
```

The repository keeps this host in `examples/custom-host.ts`, and CI type-checks it.

## Writing a filesystem adapter

Implement `FileSystem` from `@better-fs-tools/fs`. `open()` resolves the path, checks access and type, and returns one handle. The handle has a single-use `bytes()`, a `verify()` that reports whether the file changed, and a `close()`. An optional `list()` returns a bounded directory listing. When `open()` refuses a directory, FIFO, socket, or device, return a `not-a-file` error with its `kind` and, for a directory, its `target`.

Then check it with the conformance suite:

```ts
import { memoryFileSystem, runFileSystemConformance } from "@better-fs-tools/fs";

// Replace the memory filesystem with your own FileSystem.
const fs = memoryFileSystem({ files: { "/a.txt": "alpha\n" }, directories: ["/dir"] });

const report = await runFileSystemConformance(fs, {
  existingFile: { path: "/a.txt", bytes: new TextEncoder().encode("alpha\n") },
  missingPath: "/missing.txt",
  directoryPath: "/dir",
  listDirectory: "/",
});
console.log(report.passed); // true when the adapter keeps the contract
```

[docs/architecture.md](docs/architecture.md) explains what the core expects from a filesystem.

## Runtime

The build output is ESNext JavaScript modules. It needs a current runtime with `AbortSignal`, `TextEncoder`, `TextDecoder`, and async iterators, for example Node 24, Bun, a current browser, or Cloudflare Workers. This release supports POSIX paths only. The write tools are in [`@better-fs-tools/write`](https://www.npmjs.com/package/@better-fs-tools/write).
