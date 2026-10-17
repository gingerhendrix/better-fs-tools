import { describe, expect, test } from "bun:test";

import path from "node:path";

import { piCwdCommandRunner, piCwdFileSystem } from "../src/node.ts";
import { fixtures, piContext } from "./helpers.ts";

const fixture = fixtures();

describe("piCwdFileSystem", () => {
  test("roots each call's filesystem at ctx.cwd and keeps one per root", async () => {
    const one = await fixture({ "a.txt": "one\n" });
    const two = await fixture();
    const fs = piCwdFileSystem();
    const first = fs({ host: piContext(one) });
    expect(fs({ host: piContext(one) })).toBe(first);
    expect(fs({ host: piContext(two) })).not.toBe(first);
    const inside = await first.stat("a.txt", {});
    expect(inside.ok && inside.stat.resolvedPath).toBe(path.join(one, "a.txt"));
    const outside = await first.stat(path.join(two, "x.txt"), {});
    expect(outside.ok).toBe(false);
  });

  test("passes its options to nodeFileSystem() and refuses cwd and allowedRoots", () => {
    expect(() => piCwdFileSystem({ cwd: "/" } as never)).toThrow(
      "piCwdFileSystem options cannot set cwd",
    );
    expect(() => piCwdFileSystem({ allowedRoots: ["/"] } as never)).toThrow(
      "piCwdFileSystem options cannot set allowedRoots",
    );
    expect(() => piCwdFileSystem(null as never)).toThrow(TypeError);
    expect(piCwdFileSystem({ id: "pi-cwd" })({ host: piContext("/tmp") }).id).toBe("pi-cwd");
  });
});

describe("piCwdCommandRunner", () => {
  test("gives a runner at ctx.cwd and keeps the recent ones", () => {
    const runners = piCwdCommandRunner({ id: "pi-node" });
    const first = runners({ host: piContext("/tmp") });
    expect(first.cwd).toBe("/tmp");
    expect(first.id).toBe("pi-node");
    expect(runners({ host: piContext("/tmp") })).toBe(first);
    expect(runners({ host: piContext("/") }).cwd).toBe("/");
  });
});
