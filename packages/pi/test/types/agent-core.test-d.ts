// Type tests: tsc checks this file through the package tsconfig; Bun does not run it.
import { Agent } from "@earendil-works/pi-agent-core";
import type { AgentContext, AgentTool } from "@earendil-works/pi-agent-core";
import type { TSchema } from "typebox";

import { memoryFileSystem } from "@better-fs-tools/fs";

import { createAgentCoreFsTools } from "../../src/agent-core.ts";
import type { PiMutationDetails, PiReadDetails } from "../../src/index.ts";

const tools = createAgentCoreFsTools({ fs: memoryFileSystem({ files: {} }), applyPatch: true });

// Each tool is an AgentTool, so an Agent and agentLoop() take it.
export const read: AgentTool<TSchema, PiReadDetails> = tools.read;
export const edit: AgentTool<TSchema, PiMutationDetails | undefined> = tools.edit;
export const context: AgentContext = { messages: [], tools: [...tools.tools] };
declare const agent: Agent;
agent.state.tools = [...agent.state.tools, ...tools.tools];

// @ts-expect-error cwd is not an option: give a filesystem
createAgentCoreFsTools({ fs: memoryFileSystem({ files: {} }), cwd: "/" });
