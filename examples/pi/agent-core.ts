import { Agent } from "@earendil-works/pi-agent-core";
import { createAgentCoreFsTools } from "@better-fs-tools/pi/agent-core";
import { nodeFileSystem } from "@better-fs-tools/node";
import { memoryStore } from "@better-fs-tools/read";

const fsTools = createAgentCoreFsTools({
  fs: nodeFileSystem({ cwd: "/work/repo", allowedRoots: ["/work/repo"] }),
  state: memoryStore(),
});

export function addFsTools(agent: Agent): void {
  agent.state.tools = [...agent.state.tools, ...fsTools.tools];
}
