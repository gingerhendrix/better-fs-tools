export type LockOutcome =
  | { readonly ok: true; release(): void }
  | { readonly ok: false; readonly reason: "timeout" | "aborted" };

export interface LockManager {
  readonly id: string;
  /** Takes every key or none. Keys arrive sorted and without duplicates. */
  acquire(
    keys: readonly string[],
    options: { readonly signal?: AbortSignal },
  ): Promise<LockOutcome>;
}
