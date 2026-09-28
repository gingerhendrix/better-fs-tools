import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createPiReadTool } from "@better-fs-tools/pi";
import { lineRangeSignature } from "@better-fs-tools/read/signature";
import {
  askUser,
  readAuthorizers,
  denyPaths,
  directoryListing,
  eofFooter,
  imageConverter,
  lineNumberFormatter,
  pathResolvers,
  redact,
  repeatReadGuard,
  sizeCeiling,
  stripPrefixes,
  unicodeRepair,
} from "@better-fs-tools/read";
import { createMemoryStore } from "@better-fs-tools/read/state";

const stores = new Map<string, ReturnType<typeof createMemoryStore>>();

export const read = createPiReadTool({
  signature: lineRangeSignature({
    name: "read",
    names: { path: "file_path", start: "start_line", end: "end_line" },
  }),
  resolve: pathResolvers(stripPrefixes(), unicodeRepair({ note: false })),
  authorize: readAuthorizers(
    denyPaths(["**/.env", "**/.env.*"]),
    sizeCeiling({ maxBytes: 256 * 1024, unrangedOnly: true }),
    askUser<ExtensionContext>(async (target, ctx) => {
      const pi = ctx.call.host;
      if (!pi.hasUI) return false;
      return pi.ui.confirm("Read file?", target.displayPath, { signal: ctx.call.signal });
    }),
  ),
  converters: [imageConverter(), directoryListing({ trailingSlash: true })],
  state: (call) => {
    const id = call.host.sessionManager.getSessionId();
    let store = stores.get(id);
    if (store === undefined) stores.set(id, (store = createMemoryStore()));
    return store;
  },
  hooks: [repeatReadGuard(), redact({ patterns: [/AKIA[0-9A-Z]{16}/g] })],
  formatter: lineNumberFormatter({ footer: eofFooter((n) => `(End of file, ${n} lines)`) }),
});
