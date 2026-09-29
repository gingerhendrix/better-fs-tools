# Migrating from 6f1985d

The `feature-api-fixes` branch changed the public API of every package after `main` `6f1985d`. Nothing was published (all packages are at 0.0.0), so there are no aliases. This page lists the breaking changes by package. The package READMEs and `docs/` show the new shapes.

## All tools

- Every result has `tool` and `status`, and is a union on `status`. Only `status: "error"` has `error`, and it is never null: `{ code, phase, message, data? }`. There is no `error: null` on other results.
- An abort before the call started is `ABORTED` in phase `input` in every tool. A later abort names the stage it hit.
- Error codes are UPPER_SNAKE. Note codes are kebab case in every tool, and an error note's code is its error code in kebab case. This holds for a host refusal too: when an authorizer, a `beforeRun` hook, or a guard refuses with its own `note`, the note keeps its message and data, its code becomes the error code in kebab case, its severity becomes `warning`, and the host's own code moves to `data.source`. Allow notes and other host notes stay as the host gave them.
- A formatter that throws keeps the status, adds an `extension-failed` warning, and the default formatter runs.
- Limits: a per-call value over its ceiling is clamped with a `clamped` info note. Two limits you set that conflict throw `TypeError`. A default over a ceiling you set is lowered to it.
- Authorizers are function properties, so a read authorizer no longer fits a write or bash tool.
- Parse helpers (`parseReadInput`, `parseEditInput`, `parseWriteInput`, `parseApplyPatchInput`, `parseBashInput`) return the request and throw `TypeError`.
- `ToolSignature` is one base for every signature: `toInput(input)` and `param(name)`. Every preset takes `names`, keyed by the preset's own parameter names.

## `@better-fs-tools/read`

- Read names that write and shell share get the `Read` prefix: `ReadDependencies`, `ReadAuthorizer`, `ReadFormatter`, `ReadHookContext`, `ReadMessageCatalog`, `defaultReadLimits`, `resolveReadLimits`, `defaultReadMessages`, `readAuthorizers`, and the others.
- `ReadOutcome` is `ReadReport`. `result.code` on an error is `result.error.code`.
- `./signature`: `defaultSignature` is `defaultReadSignature`, `renamedSignature` is gone (use `defaultReadSignature({ names })`), `signatureMessages` is `readSignatureMessages`, and `toRead`/`fromRead` are `toInput`/`fromInput`.
- The `./state` subpath is gone. `createMemoryStore` is on the root, and its `clock` is the core `Clock` (`() => Date`).
- `createReadTool({ fs, state })` without a `digest` throws `TypeError`.
- New: `sha256Digest()`, `StateNeedsDigest`, `StateNeedsDigestOrDefault`, `ToolError`, and `TOO_LARGE` for a backend byte ceiling.

## `@better-fs-tools/write`

- `MutationReport` is a union on `status` (`MutationOk`, `MutationNoChange`, `MutationFailure`). `WriteError` has `message`.
- `CanonicalParam` is `WriteCanonicalParam`. `MutationSignatureDocs` is `SignatureDocs` from read.
- The patch grammar, the parser, and the patch types are only on `./patch`.
- `createInvalidator()` returns an `InvalidateOutcome`, not `void`.
- A read-only backend gives `UNSUPPORTED_BACKEND` for a write.
- `maxPatchBytes` counts UTF-8 bytes.
- New: `createFsTools()`, the portable bundle. The package now depends on `@better-fs-tools/shell`.

## `@better-fs-tools/shell`

- Statuses are `ok`, `failed`, `timeout`, and `error`. `aborted` is `error` with `ABORTED`. `refused` is `error` with `DENIED` (authorizer) or `REFUSED` (`beforeRun`).
- `createBashTool` requires `env`. There is no default environment.
- `beforeRun` runs before `authorize`, and returns `{ allow: true, command?, notes? }` or `{ allow: false, note? }`. `afterRun` returns `{ output?, notes? }`.
- The authorize target's `displayPath` is relative to the default cwd.
- New dependencies `digest` (default `null`) and `clock`.
- `BashSignatureOptions` takes `names`.

## `@better-fs-tools/fs`

- New shared adapter options: `FileSystemRootOptions`, `BufferedFileSystemOptions`, `FileSystemRootSettings`, `SymlinkPolicy`, `IdentityMode`, and one 16 MiB `DEFAULT_MAX_BUFFERED_BYTES`.
- `memoryFileSystem({ identity })` takes `"required"` or `"none"`, not a boolean.
- A backend byte ceiling is the new reason `too-large`, not `denied` or `no-space`. A deny root is `dangerous-path` in every backend.
- New: `readOnlyFileSystem(fs)`.

## `@better-fs-tools/node`

- `createNodeFsTools()` has no bash unless you pass `bash: true` or bash options. `bash` is `null` otherwise.
- New files are `0o666` and new directories `0o777`, less the process umask. `newFileMode` and `newDirectoryMode` set them exactly.
- `invalidate(path)` returns an `InvalidateOutcome`. The bundle also returns `digest` and `clock`, and takes `clock`, `newFileMode`, and `newDirectoryMode`. A `clock` inside a tool's options throws.
- `nodeCommandRunner({ cwd })` resolves a relative `cwd` against `process.cwd()`.
- Unknown option keys throw `TypeError`.

## `@better-fs-tools/ai-sdk`

- `AiSdkReadOutput` is `AiSdkToolOutput`.
- `createAiSdkBashTool` requires `env`.
- Tools send strict-mode schemas: every property is required, and optional ones are nullable.
- New: `createAiSdkFsTools()`.

## `@better-fs-tools/pi`

- `CreatePiBashToolOptions` has no `cwd`.
- `createPiFsTools()` returns `state`, `digest`, `locks`, `clock`, and `invalidate(path, call)`, and takes `locks`, `clock`, `newFileMode`, and `newDirectoryMode`. Unknown option keys throw `TypeError`.

## Backends

- just-bash: `justBashReadFileSystem` is gone. Use `justBashFileSystem(fs, options)`, and `readOnlyFileSystem()` for a read-only view. `id` and `maxBufferedBytes` are optional. `symlinks: "backend-policy"` is `"follow-within-roots"`, and `"reject"` now refuses a link in any component. The peer range is `^3.4.2`.
- Cloudflare Shell: `shellWorkspaceFileSystem` is `cloudflareShellFileSystem`, and the `ShellWorkspace*` types are `CloudflareShell*`. `root` is `allowedRoots: [root]`. `maxBufferedBytes` defaults to 16 MiB, not 4 MiB.
- Cloudflare Computer: `computerFileSystem` is `cloudflareComputerFileSystem`, and the `Computer*` types are `CloudflareComputer*`. `root` is `allowedRoots: [root]`.
- The Cloudflare and just-bash adapters check their write methods when a write runs, so a backend without them still reads.
