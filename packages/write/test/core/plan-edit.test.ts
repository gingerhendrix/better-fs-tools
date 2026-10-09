import { describe, expect, test } from "bun:test";

import {
  blockAnchorMatcher,
  defaultEditMatchers,
  indentationMatcher,
  lineTrimmedMatcher,
} from "../../src/index.ts";
import { errorOf, codes, errorCode, harness, note, text } from "../helpers.ts";

const BOM = Uint8Array.of(0xef, 0xbb, 0xbf);

function bytes(...parts: (string | Uint8Array)[]): Uint8Array {
  const chunks = parts.map((part) =>
    typeof part === "string" ? new TextEncoder().encode(part) : part,
  );
  const out = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0));
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.byteLength;
  }
  return out;
}

async function readFile(content: string | Uint8Array, options: Parameters<typeof harness>[0] = {}) {
  const setup = harness({ ...options, files: { "/f.ts": content, ...options.files } });
  await setup.read({ path: "/f.ts" });
  return setup;
}

describe("edit planning", () => {
  test("one exact pair: the file changes and the result names the match", async () => {
    const { edit, fs } = await readFile("a\nb\nc\n");
    const result = await edit({ path: "/f.ts", edits: [{ oldText: "b", newText: "B" }] });
    expect(result.status).toBe("ok");
    expect(text(fs, "/f.ts")).toBe("a\nB\nc\n");
    expect(result.changes[0]?.matches).toEqual([
      { index: 0, matcher: "exact", fuzzy: false, lines: [2, 2], count: 1, replaced: [[2, 2]] },
    ]);
    expect(result.notes).toEqual([]);
  });

  test("an old text found twice without replaceAll is ambiguous and lists the lines", async () => {
    const { edit, fs } = await readFile("x = 1\ny = 2\nx = 1\n");
    const result = await edit({ path: "/f.ts", edits: [{ oldText: "x = 1", newText: "x = 3" }] });
    expect(errorOf(result)).toEqual({
      message: expect.any(String),
      code: "AMBIGUOUS_MATCH",
      phase: "plan",
      data: { index: 0, lines: [1, 3], total: 2 },
    });
    expect(note(result, "ambiguous-match")?.message).toBe(
      "Edit 1: the oldText matches 2 places in /f.ts (lines 1, 3). Add surrounding lines to make it unique, or set replaceAll.",
    );
    expect(text(fs, "/f.ts")).toBe("x = 1\ny = 2\nx = 1\n");
  });

  test("ambiguous: at most maxListedMatches lines, with the true total", async () => {
    const { edit } = await readFile("t\n".repeat(30), {
      deps: { limits: { maxListedMatches: 3 } },
    });
    const result = await edit({ path: "/f.ts", edits: [{ oldText: "t", newText: "u" }] });
    expect(errorOf(result)?.data).toEqual({ index: 0, lines: [1, 2, 3], total: 30 });
    expect(note(result, "ambiguous-match")?.message).toContain("(lines 1, 2, 3, …)");
  });

  test("replaceAll replaces every exact hit", async () => {
    const { edit, fs } = await readFile("x;\ny;\nx;\n");
    const result = await edit({
      path: "/f.ts",
      edits: [{ oldText: "x", newText: "z", replaceAll: true }],
    });
    expect(text(fs, "/f.ts")).toBe("z;\ny;\nz;\n");
    expect(result.changes[0]?.matches[0]).toMatchObject({
      count: 2,
      lines: [1, 1],
      replaced: [
        [1, 1],
        [3, 3],
      ],
    });
  });

  test("replaceAll with one hit is fine", async () => {
    const { edit, fs } = await readFile("only\n");
    await edit({ path: "/f.ts", edits: [{ oldText: "only", newText: "one", replaceAll: true }] });
    expect(text(fs, "/f.ts")).toBe("one\n");
  });

  test("a fuzzy matcher with several hits under replaceAll is refused (Hermes)", async () => {
    const { edit, fs } = await readFile("a \u2014 b\na \u2013 b\n");
    const result = await edit({
      path: "/f.ts",
      edits: [{ oldText: "a - b", newText: "c", replaceAll: true }],
    });
    expect(errorOf(result)).toMatchObject({
      code: "MATCH_REFUSED",
      data: { index: 0, matcher: "normalized", reason: "fuzzy-replace-all" },
    });
    expect(text(fs, "/f.ts")).toBe("a \u2014 b\na \u2013 b\n");
  });

  test("overlapping pairs give OVERLAP with both pair numbers", async () => {
    const { edit } = await readFile("one two three\n");
    const result = await edit({
      path: "/f.ts",
      edits: [
        { oldText: "three", newText: "3" },
        { oldText: "one two", newText: "1 2" },
        { oldText: "two three", newText: "2 3" },
      ],
    });
    expect(errorOf(result)).toMatchObject({ code: "OVERLAP", data: { first: 1, second: 2 } });
    expect(note(result, "overlap")?.message).toBe(
      "Edits 2 and 3 change overlapping text in /f.ts. Merge them into one edit.",
    );
  });

  test("touching ranges are fine", async () => {
    const { edit, fs } = await readFile("abcd\n");
    await edit({
      path: "/f.ts",
      edits: [
        { oldText: "ab", newText: "AB" },
        { oldText: "cd", newText: "CD" },
      ],
    });
    expect(text(fs, "/f.ts")).toBe("ABCD\n");
  });

  test("three pairs against one snapshot, applied from the end", async () => {
    const { edit, fs } = await readFile("alpha\nbeta\ngamma\ndelta\n");
    const result = await edit({
      path: "/f.ts",
      edits: [
        { oldText: "gamma", newText: "G\nG" },
        { oldText: "alpha\n", newText: "" },
        { oldText: "delta", newText: "alpha" },
      ],
    });
    expect(text(fs, "/f.ts")).toBe("beta\nG\nG\nalpha\n");
    expect(
      result.changes[0]?.matches.map((match) => [match.index, match.lines, match.replaced]),
    ).toEqual([
      [0, [3, 3], [[2, 3]]],
      [1, [1, 1], [[1, 1]]],
      [2, [4, 4], [[4, 4]]],
    ]);
  });

  test("a result equal to the file gives NO_CHANGE", async () => {
    const { edit } = await readFile("same\n");
    const result = await edit({ path: "/f.ts", edits: [{ oldText: "same", newText: "same" }] });
    expect(errorOf(result)).toMatchObject({ code: "NO_CHANGE", phase: "plan" });
    expect(note(result, "no-change")?.message).toBe(
      "The edits leave /f.ts as it is. Check the newText values, or do not send the edit.",
    );
  });

  test("a fuzzy hit changes only the matched bytes", async () => {
    const before =
      "// \u201cheader\u201d\u00a0 \nconst a = \u2018x\u2019;  \nconst b = 2;\t\n// tail \u2014 end\n";
    const { edit, fs } = await readFile(before);
    const result = await edit({
      path: "/f.ts",
      edits: [{ oldText: "const a = 'x';\nconst b = 2;", newText: "const a = 'y';\nconst b = 3;" }],
    });
    expect(result.changes[0]?.matches[0]).toMatchObject({
      matcher: "normalized",
      fuzzy: true,
      lines: [2, 3],
    });
    expect(text(fs, "/f.ts")).toBe(
      "// \u201cheader\u201d\u00a0 \nconst a = 'y';\nconst b = 3;\t\n// tail \u2014 end\n",
    );
    expect(note(result, "fuzzy-match")).toEqual({
      code: "fuzzy-match",
      severity: "info",
      message:
        "Edit 1 matched /f.ts at lines 2-3 only with the normalized matcher, not exactly. Check the result.",
      data: { index: 0, matcher: "normalized", lines: [2, 3] },
    });
  });

  test("CRLF files keep CRLF; LF in the new text becomes CRLF", async () => {
    const { edit, fs } = await readFile("one\r\ntwo\r\nthree\r\n");
    const result = await edit({
      path: "/f.ts",
      edits: [{ oldText: "one\r\ntwo\n", newText: "1\n2\r\n2b\n" }],
    });
    expect(result.status).toBe("ok");
    expect(result.changes[0]?.matches[0]?.matcher).toBe("exact");
    expect(text(fs, "/f.ts")).toBe("1\r\n2\r\n2b\r\nthree\r\n");
  });

  test("a BOM survives an edit", async () => {
    const { edit, fs } = await readFile(bytes(BOM, "a\nb\n"));
    await edit({ path: "/f.ts", edits: [{ oldText: "b", newText: "c" }] });
    expect(fs.peek("/f.ts")?.bytes).toEqual(bytes(BOM, "a\nc\n"));
  });

  test("a BOM and CRLF together survive, and untouched bytes stay the same", async () => {
    const { edit, fs } = await readFile(bytes(BOM, "x\u00a0 \r\ny\r\nz\r\n"));
    await edit({ path: "/f.ts", edits: [{ oldText: "y", newText: "Y" }] });
    expect(fs.peek("/f.ts")?.bytes).toEqual(bytes(BOM, "x\u00a0 \r\nY\r\nz\r\n"));
  });

  test("span guard: a fuzzy range far longer than the old text is refused (OpenCode)", async () => {
    const middle = Array.from({ length: 60 }, (_, index) => `  step${index}();`).join("\n");
    const { edit } = await readFile(`start() {\n${middle}\n  step5();\n}\n`, {
      editDeps: { matchers: [blockAnchorMatcher({ maxSpanRatio: 30 })] },
    });
    const result = await edit({
      path: "/f.ts",
      edits: [{ oldText: "start() {\n  step5();\n}", newText: "x" }],
    });
    expect(errorOf(result)).toMatchObject({
      code: "MATCH_REFUSED",
      data: { matcher: "block-anchor", reason: "span" },
    });
  });

  test("boundary guard: a hit that starts inside a folded span is refused", async () => {
    const { edit, fs } = await readFile("de\ufb01ne(x);\n");
    const result = await edit({
      path: "/f.ts",
      edits: [{ oldText: "ine(x);", newText: "ine(y);" }],
    });
    expect(errorOf(result)).toMatchObject({ code: "MATCH_REFUSED", data: { reason: "boundary" } });
    expect(note(result, "match-refused")?.message).toBe(
      "Edit 1: the normalized matcher found the oldText in /f.ts, but the match was refused (the match starts or ends inside normalized text). Copy the oldText exactly from the file.",
    );
    expect(text(fs, "/f.ts")).toBe("de\ufb01ne(x);\n");
  });

  test("escape drift: a fuzzy hit may not add escape sequences the region lacks (Hermes)", async () => {
    const { edit } = await readFile("print(\u201chi\u201d)\n");
    const drift = await edit({
      path: "/f.ts",
      edits: [{ oldText: 'print("hi")', newText: 'print("hi\\n")' }],
    });
    expect(errorOf(drift)).toMatchObject({ code: "MATCH_REFUSED", data: { reason: "escape" } });
    const exact = await readFile('print("hi")\n');
    const allowed = await exact.edit({
      path: "/f.ts",
      edits: [{ oldText: 'print("hi")', newText: 'print("hi\\n")' }],
    });
    expect(allowed.status).toBe("ok");
  });

  test("the escape matcher unescapes a double-escaped pair", async () => {
    const { edit, fs } = await readFile('if (a) {\n\tsay("x");\n}\n');
    const result = await edit({
      path: "/f.ts",
      edits: [{ oldText: 'if (a) {\\n\\tsay(\\"x\\");', newText: 'if (a) {\\n\\tsay(\\"y\\");' }],
    });
    expect(result.changes[0]?.matches[0]?.matcher).toBe("escape");
    expect(text(fs, "/f.ts")).toBe('if (a) {\n\tsay("y");\n}\n');
  });

  test("the first matcher that finds a pair decides", async () => {
    const { edit } = await readFile("a();\n  a();  \n", {
      editDeps: { matchers: [lineTrimmedMatcher(), ...defaultEditMatchers()] },
    });
    const result = await edit({ path: "/f.ts", edits: [{ oldText: "b();", newText: "c();" }] });
    expect(errorCode(result)).toBe("NO_MATCH");
    const found = await edit({ path: "/f.ts", edits: [{ oldText: "a();", newText: "c();" }] });
    expect(errorOf(found)).toMatchObject({ code: "AMBIGUOUS_MATCH", data: { lines: [1, 2] } });
  });
});

describe("opt-in matchers through the tool", () => {
  test("lineTrimmedMatcher", async () => {
    const { edit, fs } = await readFile("fn() {\n    call( 1 );  \n}\n", {
      editDeps: { matchers: [...defaultEditMatchers(), lineTrimmedMatcher()] },
    });
    const result = await edit({
      path: "/f.ts",
      edits: [{ oldText: "call( 1 );", newText: "    call(2);" }],
    });
    expect(result.changes[0]?.matches[0]?.matcher).toBe("exact");
    const trimmed = await edit({
      path: "/f.ts",
      edits: [{ oldText: "fn() {\ncall(2);", newText: "fn() {\n  call(3);" }],
    });
    expect(trimmed.changes[0]?.matches[0]?.matcher).toBe("line-trimmed");
    expect(text(fs, "/f.ts")).toBe("fn() {\n  call(3);\n}\n");
  });

  test("indentationMatcher re-indents the new text", async () => {
    const { edit, fs } = await readFile("class A {\n    run() {\n        go();\n    }\n}\n", {
      editDeps: { matchers: [...defaultEditMatchers(), indentationMatcher()] },
    });
    const result = await edit({
      path: "/f.ts",
      edits: [{ oldText: "run() {\n    go();\n}", newText: "run() {\n    go();\n    stop();\n}" }],
    });
    expect(result.changes[0]?.matches[0]?.matcher).toBe("indentation");
    expect(text(fs, "/f.ts")).toBe(
      "class A {\n    run() {\n        go();\n        stop();\n    }\n}\n",
    );
  });

  test("blockAnchorMatcher", async () => {
    const { edit, fs } = await readFile("f() {\n  one();\n  two();\n  three();\n}\nrest\n", {
      editDeps: { matchers: [...defaultEditMatchers(), blockAnchorMatcher()] },
    });
    const result = await edit({
      path: "/f.ts",
      edits: [{ oldText: "f() {\n  one();\n  TWO();\n  three();\n}", newText: "f() {}" }],
    });
    expect(result.changes[0]?.matches[0]?.matcher).toBe("block-anchor");
    expect(text(fs, "/f.ts")).toBe("f() {}\nrest\n");
  });
});

describe("failure help", () => {
  test("already applied: a no-change result with a note, nothing written", async () => {
    const { edit, fs, state } = await readFile("const a = 2;\n");
    const record = await state.get("/f.ts");
    const version = fs.peek("/f.ts")?.version;
    const result = await edit({
      path: "/f.ts",
      edits: [{ oldText: "const a = 1;", newText: "const a = 2;" }],
    });
    expect(result.status).toBe("no-change");
    expect(result.unchanged).toEqual(["/f.ts"]);
    expect(note(result, "already-applied")).toEqual({
      code: "already-applied",
      severity: "info",
      message:
        "Edit 1 is already applied: the newText is in /f.ts and the oldText is not. Do not send this edit again.",
      data: { index: 0 },
    });
    expect(fs.peek("/f.ts")?.version).toBe(version);
    expect(await state.get("/f.ts")).toEqual(record);
  });

  test("one pair already applied, the other applied now", async () => {
    const { edit, fs } = await readFile("a = 2;\nb = 1;\n");
    const result = await edit({
      path: "/f.ts",
      edits: [
        { oldText: "a = 1;", newText: "a = 2;" },
        { oldText: "b = 1;", newText: "b = 2;" },
      ],
    });
    expect(result.status).toBe("ok");
    expect(codes(result)).toEqual(["already-applied"]);
    expect(result.changes[0]?.matches.map((match) => match.index)).toEqual([1]);
    expect(text(fs, "/f.ts")).toBe("a = 2;\nb = 2;\n");
  });

  test("not already applied when the new text is empty or found twice", async () => {
    const { edit } = await readFile("x\nx\n");
    expect(errorCode(await edit({ path: "/f.ts", edits: [{ oldText: "y", newText: "x" }] }))).toBe(
      "NO_MATCH",
    );
    expect(errorCode(await edit({ path: "/f.ts", edits: [{ oldText: "y", newText: "" }] }))).toBe(
      "NO_MATCH",
    );
  });

  test("NO_MATCH names a trailing newline difference", async () => {
    const { edit } = await readFile("a\nlast line");
    const result = await edit({
      path: "/f.ts",
      edits: [{ oldText: "last line\n", newText: "end\n" }],
    });
    expect(errorOf(result)).toMatchObject({
      code: "NO_MATCH",
      data: { index: 0, trailingNewline: "extra" },
    });
    expect(note(result, "no-match")?.message).toContain("It differs only by a trailing newline.");
  });

  test("NO_MATCH shows the closest region", async () => {
    const { edit } = await readFile(
      "function a() {\n  return 1;\n}\n\nfunction b() {\n  return 2;\n}\n",
    );
    const result = await edit({
      path: "/f.ts",
      edits: [{ oldText: "function b() {\n  return 3;\n}", newText: "x" }],
    });
    expect(errorOf(result)).toEqual({
      message: expect.any(String),
      code: "NO_MATCH",
      phase: "plan",
      data: { index: 0, closest: [4, 7] },
    });
    expect(note(result, "no-match")?.message).toBe(
      [
        "Edit 1: the oldText was not found in /f.ts.",
        "The closest region is:",
        "4|",
        "5|function b() {",
        "6|  return 2;",
        "7|}",
      ].join("\n"),
    );
  });

  test("the third miss in a row on a path adds a repeated-miss note", async () => {
    const { edit } = await readFile("a\nb\n", { files: { "/g.ts": "g\n" } });
    const miss = { path: "/f.ts", edits: [{ oldText: "zzz", newText: "y" }] };
    expect(codes(await edit(miss))).toEqual(["no-match"]);
    expect(codes(await edit(miss))).toEqual(["no-match"]);
    const third = await edit(miss);
    expect(codes(third)).toEqual(["no-match", "repeated-miss"]);
    expect(note(third, "repeated-miss")?.message).toBe(
      "This is miss 3 in a row on /f.ts. Read the file again, include more surrounding lines, or replace the file with the write tool.",
    );
    expect(codes(await edit(miss))).toEqual(["no-match", "repeated-miss"]);
    await edit({ path: "/f.ts", edits: [{ oldText: "a", newText: "A" }] });
    expect(codes(await edit(miss))).toEqual(["no-match"]);
  });

  test("misses count for each path and each tool instance", async () => {
    const first = await readFile("a\n", { files: { "/g.ts": "g\n" } });
    await first.read({ path: "/g.ts" });
    const miss = (path: string) => ({ path, edits: [{ oldText: "zzz", newText: "y" }] });
    await first.edit(miss("/f.ts"));
    await first.edit(miss("/f.ts"));
    expect(codes(await first.edit(miss("/g.ts")))).toEqual(["no-match"]);
    const second = await readFile("a\n");
    await second.edit(miss("/f.ts"));
    expect(codes(await second.edit(miss("/f.ts")))).toEqual(["no-match"]);
    expect(codes(await first.edit(miss("/f.ts")))).toEqual(["no-match", "repeated-miss"]);
  });
});

describe("edit targets and records", () => {
  test("a missing file gives NOT_FOUND that points to write", async () => {
    const { edit } = harness();
    const result = await edit({ path: "/new.ts", edits: [{ oldText: "a", newText: "b" }] });
    expect(errorOf(result)).toMatchObject({ code: "NOT_FOUND", phase: "stat" });
    expect(note(result, "not-found")?.message).toBe(
      "/new.ts does not exist. Use the write tool to create it.",
    );
  });

  test("an unread file gives NOT_READ", async () => {
    const { edit } = harness({ files: { "/f.ts": "a\n" } });
    const result = await edit({ path: "/f.ts", edits: [{ oldText: "a", newText: "b" }] });
    expect(errorOf(result)).toMatchObject({ code: "NOT_READ", phase: "precondition" });
  });

  test("a partial read is enough for edit", async () => {
    const { read, edit, fs } = harness({ files: { "/f.ts": "a\nb\nc\n" } });
    await read({ path: "/f.ts", offset: 3, limit: 1 });
    expect((await edit({ path: "/f.ts", edits: [{ oldText: "a", newText: "A" }] })).status).toBe(
      "ok",
    );
    expect(text(fs, "/f.ts")).toBe("A\nb\nc\n");
  });

  test("a second edit needs no read", async () => {
    const { edit, fs } = await readFile("one\ntwo\n");
    expect((await edit({ path: "/f.ts", edits: [{ oldText: "one", newText: "1" }] })).status).toBe(
      "ok",
    );
    expect((await edit({ path: "/f.ts", edits: [{ oldText: "two", newText: "2" }] })).status).toBe(
      "ok",
    );
    expect(text(fs, "/f.ts")).toBe("1\n2\n");
  });

  test("an edit after a partial read keeps the record partial", async () => {
    const { read, edit, write, state } = harness({ files: { "/f.ts": "a\nb\n" } });
    await read({ path: "/f.ts", limit: 1 });
    await edit({ path: "/f.ts", edits: [{ oldText: "a", newText: "A" }] });
    expect((await state.get("/f.ts"))?.wholeFileVisible).toBe(false);
    expect(errorOf(await write({ path: "/f.ts", content: "x" }))).toMatchObject({
      code: "NOT_READ",
      data: { wholeFile: true },
    });
  });

  test("a non-text file gives NOT_TEXT", async () => {
    const { edit } = await readFile("x", {
      files: { "/b.bin": Uint8Array.of(0, 1, 2) },
      deps: { preconditions: { requireRead: "off" } },
    });
    const result = await edit({ path: "/b.bin", edits: [{ oldText: "a", newText: "b" }] });
    expect(errorCode(result)).toBe("NOT_TEXT");
  });
});

describe("edit on a stale record", () => {
  const rematch = { deps: { preconditions: { onStale: "rematch" as const } } };

  test("every old text still matches exactly once: applied with a note", async () => {
    const { edit, fs } = await readFile("one\ntwo\nthree\n", rematch);
    fs.setFile("/f.ts", "zero\none\ntwo\nthree\n");
    const result = await edit({ path: "/f.ts", edits: [{ oldText: "two", newText: "2" }] });
    expect(result.status).toBe("ok");
    expect(text(fs, "/f.ts")).toBe("zero\none\n2\nthree\n");
    expect(note(result, "stale-rematched")).toEqual({
      code: "stale-rematched",
      severity: "info",
      message:
        "/f.ts changed since it was last read, but every old text still matched exactly once, so the edit was applied.",
    });
  });

  test("the rematch is exact only: a fuzzy hit gives STALE", async () => {
    const { edit, fs } = await readFile("a \u2014 b\n", rematch);
    fs.setFile("/f.ts", "x\na \u2014 b\n");
    const result = await edit({ path: "/f.ts", edits: [{ oldText: "a - b", newText: "c" }] });
    expect(errorOf(result)).toMatchObject({
      code: "STALE",
      phase: "precondition",
      data: { index: 0 },
    });
    expect(text(fs, "/f.ts")).toBe("x\na \u2014 b\n");
  });

  test("an old text that now matches twice gives STALE", async () => {
    const { edit, fs } = await readFile("key = 1\n", rematch);
    fs.setFile("/f.ts", "key = 1\nkey = 1\n");
    const result = await edit({
      path: "/f.ts",
      edits: [{ oldText: "key = 1", newText: "key = 2" }],
    });
    expect(errorCode(result)).toBe("STALE");
  });

  test("replaceAll needs at least one exact hit", async () => {
    const { edit, fs } = await readFile("k\n", rematch);
    fs.setFile("/f.ts", "k\nk\n");
    const all = await edit({
      path: "/f.ts",
      edits: [{ oldText: "k", newText: "q", replaceAll: true }],
    });
    expect(all.status).toBe("ok");
    expect(text(fs, "/f.ts")).toBe("q\nq\n");
  });

  test("an already applied pair on a stale record gives STALE, not no-change", async () => {
    const { edit, fs } = await readFile("a = 1\n", rematch);
    fs.setFile("/f.ts", "a = 2\n");
    const result = await edit({ path: "/f.ts", edits: [{ oldText: "a = 1", newText: "a = 2" }] });
    expect(errorCode(result)).toBe("STALE");
  });

  test("by default a stale record gives STALE without a rematch", async () => {
    const { edit, fs } = await readFile("one\n");
    fs.setFile("/f.ts", "one\ntwo\n");
    const result = await edit({ path: "/f.ts", edits: [{ oldText: "one", newText: "1" }] });
    expect(errorOf(result)).toMatchObject({ code: "STALE", phase: "precondition" });
    expect(errorOf(result)?.data).toBeUndefined();
  });

  test("after a rematch the record is not whole: write needs a read, edit does not", async () => {
    const { edit, write, fs, state } = await readFile("one\n", rematch);
    fs.setFile("/f.ts", "one\nsomeone else's line\n");
    await edit({ path: "/f.ts", edits: [{ oldText: "one\n", newText: "1\n" }] });
    expect((await state.get("/f.ts"))?.wholeFileVisible).toBe(false);
    expect(errorOf(await write({ path: "/f.ts", content: "mine\n" }))).toMatchObject({
      code: "NOT_READ",
      data: { wholeFile: true },
    });
    expect((await edit({ path: "/f.ts", edits: [{ oldText: "1", newText: "one" }] })).status).toBe(
      "ok",
    );
    expect(text(fs, "/f.ts")).toBe("one\nsomeone else's line\n");
  });
});
