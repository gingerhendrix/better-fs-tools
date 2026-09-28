import { describe, expect, test } from "bun:test";

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { discoverAndLoadExtensions } from "@earendil-works/pi-coding-agent";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import readToolExtension from "../src/extension.ts";
import type { PiReadTool } from "../src/index.ts";
import { fixtures } from "./helpers.ts";

const fixture = fixtures();

const PACKAGE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXTENSION_SOURCE = path.join(PACKAGE_DIR, "src", "extension.ts");

describe("pi extension", () => {
  test("registers exactly one stateless read tool", () => {
    const registered: PiReadTool[] = [];
    readToolExtension({ registerTool: (tool) => registered.push(tool) });

    expect(registered).toHaveLength(1);
    expect(registered[0]?.name).toBe("read");
    expect(Object.hasOwn(registered[0] as PiReadTool, "renderCall")).toBe(false);
    expect(Object.hasOwn(registered[0] as PiReadTool, "renderResult")).toBe(false);
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

      // A package manifest for the global lane, a bare file for the project
      // lane: the two shapes Pi's loader discovers.
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

      // Nothing may reach the real ~/.pi: HOME and the agent directory both
      // point inside the temporary tree, and no settings file is written.
      const previous = { home: process.env.HOME, agent: process.env.PI_CODING_AGENT_DIR };
      process.env.HOME = home;
      process.env.PI_CODING_AGENT_DIR = agentDir;
      try {
        const loaded = await discoverAndLoadExtensions([], project, agentDir);
        expect(loaded.errors).toEqual([]);
        expect(loaded.extensions).toHaveLength(1);

        const tools = loaded.extensions[0]?.tools;
        expect(tools?.size).toBe(1);
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
