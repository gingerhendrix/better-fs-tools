# @better-fs-tools/eval-harness

A proof-of-concept harness. It runs the Oh My Pi `typescript-edit-benchmark` fixtures through an AI SDK loop with Better FS Tools, against Command Code models. It is private and not published.

## Run

```sh
export COMMANDCODE_API_KEY=...            # or AA_COMMANDCODE_API_KEY
export OMP_EDIT_FIXTURES=/path/to/fixtures  # folders with prompt.md, input/, expected/, metadata.json

bun run packages/eval-harness/src/cli.ts list
bun run packages/eval-harness/src/cli.ts run --out <dir> --suite poc-12 --arms edit,patch
bun run packages/eval-harness/src/cli.ts report --out <dir>
```

Get the fixtures from `packages/typescript-edit-benchmark/fixtures.tar.gz` in `can1357/oh-my-pi` (MIT).

Options for `run`:

| Flag                  | Default                                                    | Meaning                                                           |
| --------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------- |
| `--models`            | `xiaomi/mimo-v2.6-flash,nvidia/nemotron-3-ultra-550b-a55b` | Command Code model ids                                            |
| `--arms`              | `edit,patch`                                               | Tool configurations. `list` shows them                            |
| `--suite` / `--tasks` | `poc-12`                                                   | A named task list, or fixture ids                                 |
| `--attempts`          | `1`                                                        | Attempts for each cell                                            |
| `--concurrency`       | `4`                                                        | Cells in parallel                                                 |
| `--max-steps`         | `20`                                                       | Model calls for each cell                                         |
| `--step-timeout`      | `600`                                                      | Seconds for one model call                                        |
| `--no-early-stop`     | off                                                        | By default the loop stops when the file matches, as Oh My Pi does |
| `--keep-workspace`    | off                                                        | Keep the edited copy of the fixture                               |

`run` skips a cell that has a `result.json`, unless that cell ended in a provider error. So a second `run` with the same flags resumes the matrix.

## Output

```text
<out>/manifest.json
<out>/report.md
<out>/runs/<model>/<arm>/<task>/a<n>/
  result.json   pass, end state, tool calls, tool error codes, notes, tokens, wall time
  steps.jsonl   one line for each model call
  http.jsonl    raw request and response bodies
```

## Arms

| Arm          | Tools                                                 |
| ------------ | ----------------------------------------------------- |
| `edit`       | `read` with the line-number gutter, and `edit`        |
| `patch`      | `read` with the line-number gutter, and `apply_patch` |
| `write`      | `read` with the line-number gutter, and `write`       |
| `edit-plain` | `read` with `plainFormatter()`, and `edit`            |

Each arm gets a fresh memory store, so read-before-write is on.

## Metrics

Tool errors come from the result objects, with no log parsing. A Better FS Tools failure gives `<tool>:<CODE>`, for example `edit:NO_MATCH` or `apply_patch:PATCH_PARSE`. A call that never reached the tool gives `<tool>:bad-json`, `<tool>:schema`, or `<tool>:unknown-tool`.

The verifier is a port of the Oh My Pi verifier. It formats both files with Prettier and ignores blank-line count and whitespace-only line changes.
