import type { JsonObject } from "../contract/json.ts";
import type { ReadInput } from "../contract/input.ts";

/** Adapter level. The core never sees it. */
export interface ReadSignature<TModel extends JsonObject = JsonObject> {
  /** Pi uses it as name and label. AI SDK hosts use it as the ToolSet key. */
  readonly name: string;
  readonly description: string;
  /** Plain JSON Schema with a description on each parameter. */
  readonly schema: JsonObject;
  /** Validates model input and maps it to canonical input. Pure. Throws TypeError naming host parameters. */
  toRead(input: unknown): ReadInput;
  /** Maps a canonical retry to the object the model sends next. Pure. */
  fromRead(retry: ReadInput): TModel;
}

export type ReadParam = "path" | "offset" | "limit";
export type LineRangeParam = "path" | "start" | "end";

export interface SignatureDocs<TParam extends string> {
  readonly name?: string;
  readonly description?: string;
  readonly describe?: Partial<Record<TParam, string>>;
}

/**
 * A type alias, not an interface: TypeScript refuses an optional property next
 * to the JsonValue index signature, but an object type literal still fits the
 * JsonObject constraint.
 */
export type DefaultReadModelInput = {
  readonly path: string;
  readonly offset?: number;
  readonly limit?: number;
};
