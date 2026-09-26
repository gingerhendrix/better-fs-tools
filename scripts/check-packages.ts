/**
 * Release-shape check for every package in packages/.
 *
 * 1. Builds dist/ with `bun run build:packages`.
 * 2. Packs each package with `bun pm pack`, applying publishConfig.
 * 3. Checks each tarball: manifest rules from plan section 3, exact files,
 *    export and pi.extensions paths, rewritten ranges, and every import.
 * 4. Installs the tarballs into a throwaway consumer, imports and reads under
 *    Node, and type-checks the published declarations.
 *
 * Usage: bun run check:packages [--out <dir>]. With --out, the tarballs and
 * the consumer stay in <dir>. Without it they go to a temporary folder that is
 * removed at the end.
 */
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

import { prepareConsumer, runNodeConsumer, runTypeConsumers } from "./package-check/consumer.ts";
import { checkFiles, checkImports } from "./package-check/files.ts";
import { packPackage } from "./package-check/pack.ts";
import { RULES, SCOPE, checkManifest } from "./package-check/rules.ts";
import type { Manifest } from "./package-check/rules.ts";

const repository = resolve(import.meta.dir, "..");
const { values } = parseArgs({ options: { out: { type: "string" } } });
const work =
  values.out === undefined ? await mkdtemp(join(tmpdir(), "check-packages-")) : resolve(values.out);
const tarballs = join(work, "tarballs");
const consumer = join(work, "consumer");
const failures: string[] = [];

try {
  await rm(tarballs, { recursive: true, force: true });
  await rm(consumer, { recursive: true, force: true });
  await mkdir(tarballs, { recursive: true });
  await mkdir(join(consumer, "node_modules", SCOPE), { recursive: true });

  run("bun", ["run", "build:packages"], repository);

  const folders = (await readdir(join(repository, "packages"), { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  for (const folder of Object.keys(RULES)) {
    if (!folders.includes(folder)) failures.push(`rule for ${folder} has no packages/${folder}`);
  }

  const sources = new Map<string, Manifest>();
  for (const folder of folders) {
    sources.set(folder, await manifestAt(join(repository, "packages", folder)));
  }
  const version = sources.get("fs")?.version ?? "0.0.0";
  const exportsOf = new Map([...sources].map(([folder, m]) => [folder, Object.keys(m.exports)]));

  const packed = new Map<string, Manifest>();
  for (const folder of folders) {
    const tarball = await packPackage(join(repository, "packages", folder), tarballs);
    const unpacked = join(consumer, "node_modules", SCOPE, folder);
    await mkdir(unpacked, { recursive: true });
    run("tar", ["-xzf", tarball, "-C", unpacked, "--strip-components=1"], repository);
    const manifest = await manifestAt(unpacked);
    packed.set(folder, manifest);
    const source = sources.get(folder) as Manifest;
    const sourceDir = join(repository, "packages", folder);
    failures.push(...checkManifest(folder, manifest, source, version));
    failures.push(...(await checkFiles(folder, manifest, unpacked, sourceDir)));
    failures.push(...(await checkImports(folder, manifest, unpacked, exportsOf)));
  }

  if (failures.length === 0) {
    await prepareConsumer(repository, consumer);
    const piExtension = packed.get("pi")?.pi?.extensions?.[0] ?? "./missing.js";
    failures.push(...runNodeConsumer(consumer, exportsOf, piExtension));
    failures.push(...(await runTypeConsumers(repository, consumer, exportsOf)));
  }

  if (failures.length > 0) {
    for (const failure of failures) console.error(`check:packages: ${failure}`);
    process.exitCode = 1;
  } else {
    console.log(`check:packages: ok (${folders.length} packages, version ${version})`);
    if (values.out !== undefined) console.log(`check:packages: tarballs in ${tarballs}`);
  }
} finally {
  if (values.out === undefined) await rm(work, { recursive: true, force: true });
}

async function manifestAt(directory: string): Promise<Manifest> {
  return JSON.parse(await readFile(join(directory, "package.json"), "utf8")) as Manifest;
}

function run(command: string, args: readonly string[], cwd: string): void {
  const result = spawnSync(command, args, { cwd, stdio: ["ignore", "ignore", "inherit"] });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed`);
}
