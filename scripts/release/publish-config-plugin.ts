import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { TegamiPlugin } from "tegami";
import { NpmPackage } from "tegami/providers/npm";

import { formatManifest, publishManifest } from "./publish-manifest.ts";

/**
 * Applies `publishConfig` to each package.json for the length of its publish.
 *
 * Tegami packs with `bun pm pack`, which ignores `publishConfig.exports` and `publishConfig.pi`.
 * Without this plugin the tarball would export `./src/*.ts`, which `files` leaves out.
 * `afterPublish` restores the file. It does not run when Tegami skips a version that npm
 * already has, so `afterPublishAll` restores any file that is still swapped.
 */
export function applyPublishConfig(): TegamiPlugin {
  const originals = new Map<string, string>();

  async function restore(path: string): Promise<void> {
    const original = originals.get(path);
    if (original === undefined) return;
    await writeFile(path, original);
    originals.delete(path);
  }

  return {
    name: "better-fs-tools-publish-config",
    async willPublish({ pkg }) {
      if (!(pkg instanceof NpmPackage)) return;
      const path = join(pkg.path, "package.json");
      if (originals.has(path)) return;
      const original = await readFile(path, "utf8");
      originals.set(path, original);
      await writeFile(path, formatManifest(publishManifest(JSON.parse(original))));
    },
    async afterPublish({ pkg }) {
      if (pkg instanceof NpmPackage) await restore(join(pkg.path, "package.json"));
    },
    async afterPublishAll() {
      for (const path of originals.keys()) await restore(path);
    },
  };
}
