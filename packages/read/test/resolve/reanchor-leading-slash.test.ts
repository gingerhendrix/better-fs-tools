import { describe, expect, test } from "bun:test";

import { reanchorLeadingSlash } from "../../src/index.ts";
import { resolveContext } from "./context.ts";

describe("reanchorLeadingSlash", () => {
  const ctx = resolveContext();
  const asked: string[] = [];
  const resolver = reanchorLeadingSlash({
    firstSegmentExists: (segment) => {
      asked.push(segment);
      return segment === "src";
    },
  });

  test("drops the leading slash when the host says the first segment exists", async () => {
    expect(await resolver.resolve("/src/x.ts", ctx)).toEqual({ kind: "path", path: "src/x.ts" });
    expect(asked).toEqual(["src"]);
  });

  test("leaves other paths unchanged", async () => {
    for (const path of ["/etc/passwd", "src/x.ts", "/", "//src/x.ts"]) {
      expect(await resolver.resolve(path, ctx)).toEqual({ kind: "path", path });
    }
  });

  test("needs a function", () => {
    expect(() => reanchorLeadingSlash({} as never)).toThrow(TypeError);
  });
});
