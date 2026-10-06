import { afterAll, describe, expect, test } from "bun:test";

import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { TegamiContext, TegamiPlugin, WorkspacePackage } from "tegami";
import { NpmPackage } from "tegami/providers/npm";

import { applyPublishConfig } from "./publish-config-plugin.ts";

const roots: string[] = [];

afterAll(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
});

const source = `{
  "name": "@better-fs-tools/sample",
  "version": "0.1.0",
  "files": ["dist"],
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "publishConfig": {
    "exports": { ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" } },
    "access": "public"
  }
}
`;

async function samplePackage(): Promise<NpmPackage> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "better-fs-tools-publish-config-")));
  roots.push(root);
  await mkdir(join(root, "dist"));
  await writeFile(join(root, "dist", "index.js"), "export const sample = 1;\n");
  await writeFile(join(root, "package.json"), source);
  const manifest = JSON.parse(source) as ConstructorParameters<typeof NpmPackage>[1];
  return new NpmPackage(root, manifest, {} as ConstructorParameters<typeof NpmPackage>[2]);
}

const context = {} as TegamiContext;
const plan = {} as Parameters<NonNullable<TegamiPlugin["afterPublish"]>>[0]["plan"];

function willPublish(plugin: TegamiPlugin, pkg: WorkspacePackage) {
  return plugin.willPublish?.call(context, { pkg });
}

function manifestAt(pkg: NpmPackage): Promise<Record<string, unknown>> {
  return readFile(join(pkg.path, "package.json"), "utf8").then(JSON.parse);
}

describe("applyPublishConfig", () => {
  test("bun pm pack ships the publishConfig exports while the plugin holds the swap", async () => {
    const pkg = await samplePackage();
    const plugin = applyPublishConfig();
    await willPublish(plugin, pkg);

    const packed = spawnSync("bun", ["pm", "pack", "--filename", "pkg.tgz", "--quiet"], {
      cwd: pkg.path,
      encoding: "utf8",
    });
    expect(packed.status).toBe(0);
    const listed = spawnSync("tar", ["-xzOf", "pkg.tgz", "package/package.json"], {
      cwd: pkg.path,
      encoding: "utf8",
    });
    const shipped = JSON.parse(listed.stdout) as Record<string, unknown>;
    expect(shipped.exports).toEqual({
      ".": { types: "./dist/index.d.ts", import: "./dist/index.js" },
    });

    await plugin.afterPublish?.call(context, { pkg, plan });
    expect(await readFile(join(pkg.path, "package.json"), "utf8")).toBe(source);
  });

  test("keeps registry keys in publishConfig and does not lift them to the top level", async () => {
    const pkg = await samplePackage();
    const plugin = applyPublishConfig();
    await willPublish(plugin, pkg);
    const swapped = await manifestAt(pkg);
    expect(swapped.access).toBeUndefined();
    expect(swapped.publishConfig).toEqual(JSON.parse(source).publishConfig);
    await plugin.afterPublishAll?.call(context, { plan });
  });

  test("afterPublishAll restores a package whose publish Tegami skipped", async () => {
    const pkg = await samplePackage();
    const plugin = applyPublishConfig();
    await willPublish(plugin, pkg);
    expect((await manifestAt(pkg)).exports).not.toEqual({ ".": "./src/index.ts" });

    await plugin.afterPublishAll?.call(context, { plan });
    expect(await readFile(join(pkg.path, "package.json"), "utf8")).toBe(source);
  });

  test("a second willPublish for the same package keeps the first original", async () => {
    const pkg = await samplePackage();
    const plugin = applyPublishConfig();
    await willPublish(plugin, pkg);
    await willPublish(plugin, pkg);
    await plugin.afterPublish?.call(context, { pkg, plan });
    expect(await readFile(join(pkg.path, "package.json"), "utf8")).toBe(source);
  });
});
