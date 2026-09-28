import { cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { Arm } from "./arms.ts";
import { runLoop } from "./loop.ts";
import type { EndState } from "./loop.ts";
import type { RunMetrics } from "./metrics.ts";
import { systemPrompt } from "./prompts.ts";
import { commandCodeModel } from "./provider.ts";
import type { EditTask } from "./tasks.ts";
import { verifyWorkspace } from "./verify.ts";

export interface Cell {
  readonly model: string;
  readonly arm: Arm;
  readonly task: EditTask;
  readonly attempt: number;
}

export interface CellResult {
  readonly model: string;
  readonly arm: string;
  readonly task: string;
  readonly attempt: number;
  readonly difficulty: string | null;
  readonly mutationType: string | null;
  readonly passed: boolean;
  readonly verifyError: string | null;
  readonly linesChanged: number;
  readonly end: EndState;
  readonly loopError: string | null;
  /** Non-200 HTTP responses. AI SDK retried them; they add wall time but no tokens. */
  readonly providerHttpErrors: number;
  readonly wallMs: number;
  readonly metrics: RunMetrics;
}

export interface RunOptions {
  readonly outDir: string;
  readonly maxSteps: number;
  readonly stepTimeoutMs: number;
  readonly earlyStop: boolean;
  readonly keepWorkspace: boolean;
}

export function cellDir(outDir: string, cell: Cell): string {
  const model = cell.model.replace(/[^a-zA-Z0-9._-]/g, "_");
  return join(outDir, "runs", model, cell.arm.name, cell.task.id, `a${cell.attempt}`);
}

/** Returns the saved result when the cell already ran, so a matrix can resume. */
export async function readCellResult(dir: string): Promise<CellResult | null> {
  const file = join(dir, "result.json");
  if (!(await stat(file).catch(() => null))) return null;
  return JSON.parse(await readFile(file, "utf8")) as CellResult;
}

/**
 * Runs one (model, arm, task, attempt) cell: copy the fixture input to a
 * fresh workspace, run the loop with the arm's tools, verify the workspace
 * against `expected/`, and write `result.json`.
 */
export async function runCell(cell: Cell, options: RunOptions): Promise<CellResult> {
  const dir = cellDir(options.outDir, cell);
  await rm(dir, { recursive: true, force: true });
  const workspace = join(dir, "workspace");
  await mkdir(dir, { recursive: true });
  await cp(cell.task.inputDir, workspace, { recursive: true });

  const started = Date.now();
  const verify = () => verifyWorkspace(cell.task.expectedDir, workspace);
  const loop = await runLoop({
    model: commandCodeModel(cell.model, join(dir, "http.jsonl")),
    system: systemPrompt(cell.arm.editTool),
    prompt: cell.task.prompt,
    tools: cell.arm.tools(workspace),
    maxSteps: options.maxSteps,
    stepTimeoutMs: options.stepTimeoutMs,
    stepLog: join(dir, "steps.jsonl"),
    ...(options.earlyStop ? { isSolved: async () => (await verify()).passed } : {}),
  });
  const wallMs = Date.now() - started;
  const verification = await verify();

  const result: CellResult = {
    model: cell.model,
    arm: cell.arm.name,
    task: cell.task.id,
    attempt: cell.attempt,
    difficulty: cell.task.difficulty,
    mutationType: cell.task.mutationType,
    passed: verification.passed,
    verifyError: verification.error,
    linesChanged: verification.linesChanged,
    end: loop.end,
    loopError: loop.error,
    providerHttpErrors: await countHttpErrors(join(dir, "http.jsonl")),
    wallMs,
    metrics: loop.metrics,
  };
  await writeFile(join(dir, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
  if (!options.keepWorkspace) await rm(workspace, { recursive: true, force: true });
  return result;
}

async function countHttpErrors(file: string): Promise<number> {
  const text = await readFile(file, "utf8").catch(() => "");
  return text
    .split("\n")
    .filter((line) => line !== "")
    .filter((line) => (JSON.parse(line) as { status: number }).status !== 200).length;
}

/**
 * Runs cells with a fixed number of workers. A cell with a saved result is
 * skipped, unless the saved run ended in a provider error.
 */
export async function runMatrix(
  cells: readonly Cell[],
  options: RunOptions & { readonly concurrency: number },
  onResult: (result: CellResult, skipped: boolean) => void,
): Promise<CellResult[]> {
  const results: CellResult[] = [];
  let next = 0;
  const worker = async () => {
    while (next < cells.length) {
      const cell = cells[next++]!;
      const found = await readCellResult(cellDir(options.outDir, cell));
      const saved = found !== null && found.end !== "error" ? found : null;
      const result = saved ?? (await runCell(cell, options));
      results.push(result);
      onResult(result, saved !== null);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, options.concurrency) }, worker));
  return results;
}
