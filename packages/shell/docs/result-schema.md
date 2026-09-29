# Result schema

Every `bash` call returns a `ShellResult`: a `ShellReport` plus `content`, the parts that the formatter made for the model.

```ts
type ShellResult = ShellReport & { readonly content: readonly ContentPart[] };

type ShellReport = ShellRunReport | ShellFailure;

interface ShellRunReport {
  tool: "bash";
  status: "ok" | "failed" | "timeout";
  request: BashRequest;
  run: ShellRun;
  output: ShellOutput;
  notes: readonly Note[];
}

interface ShellFailure {
  tool: "bash";
  status: "error";
  error: ShellError;
  request: BashRequest | null; // null only for INVALID_INPUT
  run: ShellRun | null; // set only when the command started
  output: ShellOutput | null; // set only when the command started
  notes: readonly Note[];
}

// ToolError<ShellErrorCode, ShellPhase>: the same shape as the read and write errors.
interface ShellError {
  code: ShellErrorCode;
  phase: ShellPhase;
  message: string;
  data?: JsonObject;
}
```

`ShellReport` is a discriminated union on `status`. Only the `error` variant has an `error` field, and it is never null there, so a plain `if (result.status === "error")` narrows it. For `ok`, `failed`, and `timeout`, `run` and `output` are never null. `error.message` and `error.data` are copied from the error note.

`textOf(result)` joins the text parts of `content` with `"\n"`. The report is plain data. Nothing in it comes from `ctx.host`.

The read and write tools have the same envelope. Their schemas are `docs/result-schema.md` in `@better-fs-tools/read` and in `@better-fs-tools/write`. The write one also has one table of the statuses and error codes of all five tools.

## Statuses

| Status    | When                                                                                                                       |
| --------- | -------------------------------------------------------------------------------------------------------------------------- |
| `ok`      | The command exited with code 0                                                                                             |
| `failed`  | The command exited with another code, or a signal ended it. A normal result, not a tool error                              |
| `timeout` | The timeout stopped the command. The output so far is kept                                                                 |
| `error`   | The call stopped before the command ran, or the core stopped it for a reason other than its timeout. `error.code` says why |

There is no `aborted` or `refused` status. An abort is `error` with `ABORTED`, and a refusal is `error` with `DENIED` or `REFUSED`.

## `BashRequest`

```ts
{
  command: string;
  timeoutMs: number;
  cwd: string | null;
}
```

The validated canonical input. `timeoutMs` is concrete: the input value clamped to `limits.maxTimeoutMs`, or `limits.defaultTimeoutMs`. `cwd` is the requested cwd as the model sent it, or `null`. It uses canonical names even when the tool uses a renamed signature.

## `ShellRun`

```ts
{
  command: string; // as run, after every beforeRun rewrite
  cwd: string; // absolute
  timeoutMs: number;
  exitCode: number | null; // null when a signal ended it, or the exit was not confirmed
  signal: string | null;
  durationMs: number;
  stoppedBy: "timeout" | "abort" | "output-cap" | null; // null when it ended by itself
  unconfirmedStop: boolean; // the runner did not settle its exit in the grace time
}
```

## `ShellOutput`

```ts
{
  head: string; // all of the output when omittedBytes is 0
  tail: string | null; // null when nothing was cut
  totalBytes: number;
  totalLines: number;
  omittedBytes: number;
  omittedLines: number;
  stdoutBytes: number;
  stderrBytes: number;
  spill: string | null; // the spill sink's reference, or null without a sink
}
```

stdout and stderr are merged in arrival order. The view is `head`, a gap line, then `tail`. `headPercent` of `maxOutputBytes` and `maxOutputLines` goes to the head, and the rest to the tail. The core decodes UTF-8 with replacement characters and removes ANSI escape codes.

## Error codes

| `error.code`          | `error.phase`                                                          | Meaning                                                                                                                                   | `run` and `output`                                        |
| --------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `INVALID_INPUT`       | `input`                                                                | The input failed validation. `request` is `null`                                                                                          | null                                                      |
| `CWD_NOT_FOUND`       | `resolve`, `run`                                                       | The requested cwd does not exist. `resolve` when a resolver said so, `run` when the runner did                                            | null                                                      |
| `CWD_NOT_A_DIRECTORY` | `run`                                                                  | The requested cwd is not a directory                                                                                                      | null                                                      |
| `REFUSED`             | `beforeRun`                                                            | A `beforeRun` hook returned `{ allow: false }`                                                                                            | the hook note's data, with its own code in `source`       |
| `DENIED`              | `authorize`                                                            | The authorizer returned `{ allow: false }`                                                                                                | the authorizer note's data, with its own code in `source` |
| `ABORTED`             | `input`, `resolve`, `beforeRun`, `authorize`, `env`, `run`             | The caller's signal fired. A signal that had fired before the call is `input`, as in read and write. A later abort names the stage it hit | set if it started                                         |
| `SPAWN_FAILED`        | `run`                                                                  | The runner could not start the command                                                                                                    | null                                                      |
| `OUTPUT_CAP`          | `run`                                                                  | The command wrote more than `maxCaptureBytes`, so the core stopped it                                                                     | set                                                       |
| `EXTENSION_FAILED`    | `resolve`, `beforeRun`, `authorize`, `env`, `spill`, `run`, `afterRun` | Host code threw or returned a malformed value. `run` is a runner factory, `resolve` a cwd factory or resolver                             | set for `afterRun`                                        |

`ShellPhase` also has `format`. A formatter failure is not an error: it gives an `extension-failed` warning, and the status stays.

An `afterRun` hook that fails turns the result into `EXTENSION_FAILED`, and keeps `run`, `output`, and the notes so far. An abort during the run, and `OUTPUT_CAP`, keep them too. The formatter then shows the exit as the status line, and the reason in the error note.

## Notes

```ts
{ code, severity: "info" | "warning", message, data?: JsonObject }
```

`code` is stable and kebab case. The default formatter prints a note as `[bash:<code>] <message>`. Key your code on `code`, not on the wording. `messages` overrides change the wording only.

Every error result has one warning note for the error, last in `notes`. Its code is the error code in kebab case, for example `output-cap` for `OUTPUT_CAP`. When an authorizer or a `beforeRun` hook refuses with its own `note`, the note keeps its message and data, its code becomes the error code in kebab case, its severity becomes `warning`, and the host's own code moves to `data.source`. So the error note is `denied` or `refused`, with `error.data.source` set to the host code when it differs. Read and write use the same rule.

Notes from the core:

| `code`                                                                                                                                    | Severity | When                                                                                                                                                                                              | `data`                                   |
| ----------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `clamped`                                                                                                                                 | info     | The input timeout was over `maxTimeoutMs`                                                                                                                                                         | `{ param: "timeoutMs", requested, max }` |
| `output-incomplete`                                                                                                                       | warning  | The output stream failed, the runner gave chunks that were not output, or the stream had not ended `drainMs` after the exit. Not added after a stop the tool started (timeout, abort, output cap) | `{ skippedChunks, detail?, drainMs? }`   |
| `spill-failed`                                                                                                                            | warning  | The spill sink failed. The command was not affected                                                                                                                                               | none                                     |
| `unconfirmed-stop`                                                                                                                        | warning  | The runner did not settle its exit in the grace time after a stop                                                                                                                                 | none                                     |
| `extension-failed`                                                                                                                        | warning  | The formatter failed, and the default formatter ran. The status stays                                                                                                                             | `{ extension: "formatter", id }`         |
| `invalid-input`, `cwd-not-found`, `cwd-not-a-directory`, `refused`, `denied`, `aborted`, `spawn-failed`, `output-cap`, `extension-failed` | warning  | The error note of each error code                                                                                                                                                                 | none                                     |

A resolver can add its own note, for example `path-repaired` from `unicodeRepair()`. An allow decision from the authorizer and a `beforeRun` hook can add notes. They keep their codes.

Order: `clamped`, then the resolver note, then the `beforeRun` and authorizer notes, then the run notes (`spill-failed`, `unconfirmed-stop`, `output-incomplete`), then the error note. An `afterRun` hook can replace the notes. A formatter failure adds its `extension-failed` note at the very end.

## Content

The formatter makes `content` once, with `mode: "model"`. A formatter that returns a string gives one text part. `defaultShellFormatter()` prints:

1. The status line, when the command started: `Exit code 1 · 0.4 s`, `Ended by SIGKILL · 3 s`, or `Timed out after 2 min. The process tree was stopped.`
2. The output view: `head`, the gap line `[… 11945 lines (1.8 MB) not shown] Full output: /tmp/bash-1.log`, then `tail`. `(no output)` when there is none.
3. A blank line, then the note lines.

A call that never started prints the note lines only. In `mode: "view"` the notes are left out.
