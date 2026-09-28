#!/usr/bin/env bun
/**
 * bun run eval run    --fixtures <dir> --out <dir> [--models a,b] [--arms edit,patch] [--suite poc-12 | --tasks id,id] [--attempts 1] [--concurrency 4] [--max-steps 20]
 * bun run eval report --out <dir>
 * bun run eval list
 */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";

import { ARMS, findArm } from "./arms.ts";
import { markdownReport } from "./report.ts";
import { runMatrix } from "./run.ts";
import type { Cell, CellResult } from "./run.ts";
import { SUITES } from "./suites.ts";
import { loadTasks } from "./tasks.ts";
import { totalErrors } from "./metrics.ts";
import { runCostUsd } from "./pricing.ts";

const DEFAULT_MODELS = ["xiaomi/mimo-v2.6-flash", "nvidia/nemotron-3-ultra-550b-a55b"];

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    fixtures: { type: "string", default: process.env.OMP_EDIT_FIXTURES },
    out: { type: "string" },
    models: { type: "string", default: DEFAULT_MODELS.join(",") },
    arms: { type: "string", default: "edit,patch" },
    suite: { type: "string", default: "poc-12" },
    tasks: { type: "string" },
    attempts: { type: "string", default: "1" },
    concurrency: { type: "string", default: "4" },
    "max-steps": { type: "string", default: "20" },
    "step-timeout": { type: "string", default: "600" },
    "no-early-stop": { type: "boolean", default: false },
    "keep-workspace": { type: "boolean", default: false },
  },
});

const command = positionals[0] ?? "run";

if (command === "list") {
  for (const arm of ARMS) console.log(`arm   ${arm.name.padEnd(12)} ${arm.description}`);
  for (const [name, ids] of Object.entries(SUITES))
    console.log(`suite ${name.padEnd(12)} ${ids.length} tasks`);
  process.exit(0);
}

const outDir = required(values.out, "--out");

if (command === "report") {
  const results = await collectResults(outDir);
  const report = markdownReport(results);
  await writeFile(join(outDir, "report.md"), report);
  console.log(report);
  process.exit(0);
}

if (command !== "run") throw new Error(`unknown command "${command}"`);

const fixtures = required(values.fixtures, "--fixtures (or OMP_EDIT_FIXTURES)");
const taskIds = values.tasks?.split(",") ?? SUITES[values.suite!];
if (taskIds === undefined) throw new Error(`unknown suite "${values.suite}"`);
const tasks = await loadTasks(fixtures, taskIds);
const arms = values.arms!.split(",").map(findArm);
const models = values.models!.split(",");
const attempts = Number(values.attempts);

const cells: Cell[] = [];
for (let attempt = 1; attempt <= attempts; attempt++) {
  for (const task of tasks) {
    for (const model of models) for (const arm of arms) cells.push({ model, arm, task, attempt });
  }
}

await mkdir(outDir, { recursive: true });
await writeFile(
  join(outDir, "manifest.json"),
  `${JSON.stringify({ created: new Date().toISOString(), fixtures, models, arms: arms.map((a) => a.name), tasks: taskIds, attempts, maxSteps: Number(values["max-steps"]), earlyStop: !values["no-early-stop"] }, null, 2)}\n`,
);
console.log(
  `${cells.length} cells: ${models.length} models x ${arms.length} arms x ${tasks.length} tasks x ${attempts} attempts`,
);

let done = 0;
const results = await runMatrix(
  cells,
  {
    outDir,
    maxSteps: Number(values["max-steps"]),
    stepTimeoutMs: Number(values["step-timeout"]) * 1000,
    earlyStop: !values["no-early-stop"],
    keepWorkspace: values["keep-workspace"]!,
    concurrency: Number(values.concurrency),
  },
  (r, skipped) => {
    done++;
    const mark = r.passed ? "PASS" : "FAIL";
    console.log(
      `[${done}/${cells.length}] ${mark} ${r.model} ${r.arm} ${r.task} a${r.attempt} end=${r.end} steps=${r.metrics.steps} toolErr=${totalErrors(r.metrics)} in=${r.metrics.inputTokens} out=${r.metrics.outputTokens} usd=${runCostUsd(r.model, r.metrics)?.toFixed(4) ?? "-"}${skipped ? " (saved)" : ""}${r.loopError ? ` err=${r.loopError.slice(0, 120)}` : ""}`,
    );
  },
);
const report = markdownReport(results);
await writeFile(join(outDir, "report.md"), report);
console.log(`\n${report}`);

function required(value: string | undefined, flag: string): string {
  if (value === undefined || value === "") throw new Error(`missing ${flag}`);
  return value;
}

async function collectResults(dir: string): Promise<CellResult[]> {
  const found: CellResult[] = [];
  const walk = async (d: string): Promise<void> => {
    for (const e of await readdir(d, { withFileTypes: true }).catch(() => [])) {
      const p = join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.name === "result.json")
        found.push(JSON.parse(await readFile(p, "utf8")) as CellResult);
    }
  };
  await walk(join(dir, "runs"));
  return found;
}
