# Architecture

This page explains how `@better-fs-tools/read` runs one read, and why it is built this way. [result-schema.md](result-schema.md) describes the result. The [README](../README.md) shows how to configure each step.

## The pipeline

```text
read(input, ctx?)
  │  parseReadInput ........... strict canonical validation, limit clamp
  │  fs(call) ................. once; a FileSystem or a factory result
  ▼
ReadRequest { path, offset, limit, ranged }
  │  resolve .................. one path, or not found; at most one ctx.list
  ▼
fs.open(path) ................. roots, deny roots, realpath, type check
  │   not found ──▶ suggest ... authorize(list) + one fs.list; NOT_FOUND with names
  │   directory ──▶ directory converter: authorize(list) + one fs.list ─▶ text lines ─▶ scan
  ▼
OpenFile (no content byte read yet)
  │  authorize(read) .......... host policy on the open target
  ▼
sample (limits.sampleBytes) ─▶ classifiers (sync)
  │
  ├─ a FileConverter accepts ─▶ convert(capped bytes)
  │                               ├─ text  ─▶ scan
  │                               ├─ media ─▶ ReadMedia (size cap)
  │                               └─ refuse ─▶ ReadUnsupported
  ├─ text ──────────────────────────────────▶ scan (lines, view bytes, budget, clamp, scan cap)
  └─ unsupported ───────────────────────────▶ ReadUnsupported
  ▼
size check + handle.verify() .. change detection, also after conversion
  ▼
hooks.afterRead (in order) .... rule checks after each hook
  ▼
record ........................ state(call), only when there is an observation
  ▼
formatter.format(outcome, { mode: "model", call, ... }) ─▶ content
  ▼
ReadResult
```

| Stage               | Phase          | Dependency                   | What happens                                                                                                                                                                                                |
| ------------------- | -------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Input               | `input`        | `limits`                     | `parseReadInput` accepts only `path`, `offset`, and `limit`. The path must be a non-blank string with no NUL. `offset` and `limit` must be positive safe integers. `limit` is clamped to `limits.maxLines`. |
| Filesystem          | `open`         | `fs`                         | A `FileSystem`, or a factory of the call context. The factory runs once for each read.                                                                                                                      |
| Resolve             | `resolve`      | `resolve`                    | Changes the path string that goes into the one open, or reports not found.                                                                                                                                  |
| Open                | `open`         | `fs`, `suggest`              | One `fs.open()`. A miss lists the parent once for `suggest`. A directory goes to the first directory converter, if there is one.                                                                            |
| Authorize           | `authorize`    | `authorize`                  | Host policy on the open file, before the core reads any content byte. A buffered backend has already fetched the file in `open()`.                                                                          |
| Sample and classify | `sampling`     | `classifiers`                | Reads `limits.sampleBytes`, then asks each classifier in order. The first opinion wins.                                                                                                                     |
| Convert             | `conversion`   | `converters`                 | The first file converter that accepts the classification reads a capped stream from byte 0.                                                                                                                 |
| Scan                | `scan`         | `limits`, `budget`, `digest` | Decodes UTF-8, splits lines, selects the view, clamps, counts, and hashes.                                                                                                                                  |
| Verify              | `verification` | `fs`                         | Checks the size and asks the open handle whether the file changed.                                                                                                                                          |
| Hooks               | `hooks`        | `hooks`, `state`             | Each hook gets the outcome and the previous record, and returns an outcome.                                                                                                                                 |
| Record              | none           | `state`, `digest`            | Stores the observation. A store failure does not fail the read.                                                                                                                                             |
| Format              | none           | `formatter`, `messages`      | Turns the outcome into content parts.                                                                                                                                                                       |

The core owns line scanning, view selection, clamping, the byte limit, continuation arithmetic, change detection, and note assembly. That list is the reason the package exists. Everything else is a dependency.

## Source layout

| Path                                                                                                        | Role                                                                                                        |
| ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `src/contract/`                                                                                             | The public types, one file for each area. No runtime code. `base.ts` holds the tool-neutral types           |
| `src/core/create-read-tool.ts`, `core/deps.ts`                                                              | Checks and resolves the dependencies once, synchronously                                                    |
| `src/core/pipeline.ts`                                                                                      | The stage order, and nothing else                                                                           |
| `src/core/call-scope.ts`                                                                                    | Per-read state: the call object, the phase, `fs(call)`, `state(call)`, the listing budget, and abort checks |
| `src/core/resolve.ts`, `open.ts`, `suggest.ts`, `authorize.ts`                                              | Resolve, open, suggestions on a miss, and the authorize checks                                              |
| `src/core/sample.ts`, `classify.ts`                                                                         | The bounded sample and the classifier chain                                                                 |
| `src/core/convert.ts`, `convert-source.ts`, `converted.ts`, `directory.ts`                                  | Converter selection, the capped source stream, converted outcomes, and directory reads                      |
| `src/core/scan.ts`, `scanner.ts`, `cursor.ts`, `budget.ts`                                                  | The scan loop, the line scanner, chunk handling with abort racing, and the checked budget                   |
| `src/core/verify.ts`, `observation.ts`, `text-outcome.ts`, `notes.ts`                                       | Change detection, observations, the `ok` outcome, and truncation notes                                      |
| `src/core/hooks.ts`, `same.ts`, `record.ts`                                                                 | The hook runner and its rule checks, and the record                                                         |
| `src/core/outcomes.ts`, `extension-error.ts`, `format.ts`                                                   | Failures, `EXTENSION_FAILED`, the formatter call, and `textOf`                                              |
| `src/classifiers/`, `resolve/`, `suggest/`, `authorize/`, `converters/`, `hooks/`, `budget/`, `formatters/` | The built-in helpers, one file for each                                                                     |
| `src/signature/`, `src/formats/`, `src/state/`                                                              | The `./signature`, `./formats`, and `./state` subpaths                                                      |

## One call, one context

The adapter builds a `ReadContext` for each tool call: `{ signal?, callId?, host }`. It extends the tool-neutral `ToolCallContext`. The core passes this object by reference to every stage and every host function, as `ctx.call`. It never reads, copies, freezes, or stores `host`. `host` never appears in the result, the record, notes, or content.

`CallScope` holds the per-read state:

- `fs(call)` runs at most once, after input validation and before `resolve`. An abort before that point means the filesystem is never built.
- `state(call)` runs at most once, and only when the core needs the store: to read `previous` for the hooks, or to record an observation.
- A read has at most two listings. One is for a resolver (`ctx.list()`). The other is for suggestions or a directory converter. A second request for the same slot gets a `denied` list outcome with detail `listing budget spent`. `authorize` with `action: "list"` runs before each listing.
- A listing never throws. A missing `list()`, a denial, an abort, or a throwing backend becomes an error outcome. A throwing list authorizer is held and raised after the stage that listed, so a resolver cannot swallow it.
- The signal is checked before each stage and raced against each backend call. An abort gives `ABORTED` with the current phase, and no host code runs after it.

### Tool-neutral base types

`src/contract/base.ts` holds the types that the read tool and the write tools share: `ToolCallContext`, `ToolName`, `Note`, `ToolMessages`, `ToolHookContext`, `ToolResolveContext`, `PathResolver`, `ResolveOutcome`, `AccessTarget`, `AccessDecision`, and `ToolAuthorizer`. `@better-fs-tools/write` imports them from this package, so it has no copy of its own.

- `HookContext` extends `ToolHookContext` with `tool: "read"`, the request, and the limits. `ResolveContext` adds `paths` and `list()`, so it fits `ToolResolveContext`.
- Resolvers take a `ToolResolveContext`. The built-in resolvers never need the read request, so they work for every tool.
- `denyPaths` is a `ToolAuthorizer`. It sees only the fields every target has, and uses `ctx.messages.denied({ path, detail })`, which every tool's catalog has. A `ToolAuthorizer` fits the read `Authorizer`.
- The read `AuthorizeDecision` keeps `ReadNote`, so a denial can carry a `retry`. An `AccessDecision` fits it.

The public types keep `THost` out of conditional types. `ReadContext<THost>` is an interface with a required `host`. Only the `ReadTool<THost>` parameter type makes the context and `host` optional when `THost` includes `undefined`. With this shape, a helper typed with `unknown` for the host fits a tool with any host type. A conditional context type made `Formatter` and the other contexts invariant in `THost` under TypeScript 7, and then host-free helpers did not fit.

## Why the filesystem returns a handle

A contract with separate `stat(path)` and `readBytes(path)` calls cannot close the gap between the check and the read. So `open()` does the whole decision: resolve, check roots and deny roots, check the type, and open. It returns an `OpenFile`. The core calls the same members in the same order for every backend:

```text
handle.info      metadata, from the object that was opened
handle.bytes()   single-use AsyncIterable<Uint8Array>
handle.verify()  did the opened object change?
handle.close()   always, from a finally block
```

Two capabilities remain, and each one decides one thing:

- `streaming: false` adds a `buffered-backend` note.
- `identity: false` adds a `weak-identity` note, because the observation cannot back a write precondition.

An optional `list()` is the list capability. Without it, there are no suggestions and no directory listings.

When `open()` refuses a directory, FIFO, socket, or device, it returns a `not-a-file` error with a `kind`. For a directory it also gives a `target` with the resolved and display paths. A directory converter lists `target.resolvedPath`, and `authorize` sees that path. When the target is `null`, the core uses the lexical path.

## Scanning

`LineScanner` keeps the current line prefix, the selected view, the decoder state, and a few counters, and nothing else. Memory stays flat for a large file. Lines end at `\n`, `\r\n`, and a bare `\r`. A trailing newline does not add a line, so a file that ends with a newline has exact totals.

The view stops at the first of these limits, always at a line boundary:

- `lines`: `request.limit` lines were shown.
- `bytes`: the next line would pass `limits.maxViewBytes` of source text.
- `budget`: the next line would pass `budget.max`. The budget never stops the first line of a view.

Two more reasons can apply to the whole read:

- `line-length`: a line was longer than `limits.maxCharsPerLine` and was clamped. `line.sourceChars` keeps the original length.
- `scan-limit`: `limits.maxScanBytes` was reached. `totals.lines` and `observation.contentId` are then `null`.

The scan continues past the view to count lines and hash the content. When the view stops early, the first line that was not shown becomes `continuation.next`, a whole canonical input.

View bytes count source text plus one separator byte for each line after the first. They do not count the gutter. So a formatter can change or remove the gutter without changing what fits in a read.

If the sample looked like text but a later chunk is not valid UTF-8, the scan stops and the core asks the classifier chain for its `encodingFailure` refusal. Classifiers never run twice.

## Classification and conversion

Classifiers are synchronous and see only a bounded sample that is already in memory. The classifier that recognizes a format also owns the refusal note that the model sees, and the code in `ReadUnsupported.code`.

Converters come after classification. `accepts(match)` is synchronous, and it is the only place where a converter can decline. `convert` must return an outcome: text, media, or a refusal.

A file converter gets a stream that the core owns. The stream starts at byte 0 (the sample, then the rest of the file), counts and hashes the bytes, and stops at `limits.maxConvertBytes` with an internal error. The core turns that error into `unsupported` with code `TOO_LARGE`, also when the converter catches it. When a converter stops before the end, the core reads the rest of the source within the same cap. So `contentId` is always the hash of the whole source, and the size check can run. Converted text then goes through the same `LineScanner` as file text.

Media parts over `limits.maxMediaBytes` in total give `TOO_LARGE`. A media outcome has `wholeFileVisible: false`. Its `viewId` hashes the parts.

A directory has no handle. The directory converter gets one bounded listing through `CallScope`, and returns text. The text goes through the scanner, so `offset` and `limit` page over entries. A failed listing ends the read with the matching error. A directory result has `observation: null`, because there is nothing to verify.

## Change detection

After the scan or the conversion, the core checks the size when it reached the end, and calls `handle.verify()`. A changed file gives `CHANGED_DURING_READ` with a retry of the same range. This runs after an `askUser` prompt too, so an edit during the prompt is caught.

## Hooks

Hooks run in order after verification and before the record, for every outcome that has a request. They do not run for `INVALID_INPUT`, which has no request, or for `ABORTED`, because the caller has given up.

After each hook the core checks the rules:

- The status cannot move from `error` or `unsupported` to `ok` or `media`.
- `request`, `file`, `classification`, `conversion`, `truncation`, `continuation`, `totals`, and `observation` must be the same values. When the status changes, only the fields that both outcomes have are compared.

A hook that throws, returns something that is not an outcome, or breaks a rule gives `EXTENSION_FAILED`.

If a hook changed the view lines or the media parts, the core adds a `view-modified` note that names the hook, recomputes `observation.viewId` and `observation.id`, and sets `wholeFileVisible` to `false`. The stored record then matches what the model saw.

Hooks are host code. The model cannot choose which files a hook reads, so a hook that reads files uses the host's own permissions. The core does not check those reads.

## Observations and records

An observation exists when there is a `digest`:

| Field              | Value                                                                                            |
| ------------------ | ------------------------------------------------------------------------------------------------ |
| `statId`           | Hash of the resolved path, identity, size, and modification time                                 |
| `contentId`        | Hash of the source bytes. `null` when the scan stopped before the end.                           |
| `viewId`           | Hash of what the model saw: the view text, or the media parts                                    |
| `id`               | Hash of `statId`, `contentId`, and `viewId`                                                      |
| `wholeFileVisible` | `true` only when the offset is 1, nothing was truncated or clamped, and no hook changed the view |

The record stores these fields with the request range, under the key `file.resolvedPath`. It is schema 2: it also has `origin: "read"`, the backend `version`, and the `digest` id. The write tools store records with `origin: "write"` and `request: null` in the same store, so a later edit knows what the model has seen. The hook runner treats a record of another schema as absent, and `repeatReadGuard` ignores a write record. `record` builds it field by field from the outcome, so nothing from `call` reaches the store. A store whose `get` or `put` fails does not fail the read. A `state` factory that throws does.

## Errors

Filesystem adapters return typed reasons, and the core maps them one to one. The core never parses a detail string.

| Adapter reason          | Result code             |
| ----------------------- | ----------------------- |
| `not-found`             | `NOT_FOUND`             |
| `not-a-file`            | `NOT_A_FILE`            |
| `dangerous-path`        | `DANGEROUS_PATH`        |
| `outside-allowed-roots` | `OUTSIDE_ALLOWED_ROOTS` |
| `permission-denied`     | `PERMISSION_DENIED`     |
| `denied`                | `DENIED`                |
| `unsupported`           | `UNSUPPORTED_BACKEND`   |
| `aborted`               | `ABORTED`               |
| `io`                    | `IO_ERROR`              |

The core makes the other failures itself:

- `INVALID_INPUT` from `parseReadInput`.
- `DENIED` from an authorizer. It has `file: null`, so a denial does not show the real path.
- `CHANGED_DURING_READ` from the size check or `verify()`.
- `UNSUPPORTED_BACKEND` when no classifier had an opinion.
- `IO_ERROR` when a filesystem method or the byte stream throws.
- `EXTENSION_FAILED` when host code throws or breaks a rule. `data.extension` names the dependency (`fs`, `state`, `resolve`, `suggest`, `authorize`, `converters`, `budget`, or `hooks`), `data.phase` names the stage, and `data.id` names the extension object when it has one.

A formatter that throws, or returns neither a string nor an array, does not reject the call. The core adds an `extension-failed` warning with `data: { extension: "formatter", id? }` and formats the result with `lineNumberFormatter()`. The status stays as it was.

## Adapters

Adapters sit above the core. A `ReadSignature` owns the tool name, the JSON Schema, and the mapping between model input and canonical input. `signatureMessages(signature)` makes retry text use the model's names. The structured result always stays canonical.

The AI SDK adapter passes `ToolExecutionOptions` as `host`. The Pi adapter passes Pi's `ExtensionContext`, and builds the filesystem for each call from `ctx.cwd` with an `fs` factory. No adapter adds policy of its own, except Pi's rule that the root is always the call's working directory.

## Packages

```text
             fs
        ┌────┼──────────────┬──────────────────┬─────────────┐
       read  │              │                  │             │
   ┌────┼────┤              │                  │             │
 ai-sdk │   node   cloudflare-shell   cloudflare-computer   just-bash
        │    │
        └─ pi ┘
```

`fs` holds the filesystem contract, so a filesystem adapter does not depend on the read tool. `read` and `fs` import no `node:` module. Only `node` and `pi` use Node.

## Deliberate omissions

- **No alias repair.** The core accepts `path`, `offset`, and `limit` only. Other names belong to a signature.
- **No Node defaults in the core.** `fs` is required and `digest` defaults to `null`. `createNodeReadTool()` in `@better-fs-tools/node` gives the local defaults. A Workers build cannot pull in `node:fs` by mistake.
- **No converter path access.** A converter gets the capped stream, never the path.
- **No nested reads from hooks.** A hook that needs another file reads it with host code.
- **No write guard.** The precondition check belongs with the write tool that uses the record.
- **No telemetry.** A host that wants timing can wrap the returned function.
- **POSIX only.** Windows paths are not supported in this release.
