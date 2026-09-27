import { spawnSync } from "node:child_process";
import { copyFile, mkdir, realpath, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { EMPTY_ENTRIES, RULES, RUNTIME_NEUTRAL, SCOPE } from "./rules.ts";

/**
 * A throwaway project whose node_modules holds the unpacked tarballs, with the
 * peers linked from this repository's install. Peers are linked, not
 * downloaded, so the check stays offline and uses the versions under test.
 */
export async function prepareConsumer(repository: string, consumer: string): Promise<void> {
  await writeFile(
    join(consumer, "package.json"),
    `${JSON.stringify({ name: "package-check-consumer", private: true, type: "module" }, null, 2)}\n`,
  );
  await writeFile(join(consumer, "fixture.txt"), "alpha\nbeta\n");
  const links = new Map<string, string>([["@types/node", join(repository, "node_modules")]]);
  for (const [folder, rule] of Object.entries(RULES)) {
    for (const peer of Object.keys(rule.peers)) {
      links.set(peer, join(repository, "packages", folder, "node_modules"));
    }
  }
  for (const [name, modules] of links) {
    const target = join(consumer, "node_modules", name);
    await mkdir(dirname(target), { recursive: true });
    await symlink(await realpath(join(modules, name)), target, "dir");
  }
}

/**
 * Imports every export under Node, not Bun, then reads through the Node tool,
 * the memory filesystem, the AI SDK tool, just-bash, and the Pi extension entry
 * that `pi.extensions` names.
 */
export function runNodeConsumer(
  consumer: string,
  exportsOf: ReadonlyMap<string, readonly string[]>,
  piExtension: string,
): string[] {
  const imports = [...exportsOf].flatMap(([folder, keys]) =>
    keys.map((key) => (key === "." ? `${SCOPE}/${folder}` : `${SCOPE}/${folder}/${key.slice(2)}`)),
  );
  const source = `
if (process.release?.name !== "node") throw new Error("not running under Node");
const empty = new Set(${JSON.stringify(EMPTY_ENTRIES)});
for (const specifier of ${JSON.stringify(imports)}) {
  const module = await import(specifier);
  const exported = Object.keys(module).length > 0;
  if (!exported && !empty.has(specifier)) throw new Error(specifier + " exported nothing");
  if (exported && empty.has(specifier)) {
    throw new Error(specifier + " now exports values: remove it from EMPTY_ENTRIES");
  }
}
const { memoryFileSystem } = await import("${SCOPE}/fs");
const { createReadTool, textOf } = await import("${SCOPE}/read");
const { createNodeReadTool } = await import("${SCOPE}/node");
const { createAiSdkReadTool } = await import("${SCOPE}/ai-sdk");
const { justBashReadFileSystem } = await import("${SCOPE}/just-bash");
const { InMemoryFs } = await import("just-bash");
const expect = (label, actual, wanted) => {
  if (actual !== wanted) throw new Error(label + ": " + JSON.stringify(actual));
};

expect("node", textOf(await createNodeReadTool()({ path: "fixture.txt" })), "1|alpha\\n2|beta");
const memory = memoryFileSystem({ files: { "/a.txt": "one\\ntwo\\n" } });
expect("memory", textOf(await createReadTool({ fs: memory })({ path: "/a.txt", offset: 2 })), "2|two");
const aiSdk = createAiSdkReadTool({ fs: memory });
expect("ai-sdk", (await aiSdk.execute({ path: "/a.txt" }, { toolCallId: "t", messages: [] })).status, "ok");
const bash = justBashReadFileSystem(new InMemoryFs({ "/w/a.txt": "x\\n" }), {
  id: "bash", cwd: "/w", allowedRoots: ["/w"], maxBufferedBytes: 1024,
});
expect("just-bash", textOf(await createReadTool({ fs: bash })({ path: "a.txt" })).split("\\n")[0], "1|x");

const { pathToFileURL } = await import("node:url");
const entry = new URL(${JSON.stringify(piExtension)}, pathToFileURL(process.cwd() + "/node_modules/${SCOPE}/pi/"));
const tools = [];
(await import(entry.href)).default({ registerTool: (tool) => tools.push(tool) });
expect("pi extension", tools.map((tool) => tool.name).join(), "read");
`;
  const run = spawnSync("node", ["--input-type=module", "-e", source], {
    cwd: consumer,
    encoding: "utf8",
  });
  return run.status === 0 ? [] : [`Node consumer failed: ${run.stderr.trim()}`];
}

/**
 * Type-checks the published declarations twice with the repository's tsc:
 * every package with Node types, and the runtime-neutral packages with only
 * the DOM library. Neither run has Bun types or skips library checks. Only
 * errors in this repository's packages and the consumer files count.
 */
export async function runTypeConsumers(
  repository: string,
  consumer: string,
  exportsOf: ReadonlyMap<string, readonly string[]>,
): Promise<string[]> {
  await copyFile(join(repository, "examples", "custom-host.ts"), join(consumer, "custom-host.ts"));
  const imports = (folders: readonly string[]) =>
    folders
      .flatMap((folder) =>
        (exportsOf.get(folder) ?? []).map((key) =>
          key === "." ? `${SCOPE}/${folder}` : `${SCOPE}/${folder}/${key.slice(2)}`,
        ),
      )
      .map((specifier, index) => `import * as m${index} from "${specifier}";\nvoid m${index};`)
      .join("\n");
  await writeFile(join(consumer, "all.ts"), `${imports([...exportsOf.keys()])}\n`);
  await writeFile(join(consumer, "neutral.ts"), `${imports(RUNTIME_NEUTRAL)}\n`);

  const failures: string[] = [];
  const configs = {
    node: { files: ["all.ts", "custom-host.ts"], lib: ["ESNext"], types: ["node"] },
    neutral: { files: ["neutral.ts"], lib: ["ESNext", "DOM"], types: [] },
  };
  for (const [label, config] of Object.entries(configs)) {
    const path = join(consumer, `tsconfig.${label}.json`);
    const tsconfig = {
      compilerOptions: {
        strict: true,
        noEmit: true,
        skipLibCheck: false,
        module: "NodeNext",
        moduleResolution: "NodeNext",
        target: "ESNext",
        lib: config.lib,
        types: config.types,
      },
      files: config.files,
    };
    await writeFile(path, `${JSON.stringify(tsconfig, null, 2)}\n`);
    const tsc = spawnSync(join(repository, "node_modules", ".bin", "tsc"), ["-p", path], {
      cwd: consumer,
      encoding: "utf8",
    });
    const errors = ownErrors(tsc.stdout);
    if (errors.length > 0) failures.push(`${label} type consumer failed:\n${errors.join("\n")}`);
    else if (tsc.status !== 0 && !tsc.stdout.includes("error TS")) {
      failures.push(`${label} type consumer did not run: ${tsc.stderr.trim()}`);
    }
  }
  return failures;
}

/**
 * Errors in the consumer files and in the unpacked packages. Peer libraries
 * resolve outside the consumer through their real paths, so their own
 * declaration errors (for example missing DOM types in ai) are left out.
 */
function ownErrors(output: string): string[] {
  return output
    .split("\n")
    .filter((line) => line.includes("error TS"))
    .filter((line) => !line.startsWith("../") && !line.startsWith("/"));
}
