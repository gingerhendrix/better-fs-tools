type EnvRecord = Readonly<Record<string, string | undefined>>;

/**
 * Variables shellEnv sets over the base, so a command does not wait on a
 * pager or a prompt and does not print colour codes.
 */
export const defaultShellEnv: Readonly<Record<string, string>> = Object.freeze({
  PAGER: "cat",
  GIT_PAGER: "cat",
  GIT_TERMINAL_PROMPT: "0",
  NO_COLOR: "1",
  TERM: "dumb",
});

/**
 * An env dependency for any host: `base` with defaultShellEnv over it.
 * Entries whose value is undefined are left out. A function base is read
 * again on each call, so `shellEnv(() => process.env)` follows changes to
 * process.env.
 */
export function shellEnv(
  base: EnvRecord | (() => EnvRecord) = {},
): () => Readonly<Record<string, string>> {
  if (typeof base === "function") return () => merge(base());
  const fixed = merge(base);
  return () => fixed;
}

function merge(base: EnvRecord): Readonly<Record<string, string>> {
  const merged: Record<string, string> = {};
  for (const [key, value] of Object.entries(base)) {
    if (typeof value === "string") merged[key] = value;
  }
  Object.assign(merged, defaultShellEnv);
  return Object.freeze(merged);
}
