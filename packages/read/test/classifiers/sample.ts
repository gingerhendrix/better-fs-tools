import type { ClassificationSample } from "../../src/index.ts";

/** A complete sample with a neutral path, for classifier unit tests. */
export function sample(
  bytes: Uint8Array | string,
  overrides: Partial<ClassificationSample> = {},
): ClassificationSample {
  return {
    bytes: typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes,
    complete: true,
    path: "sample.bin",
    mimeType: null,
    ...overrides,
  };
}
