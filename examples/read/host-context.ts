import { memoryFileSystem } from "@better-fs-tools/fs";
import { nodeDigest } from "@better-fs-tools/node";
import { askUser, createReadTool, memoryStore } from "@better-fs-tools/read";
import type { ReadStateStore } from "@better-fs-tools/read";

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
    if (store === undefined) stores.set(call.host.id, (store = memoryStore()));
    return store;
  },
  // A state needs a digest: a record names the digest that made it.
  digest: nodeDigest(),
  authorize: askUser<Session>((target, ctx) =>
    ctx.call.host.confirm(`Read ${target.displayPath}?`),
  ),
});

// With a host type, the context and its host are required.
const session: Session = { id: "s1", confirm: async () => true };
await read({ path: "/a.txt" }, { host: session, callId: "call-1" });
