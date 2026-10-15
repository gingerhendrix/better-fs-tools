import { createRegistry } from "@earendil-works/pi-durable";
import { CodingTools } from "@earendil-works/pi-durable/tools";
import { createDurableFsTools } from "@better-fs-tools/pi-durable";

// Installed after CodingTools, so its read, edit, and write win. The bash of
// CodingTools stays.
export function fsToolsRegistry() {
  const registry = createRegistry();
  registry.install(CodingTools);
  registry.install(createDurableFsTools());
  return registry;
}

// Read-before-write is off by default. With state "document", the read
// records live in the conversation's documents, so they stay after a restart.
export function readFirstRegistry() {
  const registry = createRegistry();
  registry.install(CodingTools);
  registry.install(createDurableFsTools({ state: "document" }));
  return registry;
}
