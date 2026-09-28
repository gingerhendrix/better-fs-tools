import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

/**
 * One Oh My Pi `typescript-edit-benchmark` fixture: `prompt.md`, `input/`,
 * `expected/`, and `metadata.json`.
 */
export interface EditTask {
  readonly id: string;
  readonly prompt: string;
  readonly inputDir: string;
  readonly expectedDir: string;
  readonly files: readonly string[];
  readonly difficulty: string | null;
  readonly mutationType: string | null;
  readonly fileLines: number | null;
}

export async function listFiles(root: string, dir = root): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await listFiles(root, full)));
    else if (entry.isFile()) out.push(relative(root, full));
  }
  return out.sort();
}

export async function loadTask(fixturesDir: string, id: string): Promise<EditTask> {
  const dir = join(fixturesDir, id);
  const prompt = (await readFile(join(dir, "prompt.md"), "utf8")).trim();
  const meta = JSON.parse(await readFile(join(dir, "metadata.json"), "utf8")) as {
    difficulty?: string;
    mutation_type?: string;
    context?: { file_lines?: number };
  };
  const inputDir = join(dir, "input");
  return {
    id,
    prompt,
    inputDir,
    expectedDir: join(dir, "expected"),
    files: await listFiles(inputDir),
    difficulty: meta.difficulty ?? null,
    mutationType: meta.mutation_type ?? null,
    fileLines: meta.context?.file_lines ?? null,
  };
}

/** Loads every fixture, or the named ones in the given order. */
export async function loadTasks(fixturesDir: string, ids?: readonly string[]): Promise<EditTask[]> {
  const names =
    ids ??
    (await readdir(fixturesDir, { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
  return Promise.all(names.map((id) => loadTask(fixturesDir, id)));
}
