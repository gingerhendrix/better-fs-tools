import type { ConverterMatch, FileConverter, ReadHookContext } from "../contract/extensions.ts";

export interface TextConverterOptions<THost = unknown> {
  id: string;
  /** Sync. The only place the converter may decline. */
  accepts: (match: ConverterMatch) => boolean;
  /** Media type of the text. */
  mimeType: string | null;
  /** Turns the source bytes into text. The text may arrive in chunks. */
  run: (source: AsyncIterable<Uint8Array>, ctx: ReadHookContext<THost>) => AsyncIterable<string>;
}

/** Builds a text converter from a stream function, for example a pdftotext process in the host. */
export function textConverter<THost = unknown>(
  options: TextConverterOptions<THost>,
): FileConverter<THost> {
  if (options === null || typeof options !== "object") {
    throw new TypeError("textConverter options must be an object");
  }
  const { id, accepts, mimeType, run } = options;
  if (typeof id !== "string" || id === "") throw new TypeError("textConverter id must be a string");
  if (typeof accepts !== "function")
    throw new TypeError("textConverter accepts must be a function");
  if (typeof run !== "function") throw new TypeError("textConverter run must be a function");
  if (mimeType !== null && typeof mimeType !== "string") {
    throw new TypeError("textConverter mimeType must be a string or null");
  }
  return Object.freeze<FileConverter<THost>>({
    id,
    target: "file",
    accepts: (match) => accepts(match),
    async convert(input, ctx) {
      return { kind: "text", text: run(input.bytes(), ctx), mimeType };
    },
  });
}
