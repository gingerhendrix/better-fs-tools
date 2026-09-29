import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** publishConfig keys that configure the registry call, not the manifest. */
const REGISTRY_KEYS = new Set(["access", "tag", "registry"]);

/**
 * Returns the tarball path. `bun pm pack` does not apply `publishConfig` overrides,
 * so they are written to package.json for the pack and the original is restored after.
 */
export async function packPackage(directory: string, destination: string): Promise<string> {
  const path = join(directory, "package.json");
  const original = await readFile(path, "utf8");
  const manifest = JSON.parse(original) as Record<string, unknown>;
  const overrides = Object.entries(
    (manifest.publishConfig ?? {}) as Record<string, unknown>,
  ).filter(([key]) => !REGISTRY_KEYS.has(key));
  await writeFile(
    path,
    `${JSON.stringify({ ...manifest, ...Object.fromEntries(overrides) }, null, 2)}\n`,
  );
  try {
    const packed = spawnSync(
      "bun",
      ["pm", "pack", "--destination", destination, "--ignore-scripts", "--quiet"],
      { cwd: directory, encoding: "utf8" },
    );
    if (packed.status !== 0) {
      throw new Error(`bun pm pack failed in ${directory}: ${packed.stderr.trim()}`);
    }
    const tarball = packed.stdout.trim().split("\n").at(-1);
    if (tarball === undefined || !tarball.endsWith(".tgz")) {
      throw new Error(`bun pm pack printed no tarball in ${directory}: ${packed.stdout}`);
    }
    return tarball;
  } finally {
    await writeFile(path, original);
  }
}
