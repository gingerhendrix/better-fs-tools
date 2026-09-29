# Result schema

Every `edit`, `write`, and `apply_patch` call returns a `MutationResult`: a `MutationReport` plus `content`, the parts that the formatter made for the model.

```ts
type MutationResult = MutationReport & { readonly content: readonly ContentPart[] };

type MutationReport = MutationOk | MutationNoChange | MutationFailure;

// Every variant has these fields.
interface MutationFields {
  tool: "edit" | "write" | "apply_patch";
  changes: readonly FileChange[];
  unchanged: readonly string[];
  notes: readonly Note[];
}

interface MutationOk extends MutationFields {
  status: "ok";
  commit: null;
}

interface MutationNoChange extends MutationFields {
  status: "no-change";
  commit: null;
}

interface MutationFailure extends MutationFields {
  status: "error";
  error: WriteError;
  commit: CommitReport | null;
}

// ToolError<WriteErrorCode, WritePhase>: the same shape as the read and bash errors.
interface WriteError {
  code: WriteErrorCode;
  phase: WritePhase;
  message: string;
  data?: JsonObject;
}
```

`MutationReport` is a discriminated union on `status`. Only the `error` variant has an `error` field, and it is never null there, so a plain `if (result.status === "error")` narrows it. `error.message` and `error.data` are copied from the error note.

`textOf(result)` from `@better-fs-tools/read` (also exported here) joins the text parts of `content` with `"\n"`. The report is plain data. Nothing in it comes from `ctx.host`.

## Statuses

| Status      | When                                                                                                                                             |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ok`        | Every planned change is committed. `changes` lists them                                                                                          |
| `no-change` | Nothing needed writing: `write` with the same content, `edit` where every pair is already applied, or a patch that changes nothing. Not an error |
| `error`     | The call stopped. `error.code` says why and `error.phase` says where. Nothing was written, unless `commit` says otherwise                        |

`unchanged` lists the display paths that a `no-change` result left as they were. It is empty for the other statuses.

`commit` is set only when an `apply_patch` commit failed after its first publish step. `changes` is empty on an error, except for a `PARTIAL_COMMIT`, where it lists the files left changed.

## `FileChange`

```ts
interface FileChange {
  kind: "create" | "update" | "delete" | "move";
  path: string; // display path; for a move, the destination
  requestedPath: string;
  resolvedPath: string;
  movedFrom: string | null; // display path of a move source
  before: FileVersion | null; // null for a create
  after: FileVersion | null; // null for a delete
  linesAdded: number;
  linesRemoved: number;
  diff: string; // unified diff with a/ and b/ headers
  diffTruncated: boolean; // cut at limits.maxDiffLines
  matches: readonly MatchInfo[]; // edit pairs and patch hunks
  snippets: readonly Snippet[]; // new lines around each change
  userModified: boolean; // an authorizer replaced the content
  createdDirectories: readonly string[]; // resolved paths, outermost first
}

interface FileVersion {
  contentId: string | null; // null without a digest
  version: string | null; // the backend version; null when it gave none
  bytes: number;
}

interface MatchInfo {
  index: number; // zero-based pair or hunk
  matcher: string; // for example "exact" or "normalized"
  fuzzy: boolean;
  lines: readonly [number, number]; // one-based, in the file before the change
  count: number; // more than 1 only with replaceAll
  replaced: readonly (readonly [number, number])[]; // each replacement in the file after
}

interface Snippet {
  startLine: number; // one-based, in the file after the change
  lines: readonly string[];
}
```

`matches` is empty for `write`. An already applied pair has no entry. `snippets` is empty for `write` and for a delete. The model text shows the snippets. The full diff is only in `diff`, unless the formatter has `diff: true`.

## `CommitReport`

```ts
interface CommitReport {
  rolledBack: boolean; // true when every published step was undone
  files: readonly {
    path: string;
    state: "unchanged" | "committed" | "restored" | "rollback-failed";
    code?: WriteErrorCode;
  }[];
}
```

`files` lists every file of the patch, in patch order. A move lists its source, then its destination. Every undo step is tried, so a published file ends `restored` or `rollback-failed`.

## Error codes

| `code`                  | Phase                                            | Meaning                                                                                                                                                                                                                                  | `data`                                                                                                     |
| ----------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `INVALID_INPUT`         | `input`                                          | The input failed validation                                                                                                                                                                                                              | `{ path }` when the input had a string path                                                                |
| `NOT_FOUND`             | `resolve`, `stat`, `plan`                        | `edit` on a missing file, or a path the resolver or backend did not find                                                                                                                                                                 | from the backend                                                                                           |
| `NOT_A_FILE`            | `stat`, `load`                                   | A directory, FIFO, socket, or device                                                                                                                                                                                                     | `{ kind }`                                                                                                 |
| `DANGEROUS_PATH`        | any backend call                                 | A refused namespace or deny root                                                                                                                                                                                                         | from the backend                                                                                           |
| `OUTSIDE_ALLOWED_ROOTS` | any backend call                                 | Outside every allowed root                                                                                                                                                                                                               | from the backend                                                                                           |
| `PERMISSION_DENIED`     | any backend call                                 | The operating system refused access                                                                                                                                                                                                      | from the backend                                                                                           |
| `DENIED`                | `authorize`, or any backend call                 | An authorizer, or a backend rule such as a refused symlink                                                                                                                                                                               | the authorizer's data, with its own code in `source`                                                       |
| `READ_ONLY`             | `commit`                                         | The backend is read-only                                                                                                                                                                                                                 | from the backend                                                                                           |
| `NO_SPACE`              | `commit`                                         | The backend is out of space                                                                                                                                                                                                              | from the backend                                                                                           |
| `UNSUPPORTED_BACKEND`   | `resolve`, `load`, `commit`                      | `load`: no classifier had an opinion. `resolve`: a per-call `fs` factory returned a backend with no write methods. `commit`: the backend lacks the write method the call needs, which the Cloudflare and just-bash adapters check at use | `{ detail }` from the backend                                                                              |
| `ABORTED`               | the phase at the time                            | The signal fired before the commit                                                                                                                                                                                                       | `{ phase }`                                                                                                |
| `IO_ERROR`              | any                                              | Any other backend failure, including a method that threw                                                                                                                                                                                 | `{ detail }`                                                                                               |
| `EXTENSION_FAILED`      | the phase of the host code                       | Host code threw or returned a malformed value                                                                                                                                                                                            | `{ extension, phase, id? }`                                                                                |
| `LOCK_TIMEOUT`          | `lock`                                           | Another call held a path for `timeoutMs`                                                                                                                                                                                                 | none                                                                                                       |
| `NOT_READ`              | `precondition`                                   | No read record, or a partial one where a whole read is needed                                                                                                                                                                            | `{ wholeFile: true }` for the second case                                                                  |
| `STALE`                 | `stat`, `load`, `precondition`, `plan`, `commit` | The file changed since the read, or between the checks and the commit                                                                                                                                                                    | `{ index }` for an edit rematch, `{ path, hunk? }` for a patch                                             |
| `EXISTS`                | `commit`                                         | A create found a file                                                                                                                                                                                                                    | none                                                                                                       |
| `TOO_LARGE`             | `load`, `encode`, `input`, `commit`              | A file over `maxFileBytes`, content over `maxWriteBytes`, a patch over `maxPatchFiles`, or a backend byte ceiling such as `maxBufferedBytes`                                                                                             | `{ limit, bytes? }`, `{ limit, operations }`, or from a backend `{ limit, size, detail?, cause? }`         |
| `NOT_TEXT`              | `load`                                           | The file is not text, cannot be decoded, or does not encode back to the same bytes                                                                                                                                                       | `{ code, classifier? }`                                                                                    |
| `NO_MATCH`              | `plan`                                           | An old text was not found                                                                                                                                                                                                                | `{ index, closest?, trailingNewline? }`                                                                    |
| `AMBIGUOUS_MATCH`       | `plan`                                           | An old text was found more than once without `replaceAll`                                                                                                                                                                                | `{ index, lines, total }`                                                                                  |
| `MATCH_REFUSED`         | `plan`                                           | A hit that the core does not trust                                                                                                                                                                                                       | `{ index, matcher, reason }`. `reason` is `span`, `boundary`, `escape`, `fuzzy-replace-all`, or `too-many` |
| `OVERLAP`               | `plan`                                           | Two pairs match overlapping text                                                                                                                                                                                                         | `{ first, second }`                                                                                        |
| `NO_CHANGE`             | `plan`, `encode`                                 | The edits leave the file as it is                                                                                                                                                                                                        | none                                                                                                       |
| `GUARD_REFUSED`         | `guards`                                         | A guard refused a planned change                                                                                                                                                                                                         | the guard's data, with its own code in `source`                                                            |
| `PATCH_PARSE`           | `input`                                          | The patch text is not a valid patch                                                                                                                                                                                                      | `{ line, detail }`                                                                                         |
| `PATCH_VERIFY`          | `stat`, `plan`                                   | One or more operations cannot apply. Nothing was written. `stat`: two operations on one file, or a Delete or Move on a backend without `remove()`. `plan`: the rest                                                                      | `{ problems: [{ path, reason, hunk? }] }`                                                                  |
| `PARTIAL_COMMIT`        | `commit`                                         | A patch step failed and an undo step failed too. `commit.files` has the state of each file                                                                                                                                               | none                                                                                                       |

An `apply_patch` precondition failure on several files gives one note with the first failure's code and `data.failures`, one entry for each path.

## Notes

```ts
{ code, severity: "info" | "warning", message, data?: JsonObject }
```

`code` is stable. The default formatter prints a note as `[<tool>:<code>] <message>`. Key your code on `code`, not on the wording. `messages` overrides change the wording only.

Every error result has exactly one warning note whose `code` is the error code in kebab case, for example `not-read` for `NOT_READ`. When an authorizer or a guard refuses with its own `note`, the note keeps its message and data, its code becomes the error code in kebab case, its severity becomes `warning`, and the host's own code moves to `data.source`. Read and bash use the same rule.

Notes on a successful call:

| `code`                             | Severity | From                                                 | `data`                                                              |
| ---------------------------------- | -------- | ---------------------------------------------------- | ------------------------------------------------------------------- |
| `fuzzy-match`                      | info     | a loose match                                        | edit: `{ index, matcher, lines }`. patch: `{ path, hunk, matcher }` |
| `already-applied`                  | info     | `edit`                                               | `{ index }`                                                         |
| `stale-rematched`                  | info     | `edit`, `apply_patch`                                | none                                                                |
| `repeated-miss`                    | info     | `edit`, with a `NO_MATCH`                            | `{ misses }`                                                        |
| `read-before-write-off`            | warning  | no store                                             | none                                                                |
| `user-modified`                    | warning  | an authorizer returned `content`                     | none                                                                |
| `directories-created`              | info     | the commit                                           | `{ paths }`                                                         |
| `not-atomic`                       | warning  | `writeCapabilities.atomic` false                     | none                                                                |
| `no-compare-and-swap`              | info     | `writeCapabilities.compareAndSwap` false             | none                                                                |
| `mode-not-kept`                    | info     | `writeCapabilities.preserveMode` false, on a replace | none                                                                |
| `hook-failed`                      | warning  | a hook threw after the commit                        | `{ hook }`                                                          |
| `extension-failed`                 | warning  | the formatter failed; the default formatter ran      | `{ extension: "formatter", id? }`                                   |
| `hook-rewrote`                     | warning  | a hook returned `rewrote: true`                      | `{ hook }`                                                          |
| `executable`                       | info     | `executableShebang()`                                | `{ mode }`                                                          |
| `verify-mismatch`, `verify-failed` | warning  | `verifyWrite()`                                      | none                                                                |

Guards and authorizers may add allow notes of their own.

## Content

The formatter makes `content` once, with `mode: "model"`. A formatter that returns a string gives one text part. `defaultWriteFormatter()` prints a header, a body, then a blank line and the note lines. An error prints the note lines only.

| Tool          | Header                                                                        | Body                                                            |
| ------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `edit`        | `Edited <path>: 1 replacement at line 4.` or `2 replacements at lines 3, 15.` | The snippets, with the read tool's `12\|` gutter, `...` between |
| `write`       | `Created <path> (3 lines).` or `Updated <path> (+2 -1 lines).`                | none                                                            |
| `apply_patch` | `Success. Updated the following files:`                                       | One line for each file: `A`, `M`, or `D` and the path           |
| any           | `No change to <path>.` for `no-change`. `write` adds the reason               | none                                                            |

`defaultWriteFormatter({ diff: true })` adds each file's diff in a fenced block. `gutter` and `noteLine` change the snippet gutter and the note line.

## The stored record

With a `state` store and a `digest`, each committed file gets a record under its resolved path:

```ts
{
  schema: 2,
  origin: "write",
  observationId, resolvedPath, identity, version, digest,
  contentId, viewId, observedAt, wholeFileVisible,
  totalsExact: true,
  request: null
}
```

- `version` and `identity` come from the backend's `MutatedFile`. `contentId` is the digest of the written bytes, and `viewId` equals it.
- `wholeFileVisible` is true after a `write` and a patch Add. An `edit` and a patch Update keep the previous value. It is false when an authorizer replaced the content, a hook rewrote the file, or an edit went ahead on a stale record.
- A move stores the destination and deletes the source key. A Delete deletes the key. `no-change` stores nothing.
- A store failure never fails the call.

## Statuses and error codes of every tool

The read, write, and bash results share one envelope: `tool`, `status`, and on `status: "error"` only, `error: { code, phase, message, data? }`. Error codes are UPPER_SNAKE. Note codes are kebab case, and each error note's code is its error code in kebab case. The tables below list every status and error code. Each tool's own schema has the details and the notes: this file for the write tools, `docs/result-schema.md` in `@better-fs-tools/read` for `read`, and `docs/result-schema.md` in `@better-fs-tools/shell` for `bash`.

| Status        | `read`                                            | `edit`, `write`, `apply_patch` | `bash`                                            |
| ------------- | ------------------------------------------------- | ------------------------------ | ------------------------------------------------- |
| `ok`          | text was read                                     | every change is committed      | exit code 0                                       |
| `media`       | a converter returned media parts                  | no                             | no                                                |
| `unsupported` | a classifier or converter refused; `code` is open | no                             | no                                                |
| `no-change`   | no                                                | nothing needed writing         | no                                                |
| `failed`      | no                                                | no                             | another exit code, or a signal                    |
| `timeout`     | no                                                | no                             | the timeout stopped the command                   |
| `error`       | the read failed                                   | the call stopped               | the call stopped, or the core stopped the command |

Each cell is the `error.phase` values of that code, or "no" when the tool never gives it. "Backend" means the phase of whichever backend call failed.

| `error.code`                                              | `read`                                                                   | `edit`, `write`, `apply_patch`                   | `bash`                                            |
| --------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------ | ------------------------------------------------- |
| `INVALID_INPUT`                                           | `input`                                                                  | `input`                                          | `input`                                           |
| `NOT_FOUND`                                               | `resolve`                                                                | `resolve`, `stat`, `plan`                        | no                                                |
| `NOT_A_FILE`                                              | `open`, `verification`                                                   | `stat`, `load`                                   | no                                                |
| `DANGEROUS_PATH`                                          | `open`, `verification`, `conversion`                                     | backend                                          | no                                                |
| `OUTSIDE_ALLOWED_ROOTS`                                   | `open`, `verification`, `conversion`                                     | backend                                          | no                                                |
| `PERMISSION_DENIED`                                       | `open`, `verification`, `conversion`                                     | backend                                          | no                                                |
| `DENIED`                                                  | `authorize`, or backend                                                  | `authorize`, or backend                          | `authorize`                                       |
| `REFUSED`                                                 | no                                                                       | no                                               | `beforeRun`                                       |
| `TOO_LARGE`                                               | `open` (a backend ceiling; converter and media limits are `unsupported`) | `input`, `load`, `encode`, `commit`              | no                                                |
| `CHANGED_DURING_READ`                                     | `verification`                                                           | no                                               | no                                                |
| `READ_ONLY`                                               | no                                                                       | `commit`                                         | no                                                |
| `NO_SPACE`                                                | no                                                                       | `commit`                                         | no                                                |
| `UNSUPPORTED_BACKEND`                                     | `open`, `sampling`, `scan`                                               | `resolve`, `load`, `commit`                      | no                                                |
| `ABORTED`                                                 | the phase at the time                                                    | the phase at the time, before the commit         | `resolve`, `beforeRun`, `authorize`, `env`, `run` |
| `IO_ERROR`                                                | any                                                                      | any                                              | no                                                |
| `EXTENSION_FAILED`                                        | the phase of the host code                                               | the phase of the host code                       | the phase of the host code                        |
| `LOCK_TIMEOUT`                                            | no                                                                       | `lock`                                           | no                                                |
| `NOT_READ`                                                | no                                                                       | `precondition`                                   | no                                                |
| `STALE`                                                   | no                                                                       | `stat`, `load`, `precondition`, `plan`, `commit` | no                                                |
| `EXISTS`                                                  | no                                                                       | `commit`                                         | no                                                |
| `NOT_TEXT`                                                | no                                                                       | `load`                                           | no                                                |
| `NO_MATCH`, `AMBIGUOUS_MATCH`, `MATCH_REFUSED`, `OVERLAP` | no                                                                       | `plan`, `edit` only                              | no                                                |
| `NO_CHANGE`                                               | no                                                                       | `plan`, `encode`, `edit` only                    | no                                                |
| `GUARD_REFUSED`                                           | no                                                                       | `guards`                                         | no                                                |
| `PATCH_PARSE`                                             | no                                                                       | `input`, `apply_patch` only                      | no                                                |
| `PATCH_VERIFY`                                            | no                                                                       | `stat`, `plan`, `apply_patch` only               | no                                                |
| `PARTIAL_COMMIT`                                          | no                                                                       | `commit`, `apply_patch` only                     | no                                                |
| `CWD_NOT_FOUND`                                           | no                                                                       | no                                               | `resolve`, `run`                                  |
| `CWD_NOT_A_DIRECTORY`                                     | no                                                                       | no                                               | `run`                                             |
| `SPAWN_FAILED`                                            | no                                                                       | no                                               | `run`                                             |
| `OUTPUT_CAP`                                              | no                                                                       | no                                               | `run`                                             |

A formatter failure is never an error in any tool. The status stays, and an `extension-failed` warning is added.
