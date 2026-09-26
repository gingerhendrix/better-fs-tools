import { memoryFileSystem } from "@better-fs-tools/fs";
import { askUser, createReadTool } from "@better-fs-tools/read";
import type { ReadStateStore } from "@better-fs-tools/read";
import { createMemoryStore } from "@better-fs-tools/read/state";

interface Session {
  readonly id: string;
  confirm(question: string): Promise<boolean>;
}

const stores = new Map<string, ReadStateStore>();

const read = createReadTool<Session>({
  fs: memoryFileSystem({ files: { "/a.txt": "alpha\n" } }),
  // Called at most once for each read, and only when the core needs a store.
  state: (call) => {
    let store = stores.get(call.host.id);
    if (store === undefined) stores.set(call.host.id, (store = createMemoryStore()));
    return store;
  },
  authorize: askUser<Session>((target, ctx) =>
    ctx.call.host.confirm(`Read ${target.displayPath}?`),
  ),
});

// With a host type, the context and its host are required.
const session: Session = { id: "s1", confirm: async () => true };
await read({ path: "/a.txt" }, { host: session, callId: "call-1" });
