## @better-fs-tools/pi-durable@0.3.0

### New package: @better-fs-tools/pi-durable

Better FS Tools for `@earendil-works/pi-durable`, the experimental durable harness of Pi. `createDurableFsTools()` is an extension that replaces the `read`, `edit`, and `write` of `CodingTools`, and can add `apply_patch` and `bash`.

- Each call reads and writes through the call's `ExecutionEnv`, so the tools work on the local machine, over SSH with pi-env, and in a container. `executionEnvFileSystem()` is the filesystem, and it passes the filesystem and write conformance suites.
- Read records live in the conversation's documents. They stay after a restart and follow a fork.
- `read` is safe to replay. A tool error is an error result.
- `executionEnvRunner()` runs bash commands through the environment's `exec()`.

pi-durable is experimental, so this package follows pi-durable 1.2 (`~1.2.0`).
