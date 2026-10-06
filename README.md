# Better FS Tools

A Bun and TypeScript monorepo for focused filesystem tools published under the `@better-fs-tools` npm scope.

The documentation site is deployed at [better-fs-tools.gandrew.com](https://better-fs-tools.gandrew.com).

## Packages

| Package                                                                | Contents                                                                                 |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| [`@better-fs-tools/read`](packages/read)                               | Better Read: a bounded file reader for agent tools. Start here.                          |
| [`@better-fs-tools/write`](packages/write)                             | The `edit`, `write`, and `apply_patch` tools on one mutation core, and `createFsTools()` |
| [`@better-fs-tools/shell`](packages/shell)                             | The `bash` tool: a small run core with hooks and defaults                                |
| [`@better-fs-tools/fs`](packages/fs)                                   | The read and write filesystem contract, a memory filesystem, and suites                  |
| [`@better-fs-tools/node`](packages/node)                               | The Node filesystem, a SHA-256 digest, a bash runner, and `createNodeFsTools()`          |
| [`@better-fs-tools/ai-sdk`](packages/ai-sdk)                           | The read, write, and bash tools for AI SDK 7                                             |
| [`@better-fs-tools/pi`](packages/pi)                                   | The read, write, and bash tools and extension for the Pi coding agent                    |
| [`@better-fs-tools/cloudflare-shell`](packages/cloudflare-shell)       | A writable filesystem over a Cloudflare Shell Workspace                                  |
| [`@better-fs-tools/cloudflare-computer`](packages/cloudflare-computer) | A writable filesystem over a Cloudflare Computer workspace (experimental)                |
| [`@better-fs-tools/just-bash`](packages/just-bash)                     | A writable filesystem and a bash runner over just-bash                                   |

All packages release together at one version. `examples/` holds the README examples, and `bun run typecheck` checks them.

- [packages/write/docs/hosts.md](packages/write/docs/hosts.md): which bundle to use, the defaults of every host, and what each backend can do
- Result schemas: [read](packages/read/docs/result-schema.md), [edit, write, and apply_patch](packages/write/docs/result-schema.md) (with one table of the statuses and error codes of all five tools), and [bash](packages/shell/docs/result-schema.md)
- [docs/migration.md](docs/migration.md): the breaking changes since `6f1985d`

## Requirements

- Bun 1.4.0

## Commands

```bash
bun install
bun run check
bun run format
bun run build
bun run build:packages
bun run check:packages
```

`bun run check` verifies formatting, lint rules, TypeScript, and tests. `bun run build` builds the documentation site.

`bun run build:packages` builds every package to `dist/` (JavaScript and declarations) with `tsc -b tsconfig.build.json`. `bun run check:packages` builds, packs each package with `bun pm pack`, and checks each tarball: its exports, files, dependency ranges, peers, the Pi extension entry, and every relative Markdown link. It then installs the tarballs into a throwaway project, runs them under Node, creates and edits a file and runs a command there with `createNodeFsTools()`, and type-checks their declarations. Pass `--out <dir>` to keep the tarballs.

Bun does not apply `publishConfig` when it packs. `scripts/check-packages.ts` applies `publishConfig.exports` and `publishConfig.pi` for the length of the pack, so publish the tarballs that it writes.

## Documentation site

The TanStack Start and Fumadocs application lives in `apps/docs`. Its infrastructure is an isolated Alchemy v2 stack deployed with:

```bash
bun run --cwd apps/docs plan
bun run --cwd apps/docs deploy
```

## Add a package

Create each publishable package at `packages/<name>` and name it `@better-fs-tools/<name>`. Use `catalog:` for shared dependency versions and `workspace:^` for links to other packages in this repository.

Each TypeScript package must extend `../../tsconfig.base.json` and enable `composite`. Add its path to the root `tsconfig.json` references so `bun run typecheck` checks the complete dependency graph.

For the release build, add a `tsconfig.build.json` that extends `../../tsconfig.build.base.json` and references the build configs of the packages it imports, and add it to the root `tsconfig.build.json`. In `package.json`, set `files`, set `repository` to the GitHub URL with `directory` set to `packages/<name>`, and map every export to `dist/` in `publishConfig.exports` with `types` and `import` conditions. Add the package to `scripts/package-check/rules.ts`, give it a `README.md` whose `ts` examples live in `examples/`, and copy the root `LICENSE` into the package folder. `check:packages` fails when a tarball has no `LICENSE`.

## License

MIT. See [LICENSE](LICENSE). Each package ships a copy of the same file.
