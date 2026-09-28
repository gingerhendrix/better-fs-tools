# @better-fs-tools/shell

A `bash` tool for TypeScript agents. It runs one command for each call and returns the exit code and a bounded view of the output.

The package has a small run core, hooks, and defaults. It ships no policy: no authorizers, no command parser, and no guards. A host adds those through the hooks.

The core always does these things:

- It runs one command for each call, with stdin closed.
- It stops the whole process tree on a timeout and on an abort.
- It uses one timeout unit, milliseconds, in the code.
- It keeps the output bounded in memory, and cuts the model view to a head and a tail with one line between them.
- It puts the exit code first in the model text.

## Install

```sh
npm install @better-fs-tools/shell @better-fs-tools/read @better-fs-tools/fs
```

The package has no peers and imports no `node:` module. It starts no process by itself. A runner does that: `nodeCommandRunner()` from [`@better-fs-tools/node`](https://www.npmjs.com/package/@better-fs-tools/node), `justBashCommandRunner()` from [`@better-fs-tools/just-bash`](https://www.npmjs.com/package/@better-fs-tools/just-bash), or your own.

## Quick start

```ts
import { createNodeBashTool } from "@better-fs-tools/node";
import { textOf } from "@better-fs-tools/shell";

// bash -c in process.cwd(), with process.env, a 2 minute timeout, and a
// 30 000 byte view of the output.
const bash = createNodeBashTool();

const listed = await bash({ command: "ls package.json" });
console.log(textOf(listed));
// Exit code 0 · 0 s
// package.json

const failed = await bash({ command: "grep -q nothing-here package.json" });
if (failed.status === "failed") console.log(failed.run.exitCode); // 1

const slow = await bash({ command: "sleep 5", timeoutMs: 100 });
console.log(textOf(slow));
// Timed out after 0.1 s. The process tree was stopped.
// (no output)
```

A tool call is `bash(input, ctx?)`. The input is `{ command, timeoutMs?, cwd? }`. `ctx` is the call context that the other tools use: `{ signal?, callId?, host }`.

Each call starts a new shell. A `cd` or an `export` does not carry to the next call. Use the `cwd` input instead.

## Hosts

| Host            | Package                      | Factories                                                                          |
| --------------- | ---------------------------- | ---------------------------------------------------------------------------------- |
| Node or Bun     | `@better-fs-tools/node`      | `createNodeBashTool()`, `nodeCommandRunner()`, and `bash` in `createNodeFsTools()` |
| AI SDK 7        | `@better-fs-tools/ai-sdk`    | `createAiSdkBashTool({ runner })`                                                  |
| Pi coding agent | `@better-fs-tools/pi`        | `createPiBashTool()`, with Pi's own shape: `{ command, timeout }` in seconds       |
| just-bash       | `@better-fs-tools/just-bash` | `justBashCommandRunner(bash)`, an emulated shell with no process                   |

## Results

| Status    | When                                                                                                   |
| --------- | ------------------------------------------------------------------------------------------------------ |
| `ok`      | The command exited with code 0.                                                                        |
| `failed`  | The command exited with another code, or a signal ended it. This is a normal result, not a tool error. |
| `timeout` | The timeout stopped the command. The output so far is kept.                                            |
| `error`   | The call stopped, or the core stopped the command. `error.code` says why.                              |

The error codes are `INVALID_INPUT`, `CWD_NOT_FOUND`, `CWD_NOT_A_DIRECTORY`, `DENIED` (the authorizer refused), `REFUSED` (a `beforeRun` hook refused), `ABORTED` (the caller's signal fired, before or during the run), `SPAWN_FAILED`, `OUTPUT_CAP`, and `EXTENSION_FAILED`. Read and write use the same codes for a denial and an abort.

The result is a union on `status`. Every result has `tool: "bash"`, `status`, `request`, `run` (command as run, cwd, exit code, signal, duration, and what stopped it), `output` (the view, byte and line counts, and the spill reference), `notes`, and `content` for the model. Only the `error` variant has `error: { code, phase, message, data? }`, the same shape as the read and write errors. For `ok`, `failed`, and `timeout`, `run` and `output` are never null. For `error` they are set only when the command started: an abort during the run, `OUTPUT_CAP`, or a failed `afterRun` hook.

```ts
import { createNodeBashTool } from "@better-fs-tools/node";

const bash = createNodeBashTool();
const result = await bash({ command: "ls" });

if (result.status === "error") {
  console.log(result.error.code, result.error.phase); // only the error variant has `error`
} else {
  console.log(result.run.exitCode, result.output.totalBytes); // never null here
}
```

Note codes are kebab case, as in read and write: `clamped`, `output-incomplete`, `spill-failed`, `unconfirmed-stop`, `extension-failed`, and the error note of an error result, whose code is the error code in kebab case (`denied`, `aborted`, `output-cap`, and so on).

The model text starts with the status line:

```text
Exit code 1 · 0.4 s
<output>
```

```text
Timed out after 2 min. The process tree was stopped.
<first lines>
[… 11945 lines (1.8 MB) not shown] Full output: /tmp/bash-1.log
<last lines>
```

## Defaults

| Limit              | Default    | Meaning                                                                                          |
| ------------------ | ---------- | ------------------------------------------------------------------------------------------------ |
| `defaultTimeoutMs` | 120 000    | Used when the input has no timeout.                                                              |
| `maxTimeoutMs`     | 600 000    | A larger input timeout is cut to this, with a `clamped` info note.                               |
| `killGraceMs`      | 2 000      | Time between SIGTERM and SIGKILL. The core waits this long plus one second for the exit.         |
| `maxOutputBytes`   | 30 000     | Bytes in the model view.                                                                         |
| `maxOutputLines`   | 2 000      | Lines in the model view.                                                                         |
| `headPercent`      | 20         | Percent of the view for the head. The tail gets the rest, because errors are usually at the end. |
| `maxCaptureBytes`  | 10 485 760 | Past this, the core stops the command with `OUTPUT_CAP`.                                         |

A `defaultTimeoutMs` that you set above `maxTimeoutMs`, or a `headPercent` over 100, throws `TypeError`. When you set only `maxTimeoutMs` below 120 000, the default timeout is lowered to it. The same limits rule holds in read, write, and bash. A per-call value over its ceiling is clamped, with a `clamped` info note. Two limits that you set and that conflict throw `TypeError` when the tool is built. A default that is over a ceiling you set is lowered to that ceiling.

stdout and stderr are merged in arrival order. The core decodes UTF-8 with replacement characters and removes ANSI escape codes. It changes nothing else.

The default environment is `defaultShellEnv` only: `PAGER=cat`, `GIT_PAGER=cat`, `GIT_TERMINAL_PROMPT=0`, `NO_COLOR=1`, and `TERM=dumb`. The Node and Pi factories add `process.env` under it with `shellEnv(() => process.env)`.

## Hooks

Only `runner` is required. `limits` and `messages` merge key by key. Every other dependency replaces its default.

| Dependency  | Default                   | What a host builds on it                                                                         |
| ----------- | ------------------------- | ------------------------------------------------------------------------------------------------ |
| `runner`    | required                  | Node, just-bash, a sandbox wrapper, a remote runner. A factory gets the call.                    |
| `cwd`       | the runner's `cwd`        | Another default directory, or one for each call.                                                 |
| `resolve`   | none                      | A read tool resolver changes the requested cwd string.                                           |
| `beforeRun` | `[]`                      | Guards and command rewrites. A rewrite feeds the next hook.                                      |
| `authorize` | none (allow)              | Approval prompts, prefix rules, deny lists, plan mode. A read `ToolAuthorizer` works on the cwd. |
| `env`       | `defaultShellEnv`         | Allow lists and secret scrubbing.                                                                |
| `spill`     | none                      | Every output byte saved to a file or a store.                                                    |
| `afterRun`  | `[]`                      | Secret masking, output filters, exit-code meanings, read-record invalidation.                    |
| `formatter` | `defaultShellFormatter()` | Another layout of the model text.                                                                |
| `messages`  | `defaultShellMessages`    | Wording. A signature sets the parameter names and the timeout unit.                              |
| `digest`    | null                      | Passed to host functions as `ctx.digest`. The bash tool hashes nothing itself.                   |
| `clock`     | `() => new Date()`        | Passed to host functions as `ctx.clock`.                                                         |

The stages run in this order: input, cwd, `beforeRun`, `authorize`, `env`, the run, `afterRun`, and the formatter. `authorize` sees the command after every `beforeRun` rewrite, so an approval prompt shows the command that runs. Its target has the cwd as `resolvedPath`, and a `displayPath` relative to the default cwd (`.` for the default cwd itself), as the file tools show paths.

A `beforeRun` hook returns `{ allow: true, command?, notes? }` or `{ allow: false, note? }`, the same `{ allow }` shape as an authorize decision. A refusal without a note gets a default `refused` note. An `afterRun` hook returns `{ output?, notes? }`: only the parts the core keeps. A field left out keeps its value.

```ts
import { createNodeBashTool } from "@better-fs-tools/node";
import type { AfterRunHook, BeforeRunHook, ShellAuthorizer } from "@better-fs-tools/shell";
import { defaultShellEnv } from "@better-fs-tools/shell";

// Host policy: allow a short list of command prefixes.
const allowPrefixes: ShellAuthorizer = {
  id: "allow-prefixes",
  authorize: (target) =>
    ["git status", "ls", "bun test"].some((prefix) => target.command.startsWith(prefix))
      ? { allow: true }
      : {
          allow: false,
          note: { code: "not-allowed", severity: "warning", message: "Ask the user first." },
        },
};

// A reusable guard: refuse programs that need a terminal. It runs before
// authorize, so allowPrefixes sees any rewritten command.
const noInteractive: BeforeRunHook = {
  id: "no-interactive",
  beforeRun: (run) =>
    /^(vim|less|top)\b/u.test(run.command)
      ? {
          allow: false,
          note: { code: "interactive", severity: "warning", message: "stdin is closed." },
        }
      : { allow: true },
};

// Mask a secret in the model view. The hook returns only what it changes.
const maskTokens: AfterRunHook = {
  id: "mask-tokens",
  afterRun: (outcome) => ({
    output: {
      ...outcome.output,
      head: outcome.output.head.replaceAll(/ghp_\w+/gu, "ghp_***"),
      tail: outcome.output.tail?.replaceAll(/ghp_\w+/gu, "ghp_***") ?? null,
    },
  }),
};

export const bash = createNodeBashTool({
  authorize: allowPrefixes,
  beforeRun: [noInteractive],
  afterRun: [maskTokens],
  // Only PATH and HOME from the host, plus the pager and colour defaults.
  env: () => ({
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    HOME: process.env.HOME ?? "/",
    ...defaultShellEnv,
  }),
});
```

A spill sink gets every byte in arrival order. Its reference goes into the truncation line:

```ts
import { open } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createNodeBashTool } from "@better-fs-tools/node";
import type { SpillSink } from "@better-fs-tools/shell";

// Save every byte to a file. The truncation line names it, so the model can
// read the part the view left out with the read tool.
const fileSpill: SpillSink = {
  id: "file",
  async open() {
    const path = join(tmpdir(), `bash-${crypto.randomUUID()}.log`);
    const file = await open(path, "w");
    return {
      write: async (bytes) => {
        await file.write(bytes);
      },
      close: async () => {
        await file.close();
        return path;
      },
    };
  },
};

export const bash = createNodeBashTool({ spill: fileSpill });
// [… 196 000 lines (1.2 MB) not shown] Full output: /tmp/bash-….log
```

A hook that throws, or returns a malformed value, gives `EXTENSION_FAILED` with its phase. After the run, the result keeps the run and the output.

A formatter that throws, or returns neither a string nor an array, does not change the status. The core adds an `extension-failed` warning and formats with `defaultShellFormatter()`, as the read and write tools do.

## Runners

A runner starts one command and never throws for a failed command:

- `run(request)` gets the command, an absolute cwd, the whole environment, an abort signal, and `killGraceMs`.
- It returns `output`, an async iterable of `{ stream, bytes }` chunks in arrival order, and `exit`, a promise of `{ code, signal, error? }`.
- When the signal aborts, the runner stops the whole process tree.
- A start that fails is an exit with `code: null` and an `error` reason: `cwd-not-found`, `cwd-not-a-directory`, or `spawn-failed`.

The runner's `id` goes into the tool description, so the model can see, for example, that commands run in an emulated shell.

## Signatures

`defaultBashSignature()` from `@better-fs-tools/shell/signature` gives the model `bash({ command, timeout?, cwd? })` with the timeout in milliseconds. `timeoutUnit: "s"` takes seconds, and `cwd: false` leaves out the cwd parameter. `bashSignatureMessages(signature)` gives the messages the same parameter names and unit.

## Known limits

- POSIX only. The Node runner runs `bash -c` in its own process group.
- A background child that outlives a normal exit keeps running. The core stops reading its output shortly after the shell exits.
- The allowed roots of the file tools do not limit what a command touches. Add an OS sandbox through a wrapper runner.
- The bash tool does not update the read records of the file tools. The write core still catches most changes, because it compares the version or the content hash at commit. On a backend with weak versions, a change in the same second can go unseen. An `afterRun` hook that calls `invalidate(path)` closes that gap.
- The just-bash runner buffers output until the command ends. A busy loop does not yield to the event loop, so the timeout cannot fire during it. Set just-bash's `executionLimits`.
- There are no background runs, no persistent session, no PTY, and no input to a running process.
