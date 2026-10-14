import { createRegistry } from "@earendil-works/pi-durable";
import { CodingTools } from "@earendil-works/pi-durable/tools";
import { createDurableFsTools } from "@better-fs-tools/pi-durable";

// Installed after CodingTools, so its read, edit, and write win. The bash of
// CodingTools stays. Read records live in the conversation's documents.
export function fsToolsRegistry() {
  const registry = createRegistry();
  registry.install(CodingTools);
  registry.install(createDurableFsTools());
  return registry;
}
