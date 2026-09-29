import { describe, expect, test } from "bun:test";

import { memoryFileSystem } from "@better-fs-tools/fs";
import { createReadTool, plainFormatter, textOf } from "@better-fs-tools/read";
import type { ReadFormatter } from "@better-fs-tools/read";
import { deepAgentsFormat, hermesFormat, opencodeFormat } from "@better-fs-tools/read/formats";

import { truncationNoticeGuard } from "../../src/index.ts";
import { errorOf, errorCode, harness } from "../helpers.ts";
import { change, guardContext, verdict } from "./helpers.ts";

const LONG = "x".repeat(40);
const FILE = `${["a", LONG, "c", "d", "e"].join("\n")}\n`;

async function readOutput(formatter?: ReadFormatter<unknown>): Promise<string> {
  const fs = memoryFileSystem({ files: { "/f.txt": FILE } });
  const read = createReadTool({
    fs,
    limits: { maxCharsPerLine: 20, maxLines: 3 },
    ...(formatter === undefined ? {} : { formatter }),
  });
  const shown = textOf(await read({ path: "/f.txt" }));
  if (formatter?.id === "hermes") return (JSON.parse(shown) as { content: string }).content;
  return shown;
}

function check(after: string, before: string | null = null) {
  return verdict(truncationNoticeGuard().check(change({ before, after }), guardContext()));
}

describe("truncationNoticeGuard", () => {
  test("refuses real read output with a clamp and a continuation note", async () => {
    // Plain formatter: no gutter, so only this guard can see the copy.
    const plain = await readOutput(plainFormatter());
    expect(plain).toContain("[read:continue]");
    expect(check(plain)).toBe("truncation-notice");
    const numbered = await readOutput();
    expect(numbered).toContain("… [line truncated at");
    const withoutNotes = numbered.split("\n\n")[0] as string;
    expect(check(withoutNotes.replaceAll(/^\d+\|/gmu, ""))).toBe("truncation-notice");
  });

  test.each([
    ["hermes clamp marker", hermesFormat()],
    ["deep agents range line", deepAgentsFormat()],
  ])("refuses the %s", async (_name, formatter) => {
    const shown = await readOutput(formatter);
    expect(check(shown.replaceAll(/^\d+\|/gmu, ""))).toBe("truncation-notice");
  });

  test("refuses the end-of-file footer", async () => {
    const fs = memoryFileSystem({ files: { "/f.txt": "a\nb\n" } });
    const read = createReadTool({ fs, formatter: opencodeFormat() });
    const shown = textOf(await read({ path: "/f.txt" }));
    expect(shown).toContain("(End of file - total 2 lines)");
    expect(check("a\nb\n\n(End of file - total 2 lines)\n")).toBe("truncation-notice");
  });

  test.each([
    "[read:line-clamped] Line 2 is longer than 20 characters.",
    "[read:scan-limit] The scan stopped at 1024 bytes.",
    `${LONG}… [line truncated at 40 chars]`,
  ])("refuses %s", (line) => {
    expect(check(`a\n${line}\nc\n`)).toBe("truncation-notice");
  });

  test("near miss: the same words without the note prefix or marker form", () => {
    expect(check("continue with offset 4 to see more\n")).toBe("allow");
    expect(check("read:continue is a note code\n")).toBe("allow");
    expect(check("`[read:continue]` in a sentence\n")).toBe("allow");
    expect(check("line truncated at 40 chars\n")).toBe("allow");
    expect(check("End of file - total 2 lines\n")).toBe("allow");
    expect(check("@@ -1,3 +1,3 @@\n")).toBe("allow");
  });

  test("near miss: a line already in the file", () => {
    const before = "# Output\n\n[read:continue] Continue with offset 4.\n";
    expect(check(`${before}More text.\n`, before)).toBe("allow");
  });

  test("host patterns replace the defaults, and g flags keep no state", () => {
    const guard = truncationNoticeGuard({ patterns: [/^<cut>$/gu] });
    const run = (after: string) => verdict(guard.check(change({ after }), guardContext()));
    expect([run("<cut>\n"), run("<cut>\n"), run("[read:continue] x\n")]).toEqual([
      "truncation-notice",
      "truncation-notice",
      "allow",
    ]);
    expect(() => truncationNoticeGuard({ patterns: ["x"] as never })).toThrow(TypeError);
  });

  test("on by default for write", async () => {
    const { write } = harness();
    const result = await write({
      path: "/n.txt",
      content: "a\n\n[read:continue] Continue with offset 4.\n",
    });
    expect(errorCode(result)).toBe("GUARD_REFUSED");
    expect(errorOf(result)?.data).toMatchObject({ guard: "truncation-notice" });
  });
});
