import { describe, expect, spyOn, test } from "bun:test";

import { memoryFileSystem } from "@better-fs-tools/fs";
import type { WritableFileSystem } from "@better-fs-tools/fs";

import { createWriteTool, executableShebang } from "../../src/index.ts";
import { codes, harness, note } from "../helpers.ts";

function withoutModes(fs: WritableFileSystem): WritableFileSystem {
  return {
    id: "no-modes",
    capabilities: fs.capabilities,
    paths: fs.paths,
    writeCapabilities: fs.writeCapabilities,
    open: (path, options) => fs.open(path, options),
    write: (path, bytes, options) => fs.write(path, bytes, options),
    stat: async (path, options) => {
      const outcome = await fs.stat(path, options);
      if (!outcome.ok || !outcome.stat.exists) return outcome;
      return { ok: true, stat: { ...outcome.stat, mode: null } };
    },
  };
}

describe("executableShebang", () => {
  test("a new #! file is created with mode 755 in one write, with a note", async () => {
    const { fs, write } = harness({ deps: { hooks: [executableShebang()] } });
    const writes = spyOn(fs, "write");
    const result = await write({ path: "/bin/run", content: "#!/bin/sh\necho hi\n" });
    expect(result.status).toBe("ok");
    expect(fs.peek("/bin/run")?.mode).toBe(0o755);
    expect(writes).toHaveBeenCalledTimes(1);
    expect(writes.mock.calls[0]?.[2]).toMatchObject({ mode: 0o755 });
    expect(note(result, "executable")).toEqual({
      code: "executable",
      severity: "info",
      message: 'Made /bin/run executable (mode 755) because it starts with "#!".',
      data: { mode: 0o755 },
    });
  });

  test("near miss: a new file without #!, or #! after the first byte", async () => {
    const { fs, write } = harness({ deps: { hooks: [executableShebang()] } });
    for (const [path, content] of [
      ["/a.sh", "echo hi\n"],
      ["/b.sh", " #!/bin/sh\n"],
      ["/c.md", "# #!\n"],
    ] as const) {
      const result = await write({ path, content });
      expect([path, fs.peek(path)?.mode, codes(result)]).toEqual([path, 0o644, []]);
    }
  });

  test("a replace keeps the file's mode", async () => {
    const { fs, read, write } = harness({
      files: { "/run": "echo old\n" },
      deps: { hooks: [executableShebang()] },
    });
    await read({ path: "/run" });
    const result = await write({ path: "/run", content: "#!/bin/sh\necho new\n" });
    expect(result.status).toBe("ok");
    expect(fs.peek("/run")?.mode).toBe(0o644);
    expect(note(result, "executable")).toBeUndefined();
  });

  test("a host mode", async () => {
    const { fs, write } = harness({ deps: { hooks: [executableShebang({ mode: 0o700 })] } });
    await write({ path: "/run", content: "#!/bin/sh\n" });
    expect(fs.peek("/run")?.mode).toBe(0o700);
    expect(() => executableShebang({ mode: 0o10000 })).toThrow(TypeError);
  });

  test("a backend without modes gets no note", async () => {
    const fs = memoryFileSystem();
    const write = createWriteTool({ fs: withoutModes(fs), hooks: [executableShebang()] });
    const result = await write({ path: "/run", content: "#!/bin/sh\n" });
    expect(result.status).toBe("ok");
    expect(note(result, "executable")).toBeUndefined();
  });
});
