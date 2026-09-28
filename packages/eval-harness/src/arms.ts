import type { ToolSet } from "ai";

import {
  createAiSdkApplyPatchTool,
  createAiSdkEditTool,
  createAiSdkReadTool,
  createAiSdkWriteTool,
} from "@better-fs-tools/ai-sdk";
import { nodeDigest, nodeFileSystem } from "@better-fs-tools/node";
import { plainFormatter } from "@better-fs-tools/read";
import { createMemoryStore } from "@better-fs-tools/read/state";
import { memoryLocks } from "@better-fs-tools/write";

/**
 * An arm is one tool configuration. It changes one axis against the `edit`
 * baseline, so each pair of arms answers one question.
 */
export interface Arm {
  readonly name: string;
  readonly description: string;
  /** The tool the system prompt names for making the change. */
  readonly editTool: string;
  tools(cwd: string): ToolSet;
}

type ReadFormat = "line-number" | "plain";
type Writer = "edit" | "apply_patch" | "write";

function buildTools(cwd: string, format: ReadFormat, writer: Writer): ToolSet {
  const shared = {
    fs: nodeFileSystem({ cwd, allowedRoots: [cwd] }),
    state: createMemoryStore(),
    digest: nodeDigest(),
  };
  const locks = memoryLocks();
  const read = createAiSdkReadTool({
    ...shared,
    ...(format === "plain" ? { formatter: plainFormatter() } : {}),
  });
  const mutation =
    writer === "edit"
      ? createAiSdkEditTool({ ...shared, locks })
      : writer === "apply_patch"
        ? createAiSdkApplyPatchTool({ ...shared, locks })
        : createAiSdkWriteTool({ ...shared, locks });
  return { [read.name]: read, [mutation.name]: mutation } as ToolSet;
}

function arm(name: string, description: string, format: ReadFormat, writer: Writer): Arm {
  return { name, description, editTool: writer, tools: (cwd) => buildTools(cwd, format, writer) };
}

export const ARMS: readonly Arm[] = [
  arm("edit", "read (line-number gutter) + edit. Baseline.", "line-number", "edit"),
  arm("patch", "read (line-number gutter) + apply_patch.", "line-number", "apply_patch"),
  arm("write", "read (line-number gutter) + write (whole file).", "line-number", "write"),
  arm("edit-plain", "read (no gutter) + edit. Gutter question.", "plain", "edit"),
];

export function findArm(name: string): Arm {
  const found = ARMS.find((a) => a.name === name);
  if (found === undefined) {
    throw new Error(`unknown arm "${name}". Known: ${ARMS.map((a) => a.name).join(", ")}`);
  }
  return found;
}
