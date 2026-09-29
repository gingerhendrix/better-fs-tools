import { describe, expect, test } from "bun:test";

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { discoverAndLoadExtensions } from "@earendil-works/pi-coding-agent";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import fsToolsExtension from "../src/extension.ts";
import type { PiMutationTool, PiReadTool } from "../src/index.ts";
import { fixtures } from "./helpers.ts";

const fixture = fixtures();

const PACKAGE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXTENSION_SOURCE = path.join(PACKAGE_DIR, "src", "extension.ts");

describe("pi extension", () => {
  test("registers read, edit, write, and apply_patch, with no renderers", () => {
    const registered: (PiReadTool | PiMutationTool)[] = [];
    fsToolsExtension({
      registerTool: (tool: PiReadTool | PiMutationTool) => registered.push(tool),
    });

    expect(registered.map((tool) => tool.name)).toEqual(["read", "edit", "write", "apply_patch"]);
    for (const tool of registered) {
      expect(Object.hasOwn(tool, "renderCall")).toBe(false);
      expect(Object.hasOwn(tool, "renderResult")).toBe(false);
    }
    const edit = registered[1]?.parameters as { properties?: object } | undefined;
    expect(Object.keys(edit?.properties ?? {})).toEqual(["path", "edits"]);
    expect((registered[3] as PiMutationTool).constrainedSampling?.type).toBe("grammar");
  });

  test("the registered tools share one store: edit needs a read first", async () => {
    const registered: (PiReadTool | PiMutationTool)[] = [];
    fsToolsExtension({
      registerTool: (tool: PiReadTool | PiMutationTool) => registered.push(tool),
    });
    const [read, edit] = registered as [PiReadTool, PiMutationTool];
    const cwd = await fixture({ "a.txt": "one\n" });
    const context = { cwd } as ExtensionContext;
    const input = { path: "a.txt", edits: [{ oldText: "one", newText: "two" }] };

    const first = await edit.execute("e1", input, undefined, undefined, context);
    expect(first.content).toEqual([
      { type: "text", text: "[edit:not-read] Read a.txt with the read tool before changing it." },
    ]);
    await read.execute("r1", { path: "a.txt" }, undefined, undefined, context);
    const second = await edit.execute("e2", input, undefined, undefined, context);
    expect(second.details?.diff).toBe("-1 one\n+1 two");
    expect(await readFile(path.join(cwd, "a.txt"), "utf8")).toBe("two\n");
  });

  test("the package manifest points pi.extensions at the entry", async () => {
    const manifest = JSON.parse(await readFile(path.join(PACKAGE_DIR, "package.json"), "utf8"));
    expect(manifest.pi).toEqual({ extensions: ["./src/extension.ts"] });
    expect(manifest.exports["./extension"]).toBe("./src/extension.ts");
  });

  for (const scope of ["global", "project"] as const) {
    test(`is discovered from ${scope} configuration in an isolated Pi home`, async () => {
      const home = await fixture();
      const project = path.join(home, "project");
      const agentDir = path.join(home, "agent");
      await mkdir(project, { recursive: true });
      await mkdir(agentDir, { recursive: true });
      await writeFile(path.join(project, "fixture.txt"), "one\ntwo\nthree\nfour\n");

      // Pi's loader discovers a package in the global lane and a bare file in the project lane.
      const entry = `export { default } from ${JSON.stringify(EXTENSION_SOURCE)};\n`;
      if (scope === "global") {
        const packageDir = path.join(agentDir, "extensions", "better-fs-tools-read");
        await mkdir(packageDir, { recursive: true });
        await writeFile(
          path.join(packageDir, "package.json"),
          `${JSON.stringify({ name: "better-fs-tools-read-fixture", type: "module", pi: { extensions: ["./extension.ts"] } })}\n`,
        );
        await writeFile(path.join(packageDir, "extension.ts"), entry);
      } else {
        const extensionsDir = path.join(project, ".pi", "extensions");
        await mkdir(extensionsDir, { recursive: true });
        await writeFile(path.join(extensionsDir, "better-fs-tools-read.ts"), entry);
      }

      // Keep Pi away from the real ~/.pi.
      const previous = { home: process.env.HOME, agent: process.env.PI_CODING_AGENT_DIR };
      process.env.HOME = home;
      process.env.PI_CODING_AGENT_DIR = agentDir;
      try {
        const loaded = await discoverAndLoadExtensions([], project, agentDir);
        expect(loaded.errors).toEqual([]);
        expect(loaded.extensions).toHaveLength(1);

        const tools = loaded.extensions[0]?.tools;
        expect([...(tools?.keys() ?? [])]).toEqual(["read", "edit", "write", "apply_patch"]);
        const definition = tools?.get("read")?.definition;
        if (definition === undefined) throw new Error("the read tool was not registered");

        const context = { cwd: project } as ExtensionContext;
        const read = await definition.execute(
          "probe",
          { path: "fixture.txt", offset: 2, limit: 2 },
          undefined,
          undefined,
          context,
        );
        expect(read.content).toEqual([
          {
            type: "text",
            text:
              "2|two\n3|three\n\n[read:continue] Output stopped at the line limit. " +
              'Continue with {"path":"fixture.txt","offset":4,"limit":2}.',
          },
        ]);

        const outside = await definition.execute(
          "probe",
          { path: path.join(home, "fixture.txt") },
          undefined,
          undefined,
          context,
        );
        expect((outside.content[0] as { text: string }).text).toMatch(
          /^\[read:outside-allowed-roots\]/u,
        );

        const write = tools?.get("write")?.definition;
        if (write === undefined) throw new Error("the write tool was not registered");
        const created = await write.execute(
          "probe",
          { path: "made.txt", content: "made\n" },
          undefined,
          undefined,
          context,
        );
        expect(created.content).toEqual([{ type: "text", text: "Created made.txt (1 line)." }]);
        expect(await readFile(path.join(project, "made.txt"), "utf8")).toBe("made\n");
      } finally {
        if (previous.home === undefined) delete process.env.HOME;
        else process.env.HOME = previous.home;
        if (previous.agent === undefined) delete process.env.PI_CODING_AGENT_DIR;
        else process.env.PI_CODING_AGENT_DIR = previous.agent;
        await rm(home, { recursive: true, force: true });
      }
    });
  }
});
