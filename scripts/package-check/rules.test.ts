import { describe, expect, test } from "bun:test";

import { lockstepRange } from "./rules.ts";

describe("lockstepRange", () => {
  test("takes the caret range on the lockstep version", () => {
    expect(lockstepRange("^0.3.1", "0.3.1")).toBe(true);
  });

  test("takes the range that Tegami keeps after a patch release", () => {
    expect(lockstepRange("^0.3.0", "0.3.1")).toBe(true);
  });

  test("refuses a range from an earlier minor version", () => {
    expect(lockstepRange("^0.2.0", "0.3.0")).toBe(false);
  });

  test("refuses a range whose floor is above the lockstep version", () => {
    expect(lockstepRange("^0.3.2", "0.3.1")).toBe(false);
  });

  test("refuses ranges that are not a caret on one exact version", () => {
    expect(lockstepRange("~0.3.0", "0.3.1")).toBe(false);
    expect(lockstepRange(">=0.3.0", "0.3.1")).toBe(false);
    expect(lockstepRange("0.3.1", "0.3.1")).toBe(false);
    expect(lockstepRange("workspace:*", "0.3.1")).toBe(false);
  });
});
