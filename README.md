# Better FS Tools

A Bun and TypeScript monorepo for focused filesystem tools published under the `@better-fs-tools` npm scope.

The documentation site is deployed at [better-fs-tools.gandrew.com](https://better-fs-tools.gandrew.com).

## Packages

| Package                                                                | Contents                                                                  |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| [`@better-fs-tools/read`](packages/read)                               | Better Read: a bounded file reader for agent tools. Start here.           |
| [`@better-fs-tools/fs`](packages/fs)                                   | The filesystem contract, an in-memory filesystem, and a conformance suite |
| [`@better-fs-tools/node`](packages/node)                               | The Node filesystem, a SHA-256 digest, and `createNodeReadTool()`         |
| [`@better-fs-tools/ai-sdk`](packages/ai-sdk)                           | The read tool for AI SDK 7                                                |
| [`@better-fs-tools/pi`](packages/pi)                                   | The read tool and extension for the Pi coding agent                       |
| [`@better-fs-tools/cloudflare-shell`](packages/cloudflare-shell)       | A filesystem over a Cloudflare Shell Workspace                            |
| [`@better-fs-tools/cloudflare-computer`](packages/cloudflare-computer) | A filesystem over a Cloudflare Computer workspace (experimental)          |
| [`@better-fs-tools/just-bash`](packages/just-bash)                     | A filesystem over a just-bash `IFileSystem`                               |

All packages release together at one version. `examples/` holds the README examples, and `bun run typecheck` checks them.

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

`bun run build:packages` builds every package to `dist/` (JavaScript and declarations) with `tsc -b tsconfig.build.json`. `bun run check:packages` builds, packs each package with `bun pm pack`, and checks each tarball: its exports, files, dependency ranges, peers, and the Pi extension entry. It then installs the tarballs into a throwaway project, runs them under Node, and type-checks their declarations. Pass `--out <dir>` to keep the tarballs.

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

For the release build, add a `tsconfig.build.json` that extends `../../tsconfig.build.base.json` and references the build configs of the packages it imports, and add it to the root `tsconfig.build.json`. In `package.json`, set `files`, and map every export to `dist/` in `publishConfig.exports` with `types` and `import` conditions. Add the package to `scripts/package-check/rules.ts`, and give it a `README.md` whose `ts` examples live in `examples/`.
