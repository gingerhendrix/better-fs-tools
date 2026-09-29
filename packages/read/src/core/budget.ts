import type { CallScope } from "./call-scope.ts";
import { extensionId } from "./extension-error.ts";

export interface ScanBudget {
  readonly max: number;
  measure(text: string): number;
}

/** The host view budget, with a throwing or invalid measure failing the read as EXTENSION_FAILED. */
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
