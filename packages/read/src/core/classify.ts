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
