import type { Guard } from "../contract/extensions.ts";
import { isRecord } from "../core/input.ts";
import { ALLOW, extensionOf, newTextParam, refuse } from "./shared.ts";

type Parser = (text: string) => void;

const DEFAULT_PARSERS: Readonly<Record<string, Parser>> = Object.freeze({
  json: (text: string) => {
    JSON.parse(text);
  },
});

/**
 * Refuses an update that breaks a file's syntax (Hermes: new errors only).
 * The parser is picked by extension. It must throw on bad text. `.json`
 * uses JSON.parse by default. Host parsers, for example for `.yaml` or
 * `.toml`, join the default and may replace it. Keys are extensions with or
 * without the dot. Only an update whose before text parsed is checked: a
 * file that was already broken, and every create, pass. A JSONC file such
 * as `tsconfig.json` can therefore be created, and edited once it has
 * comments.
 */
export function syntaxGuard(
  options: { readonly parsers?: Readonly<Record<string, (text: string) => void>> } = {},
): Guard<unknown> {
  const parsers = new Map<string, Parser>(Object.entries(DEFAULT_PARSERS));
  if (options.parsers !== undefined) {
    if (!isRecord(options.parsers)) throw new TypeError("parsers must be an object");
    for (const [key, parser] of Object.entries(options.parsers)) {
      if (typeof parser !== "function") throw new TypeError(`parser ${key} must be a function`);
      parsers.set(key.replace(/^\./u, "").toLowerCase(), parser);
    }
  }
  return Object.freeze<Guard<unknown>>({
    id: "syntax",
    check(change, ctx) {
      if (change.before === null || change.after === null) return ALLOW;
      const extension = extensionOf(change.resolvedPath);
      const parser = extension === null ? undefined : parsers.get(extension);
      if (extension === null || parser === undefined) return ALLOW;
      if (parseError(parser, change.before.text) !== null) return ALLOW;
      const error = parseError(parser, change.after.text);
      if (error === null) return ALLOW;
      const language = extension.toUpperCase();
      return refuse(
        "syntax",
        `The change would make ${change.displayPath} invalid ${language}, and it was valid before. Fix the ${newTextParam(change, ctx)} and retry. The parser said: ${error}`,
        { language, detail: error },
      );
    },
  });
}

/** The parser's message, cut at 200 characters, or null when the text parsed. */
function parseError(parser: Parser, text: string): string | null {
  try {
    parser(text);
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const line = message.split("\n")[0] ?? "";
    return line.length > 200 ? `${line.slice(0, 200)}…` : line || "parse error";
  }
}
