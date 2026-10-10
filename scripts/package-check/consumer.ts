import { spawnSync } from "node:child_process";
import { copyFile, mkdir, realpath, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { EMPTY_ENTRIES, RULES, RUNTIME_NEUTRAL, SCOPE } from "./rules.ts";

/** Peers are symlinked from this repository's install so the check stays offline. */
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

/** Imports every export under Node, not Bun, and smoke-tests the main tools of each package. */
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
const { memoryFileSystem, readOnlyFileSystem } = await import("${SCOPE}/fs");
const { createReadTool, memoryStore, textOf } = await import("${SCOPE}/read");
const { createNodeReadTool } = await import("${SCOPE}/node");
const { createAiSdkReadTool } = await import("${SCOPE}/ai-sdk");
const { createNodeFsTools } = await import("${SCOPE}/node");
const { justBashFileSystem } = await import("${SCOPE}/just-bash");
const { createEditTool } = await import("${SCOPE}/write");
const { readFile } = await import("node:fs/promises");
const { InMemoryFs } = await import("just-bash");
const expect = (label, actual, wanted) => {
  if (actual !== wanted) throw new Error(label + ": " + JSON.stringify(actual));
};

expect("node", textOf(await createNodeReadTool()({ path: "fixture.txt" })), "1|alpha\\n2|beta");
const memory = memoryFileSystem({ files: { "/a.txt": "one\\ntwo\\n" } });
expect("memory", textOf(await createReadTool({ fs: memory })({ path: "/a.txt", offset: 2 })), "2|two");
const aiSdk = createAiSdkReadTool({ fs: memory });
expect("ai-sdk", (await aiSdk.execute({ path: "/a.txt" }, { toolCallId: "t", messages: [] })).status, "ok");
const { createFsTools } = await import("${SCOPE}/write");
const portable = createFsTools({ fs: memoryFileSystem({ files: { "/p.txt": "p\\n" } }) });
expect("portable bash off", portable.bash, null);
expect("portable digest", portable.digest.id, "sha256");
await portable.read({ path: "/p.txt" });
expect("portable edit", (await portable.edit({ path: "/p.txt", edits: [{ oldText: "p", newText: "q" }] })).status, "ok");
const { createAiSdkFsTools } = await import("${SCOPE}/ai-sdk");
const aiSdkTools = createAiSdkFsTools({ fs: memoryFileSystem() });
expect("ai-sdk bundle", Object.keys(aiSdkTools.tools).join(), "read,edit,write");
const aiSdkPatch = createAiSdkFsTools({ fs: memoryFileSystem(), applyPatch: true });
expect("ai-sdk bundle apply_patch", Object.keys(aiSdkPatch.tools).join(), "read,edit,write,apply_patch");
const bash = readOnlyFileSystem(justBashFileSystem(new InMemoryFs({ "/w/a.txt": "x\\n" }), {
  cwd: "/w", allowedRoots: ["/w"],
}));
expect("just-bash", textOf(await createReadTool({ fs: bash })({ path: "a.txt" })).split("\\n")[0], "1|x");

const fsTools = createNodeFsTools({ bash: true });
expect("node bash off by default", createNodeFsTools().bash, null);
expect("node apply_patch off by default", fsTools.applyPatch, null);
expect("node create", (await fsTools.write({ path: "made/new.txt", content: "one\\n" })).status, "ok");
const editNew = { path: "made/new.txt", edits: [{ oldText: "one", newText: "two" }] };
expect("node edit after create", (await fsTools.edit(editNew)).status, "ok");
expect("node created bytes", await readFile("made/new.txt", "utf8"), "two\\n");
const editFixture = { path: "fixture.txt", edits: [{ oldText: "beta", newText: "gamma" }] };
expect("node edit before read", (await fsTools.edit(editFixture)).status, "ok");
expect("node edited bytes", await readFile("fixture.txt", "utf8"), "alpha\\ngamma\\n");
const guarded = createNodeFsTools({ state: memoryStore() });
const editGuarded = { path: "fixture.txt", edits: [{ oldText: "gamma", newText: "delta" }] };
expect("node store edit before read", (await guarded.edit(editGuarded)).error?.code, "NOT_READ");
await guarded.read({ path: "fixture.txt" });
expect("node store edit", (await guarded.edit(editGuarded)).status, "ok");
expect("node store edited bytes", await readFile("fixture.txt", "utf8"), "alpha\\ndelta\\n");
const bashBackend = new InMemoryFs({ "/w/b.txt": "y\\n" });
const writableBash = justBashFileSystem(bashBackend, { cwd: "/w", allowedRoots: ["/w"] });
const bashEdit = createEditTool({ fs: writableBash, preconditions: { requireRead: "off" } });
expect("just-bash edit", (await bashEdit({ path: "b.txt", edits: [{ oldText: "y", newText: "z" }] })).status, "ok");
expect("just-bash bytes", await bashBackend.readFile("/w/b.txt"), "z\\n");

const { createBashTool, shellEnv } = await import("${SCOPE}/shell");
const { justBashCommandRunner } = await import("${SCOPE}/just-bash");
const { Bash } = await import("just-bash");
const ran = await fsTools.bash({ command: "cat fixture.txt; exit 3" });
expect("node bash status", ran.status, "failed");
expect("node bash output", ran.output.head, "alpha\\ndelta");
const emulated = new Bash({ files: { "/w/c.txt": "c\\n" }, cwd: "/w" });
const virtualBash = createBashTool({ runner: justBashCommandRunner(emulated), env: shellEnv() });
expect("just-bash bash", (await virtualBash({ command: "cat c.txt" })).output.head, "c");

const { pathToFileURL } = await import("node:url");
const entry = new URL(${JSON.stringify(piExtension)}, pathToFileURL(process.cwd() + "/node_modules/${SCOPE}/pi/"));
const tools = [];
(await import(entry.href)).default({ registerTool: (tool) => tools.push(tool) });
expect("pi extension", tools.map((tool) => tool.name).join(), "read,edit,write");
const { createPiFsTools } = await import("${SCOPE}/pi");
expect("pi apply_patch off by default", createPiFsTools().applyPatch, null);
expect("pi bundle apply_patch", createPiFsTools({ applyPatch: true }).applyPatch?.name, "apply_patch");
`;
  const run = spawnSync("node", ["--input-type=module", "-e", source], {
    cwd: consumer,
    encoding: "utf8",
  });
  return run.status === 0 ? [] : [`Node consumer failed: ${run.stderr.trim()}`];
}

/** Type-checks every package with Node types, and the runtime-neutral packages with only the DOM library. */
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

// Peer libraries resolve outside the consumer by real path; their own declaration errors do not count.
function ownErrors(output: string): string[] {
  return output
    .split("\n")
    .filter((line) => line.includes("error TS"))
    .filter((line) => !line.startsWith("../") && !line.startsWith("/"));
}
