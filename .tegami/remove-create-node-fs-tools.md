---
packages:
  "@better-fs-tools/node": minor
---

## `createNodeFsTools()` is gone: use `createFsTools()` with `nodeFileSystem()`

`@better-fs-tools/node` is a filesystem provider. It no longer exports `createNodeFsTools()` or its types: `CreateNodeFsToolsOptions`, `NodeFsTools`, `NodeFsToolsBashOptions`, `NodeFsToolsWithApplyPatch`, and `NodeFsToolsWithBash`. Pass `nodeFileSystem()` as `fs` to `createFsTools()` from `@better-fs-tools/write`. The `FsTools` types from that package replace the Node types.

The package keeps `nodeFileSystem()`, `nodeDigest()`, `nodeCommandRunner()`, and the single-tool factories, such as `createNodeReadTool()` and `createNodeBashTool()`.

Before:

```ts
import { createNodeFsTools } from "@better-fs-tools/node";
import { memoryStore } from "@better-fs-tools/read";

const tools = createNodeFsTools({ cwd, state: memoryStore(), bash: true });
```

After:

```ts
import { nodeCommandRunner, nodeDigest, nodeFileSystem } from "@better-fs-tools/node";
import { memoryStore } from "@better-fs-tools/read";
import { shellEnv } from "@better-fs-tools/shell";
import { createFsTools } from "@better-fs-tools/write";

const tools = createFsTools({
  fs: nodeFileSystem({ cwd, allowedRoots: [cwd] }),
  digest: nodeDigest(),
  state: memoryStore(),
  bash: { runner: nodeCommandRunner({ cwd }), env: shellEnv(() => process.env) },
});
```

The root options of the old bundle (`cwd`, `allowedRoots`, `denyRoots`, `symlinks`, `hardLinks`, `newFileMode`, and `newDirectoryMode`) now go to `nodeFileSystem()`. `allowedRoots` has no default there, so set it. `digest: nodeDigest()` is optional. The default `sha256Digest()` gives the same values. `createFsTools()` has no `bash: true`. Give it a `runner` and an `env`, as above. A bash `cwd` comes from the runner, or from `bash.cwd`.
