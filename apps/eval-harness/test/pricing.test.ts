import { describe, expect, test } from "bun:test";

import { emptyMetrics } from "../src/metrics.ts";
import { COMMAND_CODE_RATE_CARD, runCostUsd } from "../src/pricing.ts";
import { summarise } from "../src/report.ts";
import type { CellResult } from "../src/run.ts";

function metrics(input: number, cached: number, output: number) {
  return { ...emptyMetrics(), inputTokens: input, cachedInputTokens: cached, outputTokens: output };
}

describe("runCostUsd", () => {
  test("prices uncached input, cached input, and output at their own rates", () => {
    // Nemotron 3 Ultra: input 0.60, cache read 0.12, output 2.40 per million.
    const usd = runCostUsd(
      "nvidia/nemotron-3-ultra-550b-a55b",
      metrics(1_000_000, 250_000, 100_000),
    );
    expect(usd).toBeCloseTo(0.75 * 0.6 + 0.25 * 0.12 + 0.1 * 2.4, 10);
  });

  test("returns null for a model with no rate, and never guesses an id", () => {
    expect(runCostUsd("mimo-v2.6-flash", metrics(10, 0, 10))).toBeNull();
    expect(runCostUsd("unknown/model", metrics(10, 0, 10))).toBeNull();
  });

  test("covers both default models", () => {
    expect(COMMAND_CODE_RATE_CARD.rates["xiaomi/mimo-v2.6-flash"]).toBeDefined();
    expect(COMMAND_CODE_RATE_CARD.rates["nvidia/nemotron-3-ultra-550b-a55b"]).toBeDefined();
  });
});

describe("summarise", () => {
  const cell = (model: string, passed: boolean, m = metrics(1_000_000, 0, 0)): CellResult => ({
    model,
    arm: "edit",
    task: "t",
    attempt: 1,
    difficulty: null,
    mutationType: null,
    passed,
    verifyError: null,
    linesChanged: 0,
    end: "done",
    loopError: null,
    providerHttpErrors: 0,
    wallMs: 0,
    metrics: m,
  });

  test("sums cost over the group", () => {
    const [s] = summarise([
      cell("xiaomi/mimo-v2.6-flash", true),
      cell("xiaomi/mimo-v2.6-flash", false),
    ]);
    expect(s!.totalCostUsd).toBeCloseTo(0.28, 10);
  });

  test("gives null total cost when the model has no rate", () => {
    const [s] = summarise([cell("unknown/model", true)]);
    expect(s!.totalCostUsd).toBeNull();
  });
});
