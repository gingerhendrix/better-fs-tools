import { createRegistry } from "@earendil-works/pi-durable";
import { CodingTools } from "@earendil-works/pi-durable/tools";
import {
  createDurableFsTools,
  documentReadStore,
  durableEnvFileSystem,
  durableEnvRunner,
} from "@better-fs-tools/pi-durable";
import { shellEnv } from "@better-fs-tools/shell";

// Installed after CodingTools, so its read, edit, and write win. The bash of
// CodingTools stays.
export function fsToolsRegistry() {
  const registry = createRegistry();
  registry.install(CodingTools);
  registry.install(
    createDurableFsTools({
      fs: durableEnvFileSystem(), // each call reads and writes through its ExecutionEnv
    }),
  );
  return registry;
}

// The recommended configuration: read records in the conversation's
// documents, so they stay after a restart and follow a fork, and bash over the
// environment's exec() in place of the bash of CodingTools.
export function recommendedRegistry() {
  const registry = createRegistry();
  registry.install(CodingTools);
  registry.install(
    createDurableFsTools({
      fs: durableEnvFileSystem({ allowedRoots: ["."] }),
      state: documentReadStore(),
      bash: { runner: durableEnvRunner(), env: shellEnv() },
    }),
  );
  return registry;
}
