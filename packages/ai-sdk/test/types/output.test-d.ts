/**
 * Type tests. `tsc -b` checks this file through the package tsconfig. Bun never
 * runs it: the name does not match Bun's test file pattern.
 */
import type {
  AiSdkBashTool,
  AiSdkMutationTool,
  AiSdkReadTool,
  AiSdkToolOutput,
} from "../../src/index.ts";

declare const read: AiSdkReadTool;
declare const edit: AiSdkMutationTool;
declare const bash: AiSdkBashTool;

// Every tool maps its result to the one AiSdkToolOutput type.
export const outputs: readonly AiSdkToolOutput[] = [
  read.toModelOutput({ output: {} as never }),
  edit.toModelOutput({ output: {} as never }),
  bash.toModelOutput({ output: {} as never }),
];
