import type {
  Classification,
  ClassificationSample,
  Classifier,
  UnsupportedClassification,
} from "../contract/classify.ts";
import type { ClassificationInfo } from "../contract/result.ts";

export interface Decision<T> {
  readonly classifier: string;
  readonly classification: T;
}

/** The first classifier with an opinion wins. null when none has one. */
export function classifySample(
  classifiers: readonly Classifier[],
  sample: ClassificationSample,
): Decision<Classification> | null {
  for (const candidate of classifiers) {
    const classification = candidate.classify(sample);
    if (classification !== null) return { classifier: candidate.id, classification };
  }
  return null;
}

/**
 * The refusal for invalid UTF-8 found after the sample was accepted as text.
 * Asks the chain for the first encodingFailure opinion. Never re-runs classify.
 */
export function encodingRefusal(
  classifiers: readonly Classifier[],
  sample: ClassificationSample,
): Decision<UnsupportedClassification> | null {
  for (const candidate of classifiers) {
    const classification = candidate.encodingFailure?.(sample) ?? null;
    if (classification !== null) return { classifier: candidate.id, classification };
  }
  return null;
}

/** The result's view of a classifier decision. `code` is null for text. */
export function classificationInfo(decision: Decision<Classification>): ClassificationInfo {
  const { classifier, classification } = decision;
  return {
    kind: classification.kind,
    classifier,
    code: classification.kind === "unsupported" ? classification.code : null,
    mimeType: classification.mimeType,
    confidence: classification.confidence,
    reasons: classification.reasons,
  };
}
