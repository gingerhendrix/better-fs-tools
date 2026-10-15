import { describe, expect, test } from "bun:test";

import { readFile } from "node:fs/promises";
import path from "node:path";

import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";

import { createPiEditTool, createPiFsTools, piMutationQueueLocks } from "../src/index.ts";
import { fixtures, run } from "./helpers.ts";

const fixture = fixtures();

/** Takes Pi's queue slot for `file` and keeps it until the returned function runs. */
async function holdPiQueue(file: string): Promise<() => Promise<void>> {
  let free = (): void => {};
  const freed = new Promise<void>((resolve) => {
    free = resolve;
  });
  let entered = (): void => {};
  const inside = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const done = withFileMutationQueue(file, async () => {
    entered();
    await freed;
  });
  await inside;
  return async () => {
    free();
    await done;
  };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 20));

describe("piMutationQueueLocks", () => {
  test("a Better FS Tools edit waits while Pi's queue holds the file", async () => {
    const cwd = await fixture({ "a.txt": "one\n" });
    const file = path.join(cwd, "a.txt");
    const freePi = await holdPiQueue(file);

    let finished = false;
    const edit = run(
      createPiEditTool(),
      { path: "a.txt", old_string: "one", new_string: "two" },
      cwd,
    ).then((result) => {
      finished = true;
      return result;
    });
    await tick();
    expect(finished).toBe(false);
    expect(await readFile(file, "utf8")).toBe("one\n");

    await freePi();
    expect((await edit).isError).toBe(false);
    expect(await readFile(file, "utf8")).toBe("two\n");
  });

  test("Pi's queue waits while a Better FS Tools lock holds the file", async () => {
    const cwd = await fixture({ "a.txt": "one\n" });
    const file = path.join(cwd, "a.txt");
    const outcome = await piMutationQueueLocks().acquire([file], {});
    if (!outcome.ok) throw new Error("the lock was not granted");

    let ran = false;
    const pi = withFileMutationQueue(file, async () => {
      ran = true;
    });
    await tick();
    expect(ran).toBe(false);
    outcome.release();
    await pi;
    expect(ran).toBe(true);
  });

  test("takes several keys and gives them all back", async () => {
    const cwd = await fixture({ "a.txt": "a", "b.txt": "b" });
    const keys = [path.join(cwd, "a.txt"), path.join(cwd, "b.txt")];
    const outcome = await piMutationQueueLocks().acquire(keys, {});
    if (!outcome.ok) throw new Error("the lock was not granted");
    const order: string[] = [];
    const waiting = keys.map((key) => withFileMutationQueue(key, async () => void order.push(key)));
    await tick();
    expect(order).toEqual([]);
    outcome.release();
    outcome.release();
    await Promise.all(waiting);
    expect(order.sort()).toEqual(keys);
  });

  test("a timeout gives up and frees the slot once the holder leaves", async () => {
    const cwd = await fixture({ "a.txt": "a" });
    const file = path.join(cwd, "a.txt");
    const freePi = await holdPiQueue(file);
    expect(await piMutationQueueLocks({ timeoutMs: 30 }).acquire([file], {})).toEqual({
      ok: false,
      reason: "timeout",
    });
    await freePi();
    let ran = false;
    await withFileMutationQueue(file, async () => {
      ran = true;
    });
    expect(ran).toBe(true);
  });

  test("an abort gives up at once; an aborted signal never queues", async () => {
    const cwd = await fixture({ "a.txt": "a" });
    const file = path.join(cwd, "a.txt");
    const locks = piMutationQueueLocks();
    expect(await locks.acquire([file], { signal: AbortSignal.abort() })).toEqual({
      ok: false,
      reason: "aborted",
    });

    const freePi = await holdPiQueue(file);
    const controller = new AbortController();
    const pending = locks.acquire([file], { signal: controller.signal });
    controller.abort();
    expect(await pending).toEqual({ ok: false, reason: "aborted" });
    await freePi();
    await withFileMutationQueue(file, async () => undefined);
  });

  test("checks its options", () => {
    expect(() => piMutationQueueLocks({ timeoutMs: 0 })).toThrow(TypeError);
    expect(() => piMutationQueueLocks(null as never)).toThrow(TypeError);
  });

  test("is the default lock manager of createPiFsTools()", () => {
    expect(createPiFsTools().locks.id).toBe("pi-file-mutation-queue");
  });
});
