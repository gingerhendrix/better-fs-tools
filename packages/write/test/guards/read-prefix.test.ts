import { describe, expect, test } from "bun:test";

import { memoryFileSystem } from "@better-fs-tools/fs";
import { createReadTool, hashlineGutter, lineNumberFormatter, textOf } from "@better-fs-tools/read";
import type { Digest, ReadFormatter } from "@better-fs-tools/read";
import { hashlineFormat, hermesFormat, opencodeFormat } from "@better-fs-tools/read/formats";

import { readPrefixGuard } from "../../src/index.ts";
import { errorOf, errorCode, harness, testDigest, text } from "../helpers.ts";
import { change, guardContext, numbered, verdict } from "./helpers.ts";

const SOURCE = [
  "export function sum(a: number, b: number) {",
  "  return a + b;",
  "}",
  "",
  "export const zero = 0;",
  "export const one = 1;",
];

/** A digest whose hashes use base64url letters, as some hosts' digests do. */
function base64Digest(): Digest {
  const inner = testDigest("b64");
  return {
    id: "b64",
    create: () => inner.create(),
    hash: (value) => `b64:${Buffer.from(inner.hash(value)).toString("base64url")}`,
  };
}

/** The file lines as the read tool shows them with `formatter`. */
async function readOutput(formatter: ReadFormatter<unknown>, digest: Digest): Promise<string[]> {
  const fs = memoryFileSystem({ files: { "/src/sum.ts": `${SOURCE.join("\n")}\n` } });
  const read = createReadTool({ fs, digest, formatter });
  const shown = textOf(await read({ path: "/src/sum.ts" }));
  if (formatter.id === "hermes")
    return (JSON.parse(shown) as { content: string }).content.split("\n");
  return shown.split("\n").filter((line) => /^\s*\d/u.test(line));
}

describe("readPrefixGuard", () => {
  const presets: [string, ReadFormatter<unknown>, Digest][] = [
    ["line-number (default)", lineNumberFormatter(), testDigest()],
    ["hashline, hex digest", hashlineFormat(), testDigest()],
    ["hashline, base64url digest", hashlineFormat(), base64Digest()],
    [
      "hashline gutter, width 8",
      lineNumberFormatter({ gutter: hashlineGutter({ width: 8 }) }),
      testDigest(),
    ],
    ["opencode", opencodeFormat(), testDigest()],
    ["hermes", hermesFormat(), testDigest()],
  ];

  test.each(presets)(
    "refuses the %s gutter from real read output",
    async (_name, formatter, digest) => {
      const lines = await readOutput(formatter, digest);
      expect(lines).toHaveLength(SOURCE.length);
      const guard = readPrefixGuard();
      const decision = guard.check(
        change({ before: `${SOURCE.join("\n")}\n`, after: `${lines.join("\n")}\n` }),
        guardContext(),
      );
      expect(verdict(decision)).toBe("read-prefix");
    },
  );

  test.each([
    ["arrow", (n: number) => `${String(n).padStart(6)}→`],
    ["cat -n tab", (n: number) => `${String(n).padStart(6)}\t`],
  ])("refuses the %s gutter other hosts show", (_name, gutter) => {
    const decision = readPrefixGuard().check(
      change({ after: numbered(SOURCE, gutter, 40) }),
      guardContext(),
    );
    expect(verdict(decision)).toBe("read-prefix");
  });

  test("near miss: the same lines without the gutter", () => {
    const decision = readPrefixGuard().check(change({ after: SOURCE.join("\n") }), guardContext());
    expect(verdict(decision)).toBe("allow");
  });

  test("near miss: a file whose before text already has gutter lines", () => {
    const before = numbered(["a", "b", "c", "d"], (n) => `${n}|`);
    const after = `${before}\n${numbered(["e", "f"], (n) => `${n}|`, 5)}`;
    const decision = readPrefixGuard().check(
      change({ before, after, fragments: [{ oldText: "4|d", newText: "4|d\n5|e\n6|f" }] }),
      guardContext(),
    );
    expect(verdict(decision)).toBe("allow");
  });

  test("ordinary content is allowed", () => {
    const allowed = [
      // Markdown numbered lists.
      "# Steps\n\n1. Install.\n2. Configure.\n3. Run.\n4. Check.\n",
      "1) one\n2) two\n3) three\n",
      // One or two lines that look like a gutter inside code.
      "const x = 1;\n1|2\nconst y = 3;\nconst z = 4;\n",
      "const table = {\n  1: 'one',\n  2: 'two',\n};\n",
      // YAML with numeric keys, not numbered one by one.
      "codes:\n  200: ok\n  404: not found\n  500: error\n",
      // Tab-separated data with an id column.
      "1\talice\n2\tbob\n3\tcarol\n4\tdave\n",
      // Times and ratios.
      "10:30 start\n11:45 lunch\n12:15 back\n",
    ];
    for (const after of allowed) {
      const decision = readPrefixGuard().check(change({ after }), guardContext());
      expect([after, verdict(decision)]).toEqual([after, "allow"]);
    }
  });

  test("the weak `12: ` form needs three lines in a row", () => {
    const guard = readPrefixGuard();
    const two = guard.check(change({ after: "1: a\n2: b\n" }), guardContext());
    const three = guard.check(change({ after: "1: a\n2: b\n3: c\n" }), guardContext());
    expect([verdict(two), verdict(three)]).toEqual(["allow", "read-prefix"]);
  });

  test("lines already in the file do not count", () => {
    const before = "keep\n7|kept one\n8|kept two\n";
    const decision = readPrefixGuard().check(
      change({ before, after: `${before}plain\n` }),
      guardContext(),
    );
    expect(verdict(decision)).toBe("allow");
  });

  test("ratio: gutter lines under the share pass", () => {
    const after = ["a", "b", "c", "d", "10|x", "11|y"].join("\n");
    expect(verdict(readPrefixGuard().check(change({ after }), guardContext()))).toBe("allow");
    expect(verdict(readPrefixGuard({ ratio: 0.3 }).check(change({ after }), guardContext()))).toBe(
      "read-prefix",
    );
  });

  test("a host gutter replaces the default", () => {
    const guard = readPrefixGuard({ gutter: /^L\d+: /u });
    const decision = guard.check(change({ after: "L1: a\nL2: b\n" }), guardContext());
    expect(verdict(decision)).toBe("read-prefix");
    expect(verdict(guard.check(change({ after: "1|a\n2|b\n" }), guardContext()))).toBe("allow");
  });

  test("the message names the parameter and a sample gutter", () => {
    const decision = readPrefixGuard().check(
      change({
        tool: "edit",
        before: "a\n",
        after: "12|a\n13|b\n",
        fragments: [{ oldText: "a", newText: "12|a\n13|b" }],
      }),
      guardContext("edit"),
    );
    expect(decision).toEqual({
      allow: false,
      note: {
        code: "read-prefix",
        severity: "warning",
        message:
          'The newText for /a.txt starts 2 of its 2 new lines with read tool line numbers, such as "12|". Send only the file text, without the line-number prefixes.',
        data: { lines: 2, gutter: "12|" },
      },
    });
  });

  test("rejects bad options", () => {
    expect(() => readPrefixGuard({ ratio: 0 })).toThrow(TypeError);
    expect(() => readPrefixGuard({ ratio: 2 })).toThrow(TypeError);
    expect(() => readPrefixGuard({ gutter: "|" as never })).toThrow(TypeError);
  });

  test("on by default: an edit that pastes read output is refused and nothing changes", async () => {
    const { fs, read, edit } = harness({ files: { "/a.ts": "const a = 1;\nconst b = 2;\n" } });
    await read({ path: "/a.ts" });
    const result = await edit({
      path: "/a.ts",
      edits: [{ oldText: "const b = 2;", newText: "2|const b = 3;\n3|const c = 4;" }],
    });
    expect(errorCode(result)).toBe("GUARD_REFUSED");
    expect(errorOf(result)?.data).toMatchObject({ guard: "read-prefix", source: "read-prefix" });
    expect(text(fs, "/a.ts")).toBe("const a = 1;\nconst b = 2;\n");
  });
});
