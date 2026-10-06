/** publishConfig keys that configure the registry call, not the manifest. */
const REGISTRY_KEYS = new Set(["access", "tag", "registry"]);

/**
 * Returns the manifest as published: every `publishConfig` key except the registry keys
 * replaces the field of the same name. Bun does not apply these overrides when it packs,
 * so `check:packages` and the Tegami release both write this manifest for the pack.
 */
export function publishManifest(manifest: Record<string, unknown>): Record<string, unknown> {
  const overrides = Object.entries(
    (manifest.publishConfig ?? {}) as Record<string, unknown>,
  ).filter(([key]) => !REGISTRY_KEYS.has(key));
  return { ...manifest, ...Object.fromEntries(overrides) };
}

/** Serializes a manifest the way the workspace package.json files are formatted. */
export function formatManifest(manifest: Record<string, unknown>): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}
