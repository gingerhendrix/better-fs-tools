import { describe, expect, test } from "bun:test";

import { memoryLocks } from "../../src/index.ts";

describe("memoryLocks", () => {
  test("serializes holders of one key", async () => {
    const locks = memoryLocks();
    const first = await locks.acquire(["/a"], {});
    if (!first.ok) throw new Error("not taken");
    let second = false;
    const waiting = locks.acquire(["/a"], {}).then((outcome) => {
      second = outcome.ok;
      return outcome;
    });
    await Promise.resolve();
    expect(second).toBe(false);
    first.release();
    const outcome = await waiting;
    expect(outcome.ok).toBe(true);
    if (outcome.ok) outcome.release();
  });

  test("different keys do not wait", async () => {
    const locks = memoryLocks();
    const a = await locks.acquire(["/a"], {});
    const b = await locks.acquire(["/b"], {});
    expect(a.ok && b.ok).toBe(true);
  });

  test("times out and gives back the keys it took", async () => {
    const locks = memoryLocks({ timeoutMs: 20 });
    const held = await locks.acquire(["/b"], {});
    const outcome = await locks.acquire(["/a", "/b"], {});
    expect(outcome).toEqual({ ok: false, reason: "timeout" });
    const a = await locks.acquire(["/a"], {});
    expect(a.ok).toBe(true);
    if (held.ok) held.release();
  });

  test("an abort ends the wait", async () => {
    const locks = memoryLocks();
    const held = await locks.acquire(["/a"], {});
    const controller = new AbortController();
    const waiting = locks.acquire(["/a"], { signal: controller.signal });
    controller.abort();
    expect(await waiting).toEqual({ ok: false, reason: "aborted" });
    expect(await locks.acquire(["/b"], { signal: AbortSignal.abort() })).toEqual({
      ok: false,
      reason: "aborted",
    });
    if (held.ok) held.release();
  });

  test("release is idempotent and hands the key to the next waiter only once", async () => {
    const locks = memoryLocks({ timeoutMs: 50 });
    const first = await locks.acquire(["/a"], {});
    if (!first.ok) throw new Error("not taken");
    const second = locks.acquire(["/a"], {});
    first.release();
    first.release();
    const granted = await second;
    expect(granted.ok).toBe(true);
    expect(await locks.acquire(["/a"], {})).toEqual({ ok: false, reason: "timeout" });
  });

  test("rejects bad options", () => {
    expect(() => memoryLocks({ timeoutMs: 0 })).toThrow(TypeError);
  });
});
