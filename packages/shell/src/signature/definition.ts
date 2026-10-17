import type { ToolCallContext, ToolDefinition } from "@better-fs-tools/read";

import type { BashToolOptions } from "../contract/deps.ts";
import type { BashInput } from "../contract/input.ts";
import type { ShellCanonicalParam } from "../contract/messages.ts";
import type { ShellResult } from "../contract/result.ts";
import { createBashTool } from "../core/create-bash-tool.ts";
import { parseBashInput } from "../core/input.ts";
import { resolveShellLimits } from "../core/limits.ts";
import { bashSignatureMessages, defaultBashSignature } from "./bash.ts";
import type { BashSignature } from "./bash.ts";

/** The bash tool bound to its signature. */
export interface BashToolDefinition<THost = undefined> extends ToolDefinition<
  BashInput,
  ShellResult,
  THost,
  ShellCanonicalParam
> {
  readonly signature: BashSignature;
}

/** The bash tool's options, plus the signature the model sees. */
export type BashToolDefinitionOptions<THost = undefined> = BashToolOptions<THost> & {
  /**
   * Default defaultBashSignature() with the runner's id, when the runner is
   * not a factory, and the tool's limits, so the description names them.
   */
  readonly signature?: BashSignature;
};

/**
 * Creates the bash tool and binds it to a signature. The signature's `param`
 * and `duration` messages go under `options.messages`, so a host message
 * still wins. Throws TypeError where createBashTool() does.
 */
export function bashToolDefinition<THost = undefined>(
  options: BashToolDefinitionOptions<THost>,
): BashToolDefinition<THost> {
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("bashToolDefinition options must be an object");
  }
  const { signature: given, ...rest } = options;
  const runnerId = typeof rest.runner === "function" ? undefined : rest.runner?.id;
  const signature =
    given ??
    defaultBashSignature({
      ...(runnerId === undefined ? {} : { runner: runnerId }),
      ...(rest.limits === undefined ? {} : { limits: rest.limits }),
    });
  const bash = createBashTool<THost>({
    ...rest,
    messages: { ...bashSignatureMessages(signature), ...rest.messages },
  }) as (input: BashInput, ctx: ToolCallContext<THost>) => Promise<ShellResult>;
  const limits = resolveShellLimits(rest.limits);
  return Object.freeze<BashToolDefinition<THost>>({
    name: signature.name,
    description: signature.description,
    inputSchema: signature.schema,
    ...(signature.grammar === undefined ? {} : { grammar: signature.grammar }),
    signature,
    validate(modelInput) {
      const input = signature.toInput(modelInput);
      parseBashInput(input, limits);
      return input;
    },
    execute: async (modelInput, ctx) => bash(signature.toInput(modelInput), ctx),
  });
}
