import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join, posix, relative } from "node:path";

import { RULES, SCOPE } from "./rules.ts";
import type { Manifest } from "./rules.ts";

/** Every file under `root`, as sorted POSIX paths relative to it. */
export async function listFiles(root: string): Promise<string[]> {
  if (!existsSync(root)) return [];
  const files: string[] = [];
  for (const item of await readdir(root, { withFileTypes: true, recursive: true })) {
    if (item.isFile()) files.push(relative(root, join(item.parentPath, item.name)));
  }
  return files.map((file) => file.split("\\").join("/")).sort();
}

/**
 * Checks the files in one unpacked tarball: exactly the build output for every
 * source file, no src or test files, and every path the manifest names.
 */
export async function checkFiles(
  folder: string,
  packed: Manifest,
  unpacked: string,
  source: string,
): Promise<string[]> {
  const rule = RULES[folder];
  if (rule === undefined) return [];
  const failures: string[] = [];
  const fail = (message: string) => failures.push(`${packed.name}: ${message}`);
  const files = await listFiles(unpacked);
  const present = new Set(files);

  const expected = new Set(["package.json", "README.md"]);
  for (const file of await listFiles(join(source, "src"))) {
    if (!file.endsWith(".ts")) continue;
    const stem = `dist/${file.slice(0, -3)}`;
    expected.add(`${stem}.js`);
    expected.add(`${stem}.d.ts`);
  }
  for (const extra of rule.extraFiles) {
    for (const file of await listFiles(join(source, extra))) expected.add(`${extra}/${file}`);
  }
  for (const file of files) {
    if (/^(src|test)\//u.test(file)) fail(`ships a source or test file: ${file}`);
    else if (!expected.has(file)) fail(`ships an unexpected file: ${file}`);
  }
  for (const file of expected) {
    if (!present.has(file)) fail(`is missing ${file}`);
  }

  for (const [key, target] of Object.entries(packed.exports)) {
    if (typeof target === "string") continue;
    for (const file of [target.types, target.import]) {
      if (file !== undefined && !present.has(file.replace(/^\.\//u, ""))) {
        fail(`export ${key} points at ${file}, which is not in the tarball`);
      }
    }
  }
  for (const entry of packed.pi?.extensions ?? []) {
    if (!present.has(entry.replace(/^\.\//u, ""))) {
      fail(`pi.extensions points at ${entry}, which is not in the tarball`);
    }
  }
  return failures;
}

const SPECIFIER = /\bfrom\s+"([^"]+)"|\bimport\s*\(\s*"([^"]+)"\s*\)|^\s*import\s+"([^"]+)"/gmu;

/**
 * Checks every import in the built files. A relative import must name a file in
 * the tarball. A package import must be a declared dependency with that export,
 * a declared peer, or a `node:` builtin in a package that may use Node.
 */
export async function checkImports(
  folder: string,
  packed: Manifest,
  unpacked: string,
  exportsOf: ReadonlyMap<string, readonly string[]>,
): Promise<string[]> {
  const rule = RULES[folder];
  if (rule === undefined) return [];
  const failures: string[] = [];
  const files = (await listFiles(unpacked)).filter((file) => /\.(js|d\.ts)$/u.test(file));
  const present = new Set(files);
  for (const file of files) {
    const text = await readFile(join(unpacked, file), "utf8");
    for (const match of text.matchAll(SPECIFIER)) {
      const specifier = match[1] ?? match[2] ?? match[3] ?? "";
      const problem = checkSpecifier(file, specifier, present, packed, rule.node, exportsOf);
      if (problem !== null)
        failures.push(`${packed.name}: ${file} imports "${specifier}": ${problem}`);
    }
  }
  return failures;
}

function checkSpecifier(
  file: string,
  specifier: string,
  present: ReadonlySet<string>,
  packed: Manifest,
  node: boolean,
  exportsOf: ReadonlyMap<string, readonly string[]>,
): string | null {
  if (specifier.startsWith(".")) {
    const target = posix.normalize(posix.join(posix.dirname(file), specifier));
    if (file.endsWith(".d.ts")) {
      const declaration = target.replace(/\.(ts|js)$/u, ".d.ts");
      return present.has(declaration) ? null : `no ${declaration} in the tarball`;
    }
    if (!specifier.endsWith(".js")) return "a relative runtime import must end in .js";
    return present.has(target) ? null : `no ${target} in the tarball`;
  }
  if (specifier.startsWith("node:")) return node ? null : "this package must not import node:*";
  if (specifier.startsWith(`${SCOPE}/`)) {
    const [name = "", ...rest] = specifier.slice(SCOPE.length + 1).split("/");
    if (packed.dependencies?.[`${SCOPE}/${name}`] === undefined) return "not a declared dependency";
    const key = rest.length === 0 ? "." : `./${rest.join("/")}`;
    return exportsOf.get(name)?.includes(key) === true
      ? null
      : `${SCOPE}/${name} has no ${key} export`;
  }
  const bare = specifier.startsWith("@")
    ? specifier.split("/").slice(0, 2).join("/")
    : specifier.split("/")[0];
  return bare !== undefined && packed.peerDependencies?.[bare] !== undefined
    ? null
    : "not a declared peer or dependency";
}
