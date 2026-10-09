import type { Guard } from "../contract/extensions.ts";
import { nonTextGuard } from "./non-text.ts";
import { omissionGuard } from "./omission.ts";
import { readPrefixGuard } from "./read-prefix.ts";
import { syntaxGuard } from "./syntax.ts";
import { truncationNoticeGuard } from "./truncation-notice.ts";

export { generatedFileGuard } from "./generated-file.ts";
export { nonTextGuard } from "./non-text.ts";
export { omissionGuard } from "./omission.ts";
export { readPrefixGuard } from "./read-prefix.ts";
export { syntaxGuard } from "./syntax.ts";
export { truncationNoticeGuard } from "./truncation-notice.ts";

/**
 * The guards every write tool runs by default: none. Pass guards, for
 * example recommendedGuards(), to turn them on.
 */
export function defaultGuards(): readonly Guard<unknown>[] {
  return Object.freeze([]);
}

/**
 * The guards this package recommends, in order: read prefix, truncation
 * notice, omission, syntax (JSON), and non-text. Each can refuse a write.
 * They are off unless a host passes them as `guards`. generatedFileGuard is
 * not in the list.
 */
export function recommendedGuards(): readonly Guard<unknown>[] {
  return Object.freeze([
    readPrefixGuard(),
    truncationNoticeGuard(),
    omissionGuard(),
    syntaxGuard(),
    nonTextGuard(),
  ]);
}
