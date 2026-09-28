import { afterAll, describe, expect, test } from "bun:test";

import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { checkLinks, relativeLinks } from "./files.ts";
import type { Manifest } from "./rules.ts";

const roots: string[] = [];

afterAll(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
});

async function tarball(files: Record<string, string>): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "better-fs-tools-links-")));
  roots.push(root);
  for (const [name, content] of Object.entries(files)) {
    await mkdir(join(root, name, ".."), { recursive: true });
    await writeFile(join(root, name), content);
  }
  return root;
}

const manifest = { name: "@better-fs-tools/read" } as Manifest;

describe("relativeLinks", () => {
  test("keeps relative targets without anchors, and skips URLs and same-page anchors", () => {
    const markdown =
      "[a](docs/a.md) [b](docs/b.md#part) [c](https://example.com/x) [d](#local) " +
      "[e](mailto:x@example.com) [f](../README.md)";
    expect(relativeLinks(markdown)).toEqual(["docs/a.md", "docs/b.md", "../README.md"]);
  });
});

describe("checkLinks", () => {
  test("passes when every linked guide is in the tarball", async () => {
    const root = await tarball({
      "README.md": "[guide](docs/architecture.md)",
      "docs/architecture.md": "[back](../README.md) [schema](result-schema.md#notes)",
      "docs/result-schema.md": "",
    });
    expect(await checkLinks(manifest, root)).toEqual([]);
  });

  test("fails when a README links to a guide the tarball does not ship", async () => {
    const root = await tarball({ "README.md": "[guide](docs/architecture.md)" });
    expect(await checkLinks(manifest, root)).toEqual([
      "@better-fs-tools/read: README.md links to docs/architecture.md, which is not in the tarball",
    ]);
  });
});
