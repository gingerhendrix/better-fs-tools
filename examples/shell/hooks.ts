import { createNodeBashTool } from "@better-fs-tools/node";
import type { AfterRunHook, BeforeRunHook, ShellAuthorizer } from "@better-fs-tools/shell";
import { defaultShellEnv } from "@better-fs-tools/shell";

// Host policy: allow a short list of command prefixes.
const allowPrefixes: ShellAuthorizer = {
  id: "allow-prefixes",
  authorize: (target) =>
    ["git status", "ls", "bun test"].some((prefix) => target.command.startsWith(prefix))
      ? { allow: true }
      : {
          allow: false,
          note: { code: "NOT_ALLOWED", severity: "warning", message: "Ask the user first." },
        },
};

// A reusable guard: refuse programs that need a terminal.
const noInteractive: BeforeRunHook = {
  id: "no-interactive",
  beforeRun: (run) =>
    /^(vim|less|top)\b/u.test(run.command)
      ? {
          kind: "refuse",
          note: { code: "INTERACTIVE", severity: "warning", message: "stdin is closed." },
        }
      : { kind: "continue" },
};

// Mask a secret in the model view.
const maskTokens: AfterRunHook = {
  id: "mask-tokens",
  afterRun: (outcome) => ({
    ...outcome,
    output: {
      ...outcome.output,
      head: outcome.output.head.replaceAll(/ghp_\w+/gu, "ghp_***"),
      tail: outcome.output.tail?.replaceAll(/ghp_\w+/gu, "ghp_***") ?? null,
    },
  }),
};

export const bash = createNodeBashTool({
  authorize: allowPrefixes,
  beforeRun: [noInteractive],
  afterRun: [maskTokens],
  // Only PATH and HOME from the host, plus the pager and colour defaults.
  env: () => ({
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    HOME: process.env.HOME ?? "/",
    ...defaultShellEnv,
  }),
});
