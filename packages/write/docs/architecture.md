# Architecture

This page explains how `@better-fs-tools/write` runs one `edit`, `write`, or `apply_patch` call, and why it is built this way. [result-schema.md](result-schema.md) describes the result. The [README](../README.md) shows how to configure each step.

## The pipeline

The three tools share one core. They differ only in their input and their plan stage.

```text
tool(input, ctx?)
  │  parse*Input .............. strict canonical validation            phase input
  │  fs(call) ................. once; a WritableFileSystem or a factory  phase resolve
  ▼
request
  │  resolve .................. every path, in input order             phase resolve
  │  fs.stat .................. roots, type check, resolvedPath        phase stat
  │  authorize (access) ....... change: null, before any content byte  phase authorize
  │  lock ..................... sorted resolvedPaths                   phase lock
  │  fs.stat again ............ the stat that counts                   phase stat
  │  load ..................... open, capped bytes, classify, codec,   phase load
  │                             round trip, verify, contentId
  │  precondition ............. the read-before-write table            phase precondition
  │  plan ..................... write content, matchers, or hunks      phase plan
  │  guards ................... every planned change                   phase guards
  │  authorize (change) ....... with the diff; content for edit/write  phase authorize
  │  encode ................... codec.encode, size check               phase encode
  │  commit ................... fs.write, or stage + publish + remove  phase commit
  │  hooks .................... once for each changed file             phase hooks
  │  record ................... ReadRecord schema 2, origin "write"    phase record
  ▼
formatter.format(report, { mode: "model", call, ... }) ─▶ content
  ▼
MutationResult
```

| Stage        | Dependency                        | What happens                                                                                                                                        |
| ------------ | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Input        | `limits`                          | `parseEditInput`, `parseWriteInput`, or `parseApplyPatchInput`. Unknown keys and blank paths are refused. `apply_patch` also parses the patch here  |
| Filesystem   | `fs`                              | A `WritableFileSystem`, or a factory of the call context. The factory runs once for each call                                                       |
| Resolve      | `resolve`                         | The read tool's resolvers. Each path gets its own listing budget of one                                                                             |
| Stat         | `fs`                              | `fs.stat` on each resolved path. It gives the real path, the type, the version, and the missing parents. No content byte is read                    |
| Access       | `authorize`                       | Each target with `change: null`. A denial ends the call before any content byte is read                                                             |
| Lock         | `locks`                           | All real paths of the call, sorted, taken at once. A timeout gives `LOCK_TIMEOUT`                                                                   |
| Stat again   | `fs`                              | Under the lock. This stat decides. A real path that moved gives `STALE`                                                                             |
| Load         | `classifiers`, `codecs`, `digest` | Opens each file the call changes, reads at most `maxFileBytes`, refuses non-text, decodes, checks that encode gives the same bytes back, and hashes |
| Precondition | `state`, `preconditions`          | Compares the load with the read record                                                                                                              |
| Plan         | `matchers`, `patchParser`         | Builds the new text of each file, the diff, and the fragments                                                                                       |
| Guards       | `guards`                          | Each guard sees each planned change. The first refusal ends the call                                                                                |
| Change       | `authorize`                       | Each planned change, with the whole plan. `edit` and `write` may get new content back                                                               |
| Encode       | `codecs`, `limits`                | Encodes in the loaded style: BOM, CRLF, and encoding stay. `maxWriteBytes` applies                                                                  |
| Commit       | `fs`                              | One `fs.write`, or the staged `apply_patch` commit                                                                                                  |
| Hooks        | `hooks`                           | Each hook sees each committed file. A failure is a warning note                                                                                     |
| Record       | `state`, `digest`, `clock`        | Stores a record for each committed file. A store failure does not fail the call                                                                     |
| Format       | `formatter`, `messages`           | Turns the report into content parts                                                                                                                 |

Some stages cannot be removed by any dependency: input validation, the type check, the order of the access authorize before any content read, the lock, the load cap, the codec round trip, the precondition check when a store is set, the literal splice, the check of every change before the first commit, and the record after a commit. They are the reason the package exists. Everything else is a dependency.

## Source layout

| Path                                                                                             | Role                                                                                                       |
| ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `src/contract/`                                                                                  | The public types, one file for each area. No runtime code                                                  |
| `src/core/create-tools.ts`, `core/deps.ts`                                                       | The three factories. They check and resolve the dependencies once, synchronously                           |
| `src/core/pipeline.ts`                                                                           | The stage order for `edit` and `write`. `apply_patch` has its own order in `core/patch-pipeline.ts`        |
| `src/core/scope.ts`                                                                              | Per-call state: the call object, the phase, `fs(call)`, `state(call)`, notes, abort checks, and failures   |
| `src/core/resolve.ts`, `target.ts`, `lock.ts`, `load.ts`, `precondition.ts`                      | Resolve, stat, lock, load, and the precondition table                                                      |
| `src/core/plan-write.ts`, `plan-edit.ts`, `plan-patch.ts`, `match.ts`, `hints.ts`, `splice.ts`   | The three plan stages, the matcher chain, failure help, and the literal splice                             |
| `src/core/guards.ts`, `authorize.ts`, `encode.ts`, `commit.ts`, `commit-patch.ts`                | Guards, both authorize stages, encode, the single-file commit, and the staged patch commit with rollback   |
| `src/core/hooks.ts`, `record.ts`, `diff.ts`, `snippet.ts`, `outcomes.ts`, `format.ts`            | Hooks, records, the unified diff, snippets, failures and the error map, and the formatter call             |
| `src/matchers/`, `guards/`, `authorize/`, `codecs/`, `locks/`, `hooks/`, `formatters/`, `state/` | The built-in helpers, one file for each                                                                    |
| `src/bundle/create-fs-tools.ts`                                                                  | `createFsTools`: the four file tools, and bash when asked, over one store, digest, lock manager, and clock |
| `src/patch/`, `src/signature/`                                                                   | The `./patch` and `./signature` subpaths                                                                   |

## One call, one context

A host passes `{ signal?, callId?, host }`, the read tool's `ToolCallContext`. The core passes this object by reference to every stage and every host function, as `ctx.call`. It never reads, copies, freezes, or stores `host`. `host` never appears in the result, a record, a note, or content.

A throw or a malformed return from host code gives `EXTENSION_FAILED` with `data: { extension, phase, id? }`. After the commit, hooks are the exception: the file is already written, so a hook failure adds no note and the status stays `ok`. A formatter failure is the other exception: when a formatter throws or returns neither a string nor an array, the default formatter formats the report and no note is added. The status, `changes`, and `commit` stay, so a committed change is never lost.

The signal is checked before each stage and raced against each host function and backend call. From the first commit call to the end of the call, the signal is ignored. A started commit finishes or rolls back, and the record is stored. A half-published patch would be worse than a late abort. Hooks after the commit are not raced against the signal either, so a hook that never settles holds the call open.

## Two authorize stages

Read authorizes an open file before it reads a byte. The write tools keep that order. The access stage runs after `stat`, with `change: null`, so a path policy such as `denyPaths()` or `protectPaths()` refuses before a `NO_MATCH` hint could show any file text. The change stage runs after the guards, with the planned change and the whole plan, so a host can show the user every diff and ask once. `askBeforeWrite()` does that.

An allow decision in the change stage may carry `content` for `edit` and `write`. The core then diffs again, snippets again, and runs the guards again. There is no second authorize. `apply_patch` refuses `content` as `EXTENSION_FAILED`: one user text cannot stand for several files.

## The lock and the second stat

The lock key is the real path, and only `stat` knows it. So the core stats, authorizes access, locks every real path of the call in sorted order, and stats again. The second stat decides: a file that appeared or vanished between the two stats is judged by it, and a real path that changed gives `STALE`.

`memoryLocks()` orders writers inside one process. The read tool takes no lock: it detects a change with `verify()`, and each write replaces the file in one step on a backend that can. `createFsTools()`, and the bundles that wrap it (`createNodeFsTools()`, `createPiFsTools()`, and `createAiSdkFsTools()`), share one lock manager across the three write tools.

## Load

Each existing file that the call changes is opened once:

- `info.version` must equal the version from the second stat, else `STALE`.
- A file over `maxFileBytes` gives `TOO_LARGE` before any byte is read. Reading stops one byte past the cap.
- The first `sampleBytes` go to the read tool's classifiers. Anything but text gives `NOT_TEXT`.
- The first codec that accepts the sample decodes. `encode(decode(bytes))` must give the same bytes back, else `NOT_TEXT` with `ROUND_TRIP`. This check is what keeps every untouched byte the same.
- `verify()` must report no change.
- `contentId` is the digest of the loaded bytes, the same hash the read tool stores.

`utf8Codec()` keeps a BOM. When every LF in the file follows a CR, it works on LF text and encodes CRLF again. Any other mix of line endings is kept as it is.

## Read before write

The precondition stage reads the record at the real path. A record of another schema, or with another digest id, counts as absent. A record is fresh when the backend has stable identity and its version equals the loaded version, or when its content hash equals the loaded content hash. So a backend with weak versions still catches a change through the hash.

| Case                                | `edit`                                  | `write`    | `apply_patch` Update, Delete                                    |
| ----------------------------------- | --------------------------------------- | ---------- | --------------------------------------------------------------- |
| Target missing                      | `NOT_FOUND`                             | Create     | Add and Move destination: create                                |
| `requireRead: "off"`, or no store   | Go on. No store adds a note             | Go on      | Go on                                                           |
| No record                           | `NOT_READ`                              | `NOT_READ` | `NOT_READ`                                                      |
| Partial record, partial not allowed | `NOT_READ` (`wholeFile: true`)          | same       | same                                                            |
| Fresh                               | Go on                                   | Go on      | Go on                                                           |
| Not fresh, `onStale: "rematch"`     | Exact rematch of every pair, or `STALE` | `STALE`    | Exact rematch of every hunk, or `STALE`. A Delete gives `STALE` |
| Not fresh, `onStale: "reject"`      | `STALE`                                 | `STALE`    | `STALE`                                                         |

The commit carries a precondition: `absent` for a create, and the loaded `version` for a replace or a remove. A backend that reports `compareAndSwap: true` checks it next to the publish. For a backend that does not, the core stats the target again just before the write and gives `STALE` or `EXISTS` itself. The window between that stat and the write stays.

## Matching

`edit` runs the matcher chain for each pair against one snapshot of the file. The first matcher that finds a hit decides for that pair. One hit is the match. Several hits without `replaceAll` give `AMBIGUOUS_MATCH`. Several hits from a loose matcher with `replaceAll` give `MATCH_REFUSED`.

The core owns the rules on every hit:

- The splice is literal: `text.slice(0, start) + newText + text.slice(end)`. `String.prototype.replace` is never called, so `$&` and `$1` stay as written.
- A loose hit much longer than the old text (`span`), a hit that starts or ends inside a folded span (`boundary`), and a loose hit whose new text adds escape sequences the matched text does not have (`escape`) give `MATCH_REFUSED`.
- Ranges of different pairs must not overlap. Splices apply from the end.
- A result equal to the original gives `NO_CHANGE`, unless every pair is already applied.

A miss gets help: an `already-applied` note when the new text is in the file and the old text is not, a trailing-newline hint, the closest region with line numbers, and after three misses in a row on one file a `repeated-miss` note. The miss count lives in the tool instance, not in the store.

## apply_patch

The order is parse, resolve, stat, access, lock, stat again, load, preconditions, verify every hunk, plan, guards, change authorize, encode, commit, hooks, record.

Verification collects every problem before anything changes: an Add on an existing file, an Update or Delete on a missing file, a move onto an existing file, two operations on one file, a missing `remove()` for a Delete or Move, and each hunk that does not match. Each hunk matches at the first place after the previous hunk (Codex). The chain runs on whole lines. A ` ` context line takes the file's own line, so its bytes stay the same.

The commit keeps a journal:

```text
stage:    when fs.stage exists, stage every create and update in patch order
          a stage failure discards every staged write; no file changed
publish:  in patch order, record each step
          create, update:  staged.publish(), or fs.write without stage()
          move:            publish the destination, then fs.remove(source, version)
          delete:          fs.remove(path, version)
rollback: on the first failed step, discard what was not published, then undo
          the journal from the end
          update:  fs.write(original bytes, version after)
          create:  fs.remove(path, version after)
          removed: fs.write(original bytes and mode, absent, createParents)
```

When every undo step works, the result has the code of the failed step and `commit.rolledBack: true`. When an undo step fails, the code is `PARTIAL_COMMIT` and `commit.files` gives the state of each file. The journal lives in process memory. A crash during the commit leaves some files changed and no report. Undoing a create removes the file, not the parent folders it made. A stage failure does remove them, through `discard()`.

## Guards and hooks

Guards run in order on each planned change, before the change-stage authorize. The first refusal gives `GUARD_REFUSED` with the guard's note, or the `guardRefused` catalog message when the guard gave none. Allow notes are kept. Every built-in guard lets its near miss through, so a guard does not refuse text that is already in the file.

Hooks run after the whole commit, once for each committed file, in order. `newFileMode()` is asked just before a create's commit. The first hook that returns a number sets the mode of the new file. A replace always keeps the file's mode, when the backend can. `afterWrite()` sees the `FileChange` and the call's filesystem. A hook that rewrote the file returns `rewrote: true`. The core then reads the file again, updates `changes[].after`, and adds a `hook-rewrote` note.

## Records

After a commit, each committed file gets a record with `schema: 2`, `origin: "write"`, the new version, and the content hash of the written bytes. `request` is `null`, and `viewId` equals `contentId`. `wholeFileVisible` is true after a `write` and a patch Add. After an `edit` or a patch Update it keeps the previous record's value. It is false when an authorizer replaced the content, a hook rewrote the file, or an edit went ahead on a stale record: the model has not seen those bytes, so a later `write` needs a read. A move stores the destination and deletes the source key. A Delete deletes the key. `no-change` stores nothing.

`memoryStore()` keeps 1 000 records for 30 minutes. A read older than that needs a new read before an edit.

## Errors

Every error result has exactly one warning note whose `code` is the error code in kebab case, plus the notes gathered before the failure. A host refusal keeps the host's message and data. Its own code moves to `data.source`. Backend reasons map to codes:

| Backend reason          | Code                    |
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
| `changed`               | `STALE`                 |
| `exists`                | `EXISTS`                |
| `read-only`             | `READ_ONLY`             |
| `no-space`              | `NO_SPACE`              |
| `too-large`             | `TOO_LARGE`             |

A backend method that throws gives `IO_ERROR`.

## Writing a WritableFileSystem

A backend keeps the policy. The core never checks roots or symlinks itself. A writable adapter:

- applies the same roots, deny roots, and symlink rules in `stat`, `write`, `stage`, and `remove` as in `open`, and never throws for an expected failure;
- refuses directories, FIFOs, sockets, and devices as `not-a-file` before it touches their content;
- never replaces a symbolic link: it follows a link inside the roots to its real path, or refuses it;
- reports a `version` that changes with every change of the bytes, and the same token from `stat()` and from `open().info.version`;
- enforces `absent`, `version`, and `any`, and gives `exists` or `changed`;
- reports `writeCapabilities.compareAndSwap` honestly. When it is false, the core checks the precondition itself just before the write.

`runWritableFileSystemConformance(fs, { scratchDirectory })` from `@better-fs-tools/fs` checks these rules. The three virtual adapters show three ways to meet them with weaker backends:

| Adapter                          | Backend calls                                 | How it meets the contract                                                                                                                     |
| -------------------------------- | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `cloudflareShellFileSystem()`    | `writeFileBytes`, `mkdir`, `rm`               | Walks the path with `lstat` first, because `writeFileBytes` creates parents and follows a leaf link. Passes the old mime type back. No modes  |
| `cloudflareComputerFileSystem()` | `writeFile`, `mkdir`, `rm`                    | One transaction, so a replace is atomic. `exclusive: true` for a create. Passes the old mode back, because `writeFile` resets it              |
| `justBashFileSystem()`           | `writeFile`, `mkdir`, `rm`, `chmod`, `utimes` | `chmod` after a replace, because `InMemoryFs` resets the mode. Moves `mtime` on by 1 ms when a write left it the same, so the version changes |

None of them has `stage()`, so `apply_patch` writes each file in turn and undoes the journal on a failure.

## Deliberate omissions

- No hashline edits, no LLM correction calls, no notebook or AST edits.
- No undo or checkpoints, no formatter or LSP runs in the core, no delete tool.
- POSIX paths only.
- No `rename` in the contract. A move is a write of the destination and a remove of the source.
