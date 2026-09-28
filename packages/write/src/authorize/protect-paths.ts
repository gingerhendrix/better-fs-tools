import { compileGlob } from "@better-fs-tools/read";

import type {
  WriteAuthorizeDecision,
  WriteAuthorizer,
  WriteAuthorizeTarget,
  WriteHookContext,
} from "../contract/extensions.ts";

const DEFAULT_PATTERNS: readonly string[] = ["**/AGENTS.md", "**/CLAUDE.md", "**/.git/**"];

const ALLOW: WriteAuthorizeDecision = Object.freeze({ allow: true });

/**
 * Guards agent instruction files and the git folder (Hermes), even when
 * every other change is approved. Globs ("**", "*", "?") match
 * `resolvedPath`, and the source of a move. The access stage checks each
 * target before any content byte is read, and the change stage checks
 * again. Without `ask`, a protected path is denied. With `ask`, the
 * authorizer asks once for each protected path in a call and keeps the
 * answer for both stages. `true` allows. `false`, a throw, or anything else
 * denies.
 */
export function protectPaths<THost = unknown>(
  options: {
    readonly patterns?: readonly string[];
    readonly ask?: (target: WriteAuthorizeTarget, ctx: WriteHookContext<THost>) => Promise<boolean>;
  } = {},
): WriteAuthorizer<THost> {
  const { patterns = DEFAULT_PATTERNS, ask } = options;
  if (
    !Array.isArray(patterns) ||
    !patterns.every((pattern) => typeof pattern === "string" && pattern !== "")
  ) {
    throw new TypeError("patterns must be an array of non-empty glob strings");
  }
  if (ask !== undefined && typeof ask !== "function") throw new TypeError("ask must be a function");
  const compiled = patterns.map((pattern) => ({ pattern, test: compileGlob(pattern) }));
  const answers = new WeakMap<object, Map<string, Promise<boolean>>>();

  const answer = (path: string, target: WriteAuthorizeTarget, ctx: WriteHookContext<THost>) => {
    let byPath = answers.get(ctx.call);
    if (byPath === undefined) {
      byPath = new Map();
      answers.set(ctx.call, byPath);
    }
    let pending = byPath.get(path);
    if (pending === undefined) {
      pending = asked(ask, target, ctx);
      byPath.set(path, pending);
    }
    return pending;
  };

  return Object.freeze({
    id: "protect-paths",
    async authorize(target, ctx) {
      const paths = [target.resolvedPath];
      if (target.change?.movedFrom != null) paths.push(target.change.movedFrom);
      for (const path of paths) {
        const hit = compiled.find((entry) => entry.test(path));
        if (hit === undefined) continue;
        if (ask !== undefined && (await answer(path, target, ctx))) continue;
        return {
          allow: false,
          note: {
            code: "denied",
            severity: "warning",
            message: ctx.messages.denied({
              path: target.requestedPath,
              detail:
                ask === undefined
                  ? "the path is protected"
                  : "the path is protected and the user did not approve the change",
            }),
            data: { pattern: hit.pattern },
          },
        };
      }
      return ALLOW;
    },
  } satisfies WriteAuthorizer<THost>);
}

async function asked<THost>(
  ask:
    | ((target: WriteAuthorizeTarget, ctx: WriteHookContext<THost>) => Promise<boolean>)
    | undefined,
  target: WriteAuthorizeTarget,
  ctx: WriteHookContext<THost>,
): Promise<boolean> {
  if (ask === undefined) return false;
  try {
    return (await ask(target, ctx)) === true;
  } catch {
    return false;
  }
}
