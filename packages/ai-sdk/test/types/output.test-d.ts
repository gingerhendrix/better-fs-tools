import type {
  AiSdkBashTool,
  AiSdkMutationTool,
  AiSdkReadTool,
  AiSdkToolOutput,
} from "../../src/index.ts";

declare const read: AiSdkReadTool;
declare const edit: AiSdkMutationTool;
declare const bash: AiSdkBashTool;

export const outputs: readonly AiSdkToolOutput[] = [
  read.toModelOutput({ output: {} as never }),
  edit.toModelOutput({ output: {} as never }),
  bash.toModelOutput({ output: {} as never }),
];
