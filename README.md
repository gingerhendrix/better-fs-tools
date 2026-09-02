# Better FS Tools

A Bun and TypeScript monorepo for focused filesystem tools published under the `@better-fs-tools` npm scope.

This repository contains the shared monorepo scaffold. Tool packages will be added in separate changes.

## Requirements

- Bun 1.4.0

## Commands

```bash
bun install
bun run check
```

## Add a package

Create each publishable package at `packages/<name>` and name it `@better-fs-tools/<name>`. Use `catalog:` for shared dependency versions and `workspace:*` for links to other packages in this repository.

Each TypeScript package must extend `../../tsconfig.base.json` and enable `composite`. Add its path to the root `tsconfig.json` references so `bun run typecheck` checks the complete dependency graph.
