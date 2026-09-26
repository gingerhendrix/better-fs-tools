import type { CallScope } from "./call-scope.ts";
import { extensionId } from "./extension-error.ts";

/** The view budget as the scanner sees it: a checked measure. */
export interface ScanBudget {
  readonly max: number;
  /** Throws ReadStop with EXTENSION_FAILED when the host measure throws or gives a bad cost. */
  measure(text: string): number;
}

/**
 * Wraps `deps.budget` for the scanner. measure is host code, so a throw, or a
 * cost that is not a finite number of at least 0, gives EXTENSION_FAILED with
 * extension "budget" in the current phase. null when there is no budget.
 */
export function scanBudget<THost>(scope: CallScope<THost>): ScanBudget | null {
  const { budget } = scope.deps;
  if (budget === null) return null;
  return {
    max: budget.max,
    measure(text) {
      let cost: unknown;
      try {
        cost = budget.measure(text);
      } catch (error) {
        throw scope.extensionFailure("budget", extensionId(budget, error));
      }
      if (typeof cost !== "number" || !Number.isFinite(cost) || cost < 0) {
        throw scope.extensionFailure("budget", extensionId(budget));
      }
      return cost;
    },
  };
}
