---
packages:
  "@better-fs-tools/pi": minor
---

## Tools for Pi agent core

`@better-fs-tools/pi/agent-core` has `createAgentCoreFsTools()`. It returns `read`, `edit`, and `write`, and optionally `apply_patch` and `bash`, as `AgentTool` objects for `@earendil-works/pi-agent-core`. Put `tools` in `agent.state.tools` or in an `agentLoop()` context.

The bundle takes the options of `createFsTools()`, with any writable filesystem. It uses the signatures and output schemas of the coding agent's own tools, sets `isError: true` on a tool error, and marks `read` as safe to replay. The module imports no Node module and no Pi package at run time, so it runs in a browser or a Worker.
