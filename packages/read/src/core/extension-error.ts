/** Lets EXTENSION_FAILED name the failing step of a composite extension. */
export class ExtensionStepError extends Error {
  constructor(
    readonly id: string,
    cause: unknown,
  ) {
    super(`extension step ${id} failed`, { cause });
  }
}

export function stepFailure(step: { readonly id: string }, error: unknown): ExtensionStepError {
  return error instanceof ExtensionStepError ? error : new ExtensionStepError(step.id, error);
}

export function extensionId(extension: unknown, error?: unknown): string | null {
  if (error instanceof ExtensionStepError) return error.id;
  if (extension === null || typeof extension !== "object" || !("id" in extension)) return null;
  return typeof extension.id === "string" ? extension.id : null;
}
