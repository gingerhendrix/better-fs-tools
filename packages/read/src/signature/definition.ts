import type { ToolDefinition } from "../contract/base.ts";
import type { ReadContext } from "../contract/context.ts";
import type { ReadToolOptions, StateNeedsDigest } from "../contract/deps.ts";
import type { Digest } from "../contract/digest.ts";
import type { ReadFormatter } from "../contract/format.ts";
import type { ReadInput } from "../contract/input.ts";
import type { ReadLimits } from "../contract/limits.ts";
import type { ReadResult } from "../contract/result.ts";
import { createReadTool } from "../core/create-read-tool.ts";
import { parseReadInput } from "../core/input.ts";
import { resolveReadLimits } from "../core/limits.ts";
import { sha256Digest } from "../digest/sha256.ts";
import { lineNumberFormatter } from "../formatters/index.ts";
import type { ReadParam, ReadSignature } from "./contract.ts";
import { readSignatureMessages } from "./messages.ts";
import { defaultReadSignature } from "./offset-limit.ts";

/** The read tool's options, plus the signature the model sees. */
export type ReadToolDefinitionOptions<THost = undefined> = ReadToolOptions<THost> &
  StateNeedsDigest & {
    /** Default defaultReadSignature(). */
    readonly signature?: ReadSignature;
  };

/**
 * The read tool bound to its signature. `limits`, `formatter`, and `digest`
 * are the ones the tool uses, for a host that formats the result again.
 */
export interface ReadToolDefinition<THost = undefined> extends ToolDefinition<
  ReadInput,
  ReadResult,
  THost,
  ReadParam
> {
  readonly signature: ReadSignature;
  readonly limits: Readonly<ReadLimits>;
  readonly formatter: ReadFormatter<THost>;
  readonly digest: Digest | null;
}

/**
 * Creates the read tool and binds it to a signature, default
 * defaultReadSignature(). The signature's retry text goes under
 * `options.messages`, so a host message still wins. Throws TypeError where
 * createReadTool() does.
 */
export function readToolDefinition<THost = undefined>(
  options: ReadToolDefinitionOptions<THost>,
): ReadToolDefinition<THost> {
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("readToolDefinition options must be an object");
  }
  const { signature = defaultReadSignature(), ...rest } = options;
  const limits = resolveReadLimits(rest.limits);
  const formatter: ReadFormatter<THost> = rest.formatter ?? lineNumberFormatter();
  const digest = rest.digest === undefined ? sha256Digest() : rest.digest;
  const read = createReadTool<THost>({
    ...rest,
    limits,
    formatter,
    digest,
    messages: { ...readSignatureMessages(signature), ...rest.messages },
  } as ReadToolOptions<THost> & StateNeedsDigest);
  return bindReadTool(signature, read as ReadToolCore<THost>, { limits, formatter, digest });
}

type ReadToolCore<THost> = (input: ReadInput, ctx: ReadContext<THost>) => Promise<ReadResult>;

function bindReadTool<THost>(
  signature: ReadSignature,
  read: ReadToolCore<THost>,
  resolved: {
    readonly limits: Readonly<ReadLimits>;
    readonly formatter: ReadFormatter<THost>;
    readonly digest: Digest | null;
  },
): ReadToolDefinition<THost> {
  return Object.freeze<ReadToolDefinition<THost>>({
    name: signature.name,
    description: signature.description,
    inputSchema: signature.schema,
    ...(signature.grammar === undefined ? {} : { grammar: signature.grammar }),
    signature,
    limits: resolved.limits,
    formatter: resolved.formatter,
    digest: resolved.digest,
    validate(modelInput) {
      const input = signature.toInput(modelInput);
      parseReadInput(input, resolved.limits);
      return input;
    },
    execute: async (modelInput, ctx) => read(signature.toInput(modelInput), ctx),
  });
}
