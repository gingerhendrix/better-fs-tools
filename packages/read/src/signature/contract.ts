import type { ToolSignature } from "../contract/base.ts";
import type { ReadInput } from "../contract/input.ts";
import type { JsonObject } from "../contract/json.ts";

/** The read tool's signature. `fromInput` lets notes tell the model how to continue. */
export interface ReadSignature<TModel extends JsonObject = JsonObject> extends ToolSignature<
  ReadInput,
  ReadParam
> {
  /** Maps a canonical retry to the object the model sends next. */
  fromInput(retry: ReadInput): TModel;
}

/** The canonical read parameters, and the parameter names of `defaultReadSignature`. */
export type ReadParam = "path" | "offset" | "limit";
/** The parameter names of `lineRangeSignature`. */
export type LineRangeParam = "path" | "start" | "end";

/** The model input of `defaultReadSignature`. */
// A type alias, not an interface, so it fits the JsonObject index signature.
export type DefaultReadModelInput = {
  readonly path: string;
  readonly offset?: number;
  readonly limit?: number;
};
