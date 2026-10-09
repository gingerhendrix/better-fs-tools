# Architecture

This page explains how `@better-fs-tools/shell` runs one `bash` call, and why it is built this way. [result-schema.md](result-schema.md) describes the result. The [README](../README.md) shows how to configure each step.

## The pipeline

```text
bash(input, ctx?)
  │  parseBashInput ........... strict canonical validation, timeout clamp   phase input
  │  runner(call), cwd(call) .. once; a runner and a default cwd, or factories phase run, resolve
  ▼
BashRequest { command, timeoutMs, cwd }
  │  resolve .................. the requested cwd string                     phase resolve
  │  beforeRun ................ checks and rewrites, in order                phase beforeRun
  │  authorize ................ host policy on the final command             phase authorize
  │  env ...................... the whole environment of the command         phase env
  │  spill.open ............... optional sink for every output byte          phase spill
  │  runner.run ............... start, capture, timeout, abort, output cap   phase run
  │  afterRun ................. output and note changes, in order            phase afterRun
  ▼
formatter.format(report, { mode: "model", call, ... }) ─▶ content
  ▼
ShellResult
```

| Stage     | Dependency              | What happens                                                                                                                    |
| --------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Input     | `limits`                | `parseBashInput` accepts only `command`, `timeoutMs`, and `cwd`. A timeout over `maxTimeoutMs` is clamped with a `clamped` note |
| Runner    | `runner`, `cwd`         | A `CommandRunner`, or a factory of the call context. The default cwd is `cwd`, or the runner's `cwd`                            |
| Resolve   | `resolve`               | A read tool resolver may change the requested cwd string, or report it not found (`CWD_NOT_FOUND`)                              |
| beforeRun | `beforeRun`             | Each hook returns `{ allow: true, command?, notes? }` or `{ allow: false, note? }`. A rewrite feeds the next hook               |
| Authorize | `authorize`             | One target with the final command, the absolute cwd, and a display path relative to the default cwd. A denial is `DENIED`       |
| Env       | `env`                   | The host function returns the whole environment. Nothing else reaches the command                                               |
| Run       | `runner`, `spill`       | The runner starts the command. The core reads the output into a bounded capture, and stops the process tree when it must        |
| afterRun  | `afterRun`              | Each hook returns `{ output?, notes? }`. The status, the error, and the run stay as the core set them                           |
| Format    | `formatter`, `messages` | Turns the report into content parts                                                                                             |

The core owns the stage order, the timeout, the abort, the output budget and view, the status, and note assembly. Policy, rewrites, the environment, and where output is saved belong to the host.

## Why `authorize` runs after `beforeRun`

A `beforeRun` hook can rewrite the command, for example to add a flag or wrap it in a sandbox call. The authorizer sees the command after every rewrite, so an approval prompt shows the command that runs. A `beforeRun` refusal stops the call before `authorize` runs.

## `env` is required

The core has no default environment. A default of `process.env` would leak the host's secrets on every host, and an empty default would break `PATH` and `HOME` without a sign. The host chooses once: `shellEnv(() => process.env)`, an allow list such as `shellEnv({ PATH, HOME })`, or `shellEnv()` for `defaultShellEnv` alone. The Node and Pi factories default it to `shellEnv(() => process.env)`, because they run a local shell.

## Stopping a command

A timeout, the caller's abort, and the capture cap all abort the runner's signal. The runner must then stop the whole process tree: SIGTERM, and SIGKILL after `killGraceMs`. The core waits `killGraceMs` plus one second for the exit. When the runner does not settle it, the run has `unconfirmedStop: true` and an `unconfirmed-stop` warning.

- A timeout gives `status: "timeout"` and keeps the output.
- An abort gives `error` with `ABORTED`. Before the start, `run` and `output` are null.
- The capture cap gives `error` with `OUTPUT_CAP`, and keeps the run and the output.

After a normal exit, the core reads output for one more second, then lets go of the stream. A background child that holds the pipes open keeps running.

## Output

The core keeps at most `maxCaptureBytes` in memory. The model view is at most `maxOutputBytes` and `maxOutputLines`: a head of `headPercent`, then a gap line, then the tail. Errors are usually at the end, so the tail gets most of it. A spill sink gets every byte in arrival order, and its reference goes into the gap line.

A failing output stream, chunks that are not output, or a stream that has not ended one second after the exit, end the capture with an `output-incomplete` warning. After that deadline the core lets go of the stream and captures no later chunk. The status still comes from the exit. A stop the tool started (timeout, abort, output cap) has its own note and adds no `output-incomplete` for the stream it cut.

## Host code

A throw or a malformed return from host code gives `EXTENSION_FAILED` with the phase of the stage. An `afterRun` failure keeps the run and the output. A formatter failure is the exception: the status stays, the core adds no note, and `defaultShellFormatter()` makes the content, as in the read and write tools.

Every host function gets `ctx`: the tool name, the request, the limits, the messages, `digest`, `clock`, and the call context. The bash tool hashes nothing itself. `digest` and `clock` come from the dependencies, so a bundle can give bash the same digest and clock as its file tools.

## Runners

A runner starts one command and never throws for a failed command. `run(request)` gets the command, an absolute cwd, the whole environment, an abort signal, and `killGraceMs`. It returns `output`, an async iterable of `{ stream, bytes }` chunks, and `exit`, a promise that never rejects. A start that fails is an exit with `code: null` and an `error` reason: `cwd-not-found`, `cwd-not-a-directory`, or `spawn-failed`.

`nodeCommandRunner()` in `@better-fs-tools/node` runs `bash -c` in its own process group. `justBashCommandRunner()` in `@better-fs-tools/just-bash` runs an emulated shell with no process.
