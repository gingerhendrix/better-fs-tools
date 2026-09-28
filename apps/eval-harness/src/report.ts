import { totalErrors } from "./metrics.ts";
import type { CellResult } from "./run.ts";

export interface GroupSummary {
  readonly model: string;
  readonly arm: string;
  readonly runs: number;
  readonly passed: number;
  readonly providerErrors: number;
  readonly providerHttpErrors: number;
  readonly maxSteps: number;
  readonly meanSteps: number;
  readonly toolErrorsPerRun: number;
  readonly runsWithToolError: number;
  readonly meanInputTokens: number;
  readonly meanOutputTokens: number;
  readonly meanToolInputChars: number;
  readonly meanWallMs: number;
  readonly errorCodes: Record<string, number>;
}

export function summarise(results: readonly CellResult[]): GroupSummary[] {
  const groups = new Map<string, CellResult[]>();
  for (const r of results) {
    const key = `${r.model}\u0000${r.arm}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  return [...groups.values()]
    .map((rs) => {
      const n = rs.length;
      const mean = (f: (r: CellResult) => number) => rs.reduce((a, r) => a + f(r), 0) / n;
      const errorCodes: Record<string, number> = {};
      for (const r of rs) {
        for (const [code, count] of Object.entries(r.metrics.toolErrors)) {
          errorCodes[code] = (errorCodes[code] ?? 0) + count;
        }
      }
      return {
        model: rs[0]!.model,
        arm: rs[0]!.arm,
        runs: n,
        passed: rs.filter((r) => r.passed).length,
        providerErrors: rs.filter((r) => r.end === "error").length,
        providerHttpErrors: rs.reduce((a, r) => a + (r.providerHttpErrors ?? 0), 0),
        maxSteps: rs.filter((r) => r.end === "max-steps").length,
        meanSteps: mean((r) => r.metrics.steps),
        toolErrorsPerRun: mean((r) => totalErrors(r.metrics)),
        runsWithToolError: rs.filter((r) => totalErrors(r.metrics) > 0).length,
        meanInputTokens: mean((r) => r.metrics.inputTokens),
        meanOutputTokens: mean((r) => r.metrics.outputTokens),
        meanToolInputChars: mean((r) => r.metrics.toolInputChars),
        meanWallMs: mean((r) => r.wallMs),
        errorCodes,
      };
    })
    .sort((a, b) => a.model.localeCompare(b.model) || a.arm.localeCompare(b.arm));
}

export function markdownReport(results: readonly CellResult[]): string {
  const rows = summarise(results);
  const lines = [
    "| Model | Arm | Runs | Pass | Provider err (HTTP) | Max steps | Steps | Tool err / run | Runs with tool err | Input tok | Output tok | Tool input chars | Wall s |",
    "|---|---|---|---|---|---|---|---|---|---|---|---|---|",
    ...rows
      .map((s) =>
        [
          s.model,
          s.arm,
          s.runs,
          `${s.passed} (${pct(s.passed, s.runs)})`,
          `${s.providerErrors} (${s.providerHttpErrors})`,
          s.maxSteps,
          s.meanSteps.toFixed(1),
          s.toolErrorsPerRun.toFixed(2),
          s.runsWithToolError,
          Math.round(s.meanInputTokens),
          Math.round(s.meanOutputTokens),
          Math.round(s.meanToolInputChars),
          (s.meanWallMs / 1000).toFixed(1),
        ].join(" | "),
      )
      .map((row) => `| ${row} |`),
    "",
    "Tool error codes:",
    "",
    ...rows.map(
      (s) =>
        `- ${s.model} / ${s.arm}: ${
          Object.entries(s.errorCodes)
            .sort((a, b) => b[1] - a[1])
            .map(([code, count]) => `${code} ${count}`)
            .join(", ") || "none"
        }`,
    ),
  ];
  return `${lines.join("\n")}\n`;
}

function pct(a: number, b: number): string {
  return b === 0 ? "-" : `${Math.round((100 * a) / b)}%`;
}
