import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { formatManifest, publishManifest } from "../release/publish-manifest.ts";

/**
 * Returns the tarball path. `bun pm pack` does not apply `publishConfig` overrides,
 * so they are written to package.json for the pack and the original is restored after.
 */
export async function packPackage(directory: string, destination: string): Promise<string> {
  const path = join(directory, "package.json");
  const original = await readFile(path, "utf8");
  await writeFile(path, formatManifest(publishManifest(JSON.parse(original))));
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
