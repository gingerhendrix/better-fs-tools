import type { ToolSignature } from "../contract/base.ts";
import type { ReadInput } from "../contract/input.ts";
import type { JsonObject } from "../contract/json.ts";

/**
 * The read tool's signature. Adapter level. The core never sees it. It adds
 * `fromInput` to the shared base, so notes can tell the model how to continue.
 */
export interface ReadSignature<TModel extends JsonObject = JsonObject> extends ToolSignature<
  ReadInput,
  ReadParam
> {
  /** Maps a canonical retry to the object the model sends next. Pure. */
  fromInput(retry: ReadInput): TModel;
}

/** The canonical read parameters, and the parameter names of `defaultReadSignature`. */
export type ReadParam = "path" | "offset" | "limit";
/** The parameter names of `lineRangeSignature`. */
export type LineRangeParam = "path" | "start" | "end";

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
