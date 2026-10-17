import { createAgentSession, SessionManager } from "@earendil-works/pi-coding-agent";
import { createPiFsTools } from "@better-fs-tools/pi";
import { piCwdFileSystem } from "@better-fs-tools/pi/node";
import { memoryStore } from "@better-fs-tools/read";

const cwd = "/work/repo";
const tools = createPiFsTools({ fs: piCwdFileSystem(), state: memoryStore(), applyPatch: true });

// read, edit, and write have the names of Pi's built-in tools, so they replace
// them. Pi's own bash stays.
const { session } = await createAgentSession({
  cwd,
  sessionManager: SessionManager.inMemory(cwd),
  customTools: [tools.read, tools.edit, tools.write, tools.applyPatch],
});

try {
  await session.prompt("Rename greet() to welcome() in src/greet.ts.");
} finally {
  session.dispose();
}
