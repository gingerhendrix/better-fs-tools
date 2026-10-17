---
packages:
  "@better-fs-tools/pi": minor
---

## Tools for Pi agent core

`@better-fs-tools/pi/agent-core` gives the tools as `AgentTool` objects for `@earendil-works/pi-agent-core`. `createAgentCoreFsTools()` returns `read`, `edit`, and `write`, and optionally `apply_patch` and `bash`. Put `tools` in `agent.state.tools` or in an `agentLoop()` context. `createAgentCoreReadTool()`, `createAgentCoreEditTool()`, `createAgentCoreWriteTool()`, `createAgentCoreApplyPatchTool()`, and `createAgentCoreBashTool()` build one tool each.

The factories take the options of the core factories and `createFsTools()`, with the same defaults, over any writable filesystem. A tool error is a result with `isError: true`, and `read` is marked as safe to replay. The module imports no Node module and no Pi package at run time, so it runs in a browser or a Worker.
