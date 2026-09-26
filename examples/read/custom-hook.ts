import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ReadHook } from "@better-fs-tools/read";

// Host code: it reads AGENTS.md with the host's own permissions.
export const agentsNote: ReadHook<unknown> = {
  id: "agents-note",
  async afterRead(outcome) {
    if (outcome.status !== "ok") return outcome;
    const path = join(dirname(outcome.file.resolvedPath), "AGENTS.md");
    const text = await readFile(path, "utf8").catch(() => null);
    if (text === null) return outcome;
    const note = { code: "agents-md", severity: "info" as const, message: text.slice(0, 4_000) };
    return { ...outcome, notes: [...outcome.notes, note] };
  },
};
