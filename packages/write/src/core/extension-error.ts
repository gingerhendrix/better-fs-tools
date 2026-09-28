/**
 * Thrown by a composite (writeAuthorizers) when one of its steps throws, so
 * EXTENSION_FAILED can name the step. Internal: not exported.
 */
export class ExtensionStepError extends Error {
  constructor(
    readonly id: string,
    cause: unknown,
  ) {
    super(`extension step ${id} failed`, { cause });
  }
}

/** Wraps a step's throw once. An inner composite's error keeps the innermost step id. */
export function stepFailure(step: { readonly id: string }, error: unknown): ExtensionStepError {
  return error instanceof ExtensionStepError ? error : new ExtensionStepError(step.id, error);
}

/**
 * The id EXTENSION_FAILED reports: the failing step's id when a composite
 * threw, else the extension's own id. null when neither is a string.
 */
export function extensionId(extension: unknown, error?: unknown): string | null {
  if (error instanceof ExtensionStepError) return error.id;
  if (extension === null || typeof extension !== "object" || !("id" in extension)) return null;
  return typeof extension.id === "string" ? extension.id : null;
}
