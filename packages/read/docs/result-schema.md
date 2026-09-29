# Result schema

Every read returns a `ReadResult`: a `ReadReport` plus `content`, the parts that the formatter made for the model.

```ts
type ReadResult = ReadReport & { readonly content: readonly ContentPart[] };
type ReadReport = ReadOk | ReadMedia | ReadUnsupported | ReadFailure;

type ContentPart =
  | { type: "text"; text: string }
  | { type: "media"; mediaType: string; data: Uint8Array; name?: string };
```

`ReadReport` is a discriminated union on `status`. Every variant has `tool: "read"`. Only the `error` variant has an `error` field, and it is never null there, so a plain `if (result.status === "error")` narrows it:

```ts
if (result.status === "error") console.log(result.error.code, result.error.phase);
```

There is no `result.text`. `textOf(result)` joins the text parts of `content` with `"\n"`.

The outcome is plain data. Only media parts hold bytes, as `Uint8Array`. Nothing in the result comes from `ctx.host`.

## Statuses

| Status        | When                                                                                                                |
| ------------- | ------------------------------------------------------------------------------------------------------------------- |
| `ok`          | The file, the converted text, or the directory listing was read as text. This includes empty files and empty views. |
| `media`       | A converter returned content parts, for example an image.                                                           |
| `unsupported` | A classifier or a converter refused the content. `code` is open.                                                    |
| `error`       | The read failed. `error.code` is a `ReadErrorCode`.                                                                 |

## `ok`

```ts
{
  tool: "read",
  status: "ok",
  request: { path, offset, limit, ranged },
  file: {
    requestedPath, resolvedPath, displayPath, backend,
    size, mtimeMs, identity, mimeType, resolvedFrom, version
  },
  classification: { kind, classifier, code, mimeType, confidence, reasons },
  conversion: { converter, mimeType } | null,
  view: {
    lines: [{ number, text, clamped, sourceChars }],
    startLine, endLine, bytes, partial
  },
  truncation: { truncated, reasons, primary },
  continuation: { available, next },
  totals: { lines, exact, bytes },
  observation: { id, statId, contentId, viewId, observedAt, wholeFileVisible } | null,
  notes: [...],
  content: [{ type: "text", text: "1|..." }]
}
```

Field notes:

- `request` is the validated canonical input. `offset` and `limit` are concrete: `offset` defaults to 1, and `limit` defaults to and is clamped to `limits.maxLines`. A clamp adds a `clamped` info note. `ranged` is `true` when the input set `offset` or `limit`.
- `file.requestedPath` is the model's path. `file.resolvedFrom` is the model's path when a resolver changed it, and `null` otherwise. `file.backend` is the filesystem `id`. `file.identity` is `null` unless the filesystem has stable identity. `file.version` is the backend's change token from `open()` (`info.version`), or `null` when the backend gives none. It is kept when the filesystem has no stable identity.
- `classification.kind` is `"text"`, `"unsupported"`, or `"directory"`. `classifier` is the classifier id, or `"fs"` for a directory. `code` is the classifier's unsupported code, and `null` for text and directories. A converted file keeps its classification, so a converted notebook has `kind: "unsupported"` and `code: "NOTEBOOK"`.
- `conversion` names the converter when one produced the text, and `null` for plain text.
- `view.lines[].text` is source text clamped to `limits.maxCharsPerLine`, with no gutter and no clamp marker. Both belong to the formatter.
- `view.lines[].sourceChars` is the original length in characters, and `null` unless the line was clamped.
- `view.endLine` is `startLine - 1` when the view is empty.
- `view.bytes` counts UTF-8 source bytes plus one separator byte for each line after the first. It does not count the gutter.
- `view.partial` is `true` when the view starts after line 1, stops before the end, or has any truncation reason.
- `truncation.reasons` can hold `lines`, `bytes`, `budget`, `scan-limit`, and `line-length`, in that order. `primary` is the first, or `null`.
- `continuation.next` is a complete canonical input, `{ path, offset, limit }`. Send it again to continue. It uses canonical names even when the tool uses a renamed signature.
- `totals.lines` is `null` and `totals.exact` is `false` when the scan limit stopped counting. `totals.bytes` is the scanned byte count when the scan reached the end, and the file size otherwise. For converted text, it is the size of the converted text that was scanned.
- `observation` is `null` with no `digest`, and for directories. `contentId` is `null` when the scan stopped before the end. For converted text it is still the hash of the source bytes. `wholeFileVisible` is `true` only when the offset is 1, nothing was truncated or clamped, and no hook changed the view.

## `media`

```ts
{
  tool: "read",
  status: "media",
  request, file, classification,
  conversion: { converter, mimeType },
  parts: [{ type: "media", mediaType, data, name? }],
  observation: { ... wholeFileVisible: false } | null,
  notes: [...],
  content: [...]
}
```

`parts` is what the converter returned. `conversion.mimeType` is the first media part's type. The formatter puts note text first and then the parts in `content`. `observation.viewId` hashes the parts, and `wholeFileVisible` is always `false`.

## `unsupported`

```ts
{ tool: "read", status: "unsupported", code, request, file, classification, notes, content }
```

`code` comes from the classifier, a converter refusal, or the core:

| Code                                                                        | Source                                                                                                                                              |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `IMAGE`, `PDF`, `OFFICE_DOCUMENT`, `NOTEBOOK`, `BINARY`, `UNKNOWN_ENCODING` | The default classifiers                                                                                                                             |
| `INVALID_NOTEBOOK`                                                          | `notebookConverter()` on broken notebook JSON                                                                                                       |
| `TOO_LARGE`                                                                 | The core: converter input over `maxConvertBytes`, or media over `maxMediaBytes`. A backend ceiling gives `status: "error"` with `TOO_LARGE` instead |
| any other string                                                            | Your own classifier or converter                                                                                                                    |

## `error`

```ts
{
  tool: "read",
  status: "error",
  error: { code, phase, message, data? },
  request: ReadRequest | null,
  file: FileInfo | null,
  notes,
  content
}
```

`error` has the same shape in every tool (`ToolError`). `code` is an UPPER_SNAKE `ReadErrorCode`. `phase` is the `ReadPhase` that failed: `input`, `resolve`, `open`, `authorize`, `sampling`, `conversion`, `scan`, `verification`, or `hooks`. `message` and `data` are copied from the error note. The error note is always in `notes`, and its code is the error code in kebab case, for example `not-found` for `NOT_FOUND`.

`request` is `null` only for `INVALID_INPUT`. `file` is set only for failures found after the file was opened and allowed: `CHANGED_DURING_READ`, `UNSUPPORTED_BACKEND` from the classifiers, and a failed `verify()`. It is `null` for every other failure. `DENIED` from an authorizer always has `file: null`.

| `error.code`            | `error.phase`                                     | Meaning                                                                                                       |
| ----------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `INVALID_INPUT`         | `input`                                           | The input failed validation                                                                                   |
| `NOT_FOUND`             | `resolve`                                         | No such file. `note.data.suggestions` can hold nearby names. A miss in `open()` is reported in this phase too |
| `NOT_A_FILE`            | `open`, `verification`                            | A directory with no directory converter, or a FIFO, socket, or device. `note.data.kind` names it.             |
| `DANGEROUS_PATH`        | `open`, `verification`, `conversion`              | A refused namespace such as `/dev`, or a filesystem deny root                                                 |
| `OUTSIDE_ALLOWED_ROOTS` | `open`, `verification`, `conversion`              | Outside every allowed root                                                                                    |
| `PERMISSION_DENIED`     | `open`, `verification`, `conversion`              | The operating system refused access                                                                           |
| `DENIED`                | `authorize`, `open`, `verification`, `conversion` | A policy refusal: an authorizer (`authorize`), or a filesystem rule such as a rejected symlink                |
| `TOO_LARGE`             | `open`                                            | The file is over a byte ceiling of the filesystem backend, such as `maxBufferedBytes`                         |
| `CHANGED_DURING_READ`   | `verification`                                    | The file changed while it was read. The note has a retry of the same range.                                   |
| `ABORTED`               | the phase at the time                             | The signal fired. `note.data.phase` names the stage. Nothing was recorded.                                    |
| `UNSUPPORTED_BACKEND`   | `open`, `sampling`, `scan`                        | No classifier had an opinion, or the filesystem cannot serve the read                                         |
| `EXTENSION_FAILED`      | the phase of the host code                        | Host code threw or broke a rule. `note.data` has `extension`, `phase`, and `id` when the extension has one.   |
| `IO_ERROR`              | any                                               | Any other backend failure, including a filesystem method that threw                                           |

`conversion` is the phase of a directory listing that failed. `hooks` is the phase of an `afterRead` hook failure.

The statuses and error codes of all five tools are in one table in `docs/result-schema.md` of `@better-fs-tools/write`. The bash result is in `docs/result-schema.md` of `@better-fs-tools/shell`.

## Notes

```ts
{ code, severity: "info" | "warning", message, retry?: ReadInput, data?: JsonObject }
```

`code` is stable. The default formatter prints a note as `[read:<code>] <message>`. Key your code on `code`, not on the wording. `messages` overrides change the wording only. `retry` is always canonical. The message prints it with `messages.retry`, so the text can use the tool's own names.

Notes from the core:

| `code`                                                                                                      | Severity | `retry`                                      | `data`                                                                                                      |
| ----------------------------------------------------------------------------------------------------------- | -------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `continue`                                                                                                  | info     | the next view                                | `{ reason }`                                                                                                |
| `clamped`                                                                                                   | info     | none                                         | `{ param: "limit", requested, max }`: the requested `limit` was over `maxLines`                             |
| `offset-unreached`                                                                                          | warning  | a lower offset that the scan reached         | `{ reachedLine }`                                                                                           |
| `first-line-exceeds-byte-limit`                                                                             | warning  | the view after that line                     | `{ line }`                                                                                                  |
| `line-clamped`                                                                                              | warning  | none                                         | `{ lines, total, maxChars }`. `lines` lists at most 20 line numbers.                                        |
| `scan-limit`                                                                                                | warning  | none                                         | `{ maxScanBytes }`                                                                                          |
| `offset-past-eof`                                                                                           | info     | the last line                                | `{ totalLines }`                                                                                            |
| `empty`                                                                                                     | info     | none                                         | none                                                                                                        |
| `weak-identity`                                                                                             | info     | none                                         | `{ backend }`                                                                                               |
| `buffered-backend`                                                                                          | info     | none                                         | `{ backend }`                                                                                               |
| `not-found`                                                                                                 | warning  | none                                         | `{ suggestions?, entriesTruncated?, detail?, cause? }`                                                      |
| `not-a-file`                                                                                                | warning  | none                                         | `{ kind, detail?, cause? }`                                                                                 |
| `dangerous-path`, `outside-allowed-roots`, `permission-denied`, `denied`, `unsupported-backend`, `io-error` | warning  | none                                         | `{ detail?, cause? }` from the filesystem. A thrown error gives `io-error` with `{ detail }`.               |
| `denied` from an authorizer                                                                                 | warning  | set by `sizeCeiling({ unrangedOnly: true })` | the authorizer's data, for example `{ pattern }` or `{ size, maxBytes }`                                    |
| `too-large`                                                                                                 | warning  | none                                         | `{ stage, limit }`. `stage` is `"convert"` or `"media"`. From a backend: `{ limit, size, detail?, cause? }` |
| `changed-during-read`                                                                                       | warning  | the same range                               | none                                                                                                        |
| `aborted`                                                                                                   | warning  | none                                         | `{ phase }`                                                                                                 |
| `invalid-input`                                                                                             | warning  | none                                         | `{ path }` when the input had a string path                                                                 |
| `extension-failed`                                                                                          | warning  | none                                         | `{ extension, phase, id? }`. A formatter failure gives `{ extension: "formatter", id? }`.                   |
| `view-modified`                                                                                             | info     | none                                         | `{ hook }`                                                                                                  |

Notes from the built-in helpers:

| `code`                                                                                                                                              | Severity | From                    | `data`                          |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ----------------------- | ------------------------------- |
| `utf8-bom`                                                                                                                                          | info     | `utf8Classifier`        | none                            |
| `unsupported-image`, `unsupported-pdf`, `unsupported-office-document`, `unsupported-notebook`, `unsupported-binary`, `unsupported-unknown-encoding` | warning  | the default classifiers | as set by a `NoteOverride`      |
| `path-repaired`                                                                                                                                     | warning  | `unicodeRepair()`       | `{ from, to }`                  |
| `invalid-notebook`                                                                                                                                  | warning  | `notebookConverter()`   | none                            |
| `directory-truncated`                                                                                                                               | warning  | `directoryListing()`    | `{ maxDirectoryEntries }`       |
| `empty-directory`                                                                                                                                   | info     | `directoryListing()`    | none                            |
| `repeat-read`                                                                                                                                       | info     | `repeatReadGuard()`     | `{ observationId, observedAt }` |

`directoryListing()` also has a `list-failed` refusal for a listing that failed. The core reports the listing's own error first, so a read with the built-in converter gives that error, for example `DENIED` or `IO_ERROR`.

Order: the view notes come first, then the classifier or converter notes, then `empty`, then the capability notes. Allow notes from the authorizer and then the resolver note follow. Hooks add their notes last.

## Content

The formatter makes `content` once, with `mode: "model"`. A formatter that returns a string gives one text part.

- `lineNumberFormatter()`: `1|source` lines, then a blank line, then `[read:<code>]` note lines. Media: a text part with the note lines, then the media parts.
- `plainFormatter()`: the source lines with no gutter, then the note lines.
- `jsonFormatter()`: JSON text of the outcome, or of `pick(outcome)`. Byte arrays become `{ "bytes": n }`, and media parts follow as parts.
- `@better-fs-tools/read/formats`: `opencodeFormat()`, `deepAgentsFormat()`, `hashlineFormat()`, and `hermesFormat()`.

Suggestions live in `note.data` and in the message, so a formatter that shows the note shows the names.

## The stored record

With a `state` store and a `digest`, an `ok` or `media` result is stored under `file.resolvedPath`:

```ts
{
  schema: 2,
  origin: "read",
  observationId, resolvedPath, identity, version, digest,
  contentId, viewId, observedAt, wholeFileVisible, totalsExact,
  request: { offset, limit }
}
```

- `version` is `file.version`. `digest` is the `Digest.id` that made `contentId` and `viewId`.
- A write tool stores a record with `origin: "write"` after a commit. Its `viewId` equals its `contentId`, and its `request` is `null`.

Hooks see the earlier record as `ctx.previous`. A record of another schema, such as a schema 1 record from an older store, gives `previous: null`. `repeatReadGuard` only fires on a record with `origin: "read"`.
