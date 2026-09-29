import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

const root = join(import.meta.dir, "..");

const examples = await exampleFiles();
const readmes = await Promise.all(
  (await readdir(join(root, "packages"), { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .map(async (name) => {
      const path = join(root, "packages", name, "README.md");
      return { path: relative(root, path), snippets: tsBlocks(await readFile(path, "utf8")) };
    }),
);

describe("README snippets", () => {
  for (const readme of readmes) {
    test(`${readme.path} has ts snippets`, () => {
      expect(readme.snippets.length).toBeGreaterThan(0);
    });
    readme.snippets.forEach((snippet, index) => {
      test(`${readme.path} snippet ${index + 1} is in examples/`, () => {
        const home = examples.find((example) => example.text.includes(snippet));
        expect(home?.path ?? `no example file holds:\n${snippet}`).toStartWith("examples/");
      });
    });
  }
});

function tsBlocks(markdown: string): string[] {
  return [...markdown.matchAll(/^```ts\n([\s\S]*?)^```$/gmu)].map((match) => match[1] ?? "");
}

async function exampleFiles(): Promise<{ path: string; text: string }[]> {
  const files: { path: string; text: string }[] = [];
  for (const entry of await readdir(join(root, "examples"), { recursive: true })) {
    if (!entry.endsWith(".ts") || entry.endsWith(".test.ts") || entry.includes("node_modules")) {
      continue;
    }
    const path = join(root, "examples", entry);
    files.push({ path: relative(root, path), text: await readFile(path, "utf8") });
  }
  return files;
}
