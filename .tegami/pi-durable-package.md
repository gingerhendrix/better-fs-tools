---
packages:
  "@better-fs-tools/pi-durable": minor
---

## New package: @better-fs-tools/pi-durable

Better FS Tools for `@earendil-works/pi-durable`, the experimental durable harness of Pi. `createDurableFsTools()` is an extension that replaces the `read`, `edit`, and `write` of `CodingTools`, and can add `apply_patch` and `bash`. It takes the options of `createFsTools()`, with the same defaults, plus the Harness settings `name` and `outputLimits`.

- `durableEnvFileSystem()` gives each call a filesystem over the call's `ExecutionEnv`, so the tools work on the local machine, over SSH with pi-env, and in a container. `executionEnvFileSystem()` is that filesystem, and it passes the filesystem and write conformance suites.
- `documentReadStore()` keeps read records in the conversation's documents. They stay after a restart and follow a fork.
- `durableEnvRunner()` runs bash commands through the environment's `exec()`.
- `read` is safe to replay. A tool error is an error result.

pi-durable is experimental, so this package follows pi-durable 1.2 (`~1.2.0`).
