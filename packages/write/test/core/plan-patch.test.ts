import { describe, expect, spyOn, test } from "bun:test";

import { textOf } from "@better-fs-tools/read";

import { executableShebang, lineTrimmedMatcher, recommendedGuards } from "../../src/index.ts";
import type { WriteAuthorizeTarget } from "../../src/index.ts";
import type { PatchParser } from "../../src/patch/index.ts";
import { errorOf, codes, errorCode, harness, note, patchText, text } from "../helpers.ts";

const BOM = Uint8Array.of(0xef, 0xbb, 0xbf);
const ENCODER = new TextEncoder();

function bytes(...parts: (string | Uint8Array)[]): Uint8Array {
  const chunks = parts.map((part) => (typeof part === "string" ? ENCODER.encode(part) : part));
  const out = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0));
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.byteLength;
  }
  return out;
}

async function readAll(
  files: Record<string, string | Uint8Array>,
  options: Parameters<typeof harness>[0] = {},
) {
  const setup = harness({ ...options, files });
  for (const path of Object.keys(files)) await setup.read({ path });
  return setup;
}

function snapshot(setup: ReturnType<typeof harness>, paths: readonly string[]) {
  return paths.map((path) => setup.fs.peek(path));
}

describe("hunk verification", () => {
  test("an Update replaces the matched lines and reports the hunk", async () => {
    const { applyPatch, fs } = await readAll({ "/a.ts": "one\ntwo\nthree\n" });
    const result = await applyPatch({
      patch: patchText("*** Update File: /a.ts", "@@", " one", "-two", "+TWO", " three"),
    });
    expect(result.status).toBe("ok");
    expect(text(fs, "/a.ts")).toBe("one\nTWO\nthree\n");
    expect(result.changes[0]).toMatchObject({
      kind: "update",
      path: "/a.ts",
      movedFrom: null,
      linesAdded: 1,
      linesRemoved: 1,
      matches: [
        { index: 0, matcher: "exact", fuzzy: false, lines: [1, 3], count: 1, replaced: [[1, 3]] },
      ],
    });
    expect(textOf(result)).toBe("Success. Updated the following files:\nM /a.ts");
  });

  test("a bad third hunk changes nothing", async () => {
    const files = { "/a.ts": "a1\na2\n", "/b.ts": "b1\nb2\n", "/c.ts": "c1\nc2\n" };
    const setup = await readAll(files);
    const before = snapshot(setup, ["/a.ts", "/b.ts", "/c.ts", "/new.ts"]);
    const result = await setup.applyPatch({
      patch: patchText(
        "*** Add File: /new.ts",
        "+new",
        "*** Update File: /a.ts",
        "@@",
        "-a1",
        "+A1",
        "*** Update File: /b.ts",
        "@@",
        "-b1",
        "+B1",
        "@@",
        "-b2",
        "+B2",
        "@@",
        "-missing",
        "+X",
        "*** Delete File: /c.ts",
      ),
    });
    expect(errorOf(result)).toMatchObject({ code: "PATCH_VERIFY", phase: "plan" });
    expect(note(result, "patch-verify")?.message).toBe(
      [
        "Patch validation failed (no files were modified):",
        "- /b.ts: hunk 3: failed to find the expected lines:",
        "    missing",
      ].join("\n"),
    );
    expect(errorOf(result)?.data).toEqual({
      problems: [{ path: "/b.ts", reason: "lines-not-found", hunk: 2 }],
    });
    expect(result.changes).toEqual([]);
    expect(snapshot(setup, ["/a.ts", "/b.ts", "/c.ts", "/new.ts"])).toEqual(before);
  });

  test("each hunk takes the first match after the previous hunk", async () => {
    const { applyPatch, fs } = await readAll({ "/a.ts": "x\ny\nx\ny\nx\ny\n" });
    const result = await applyPatch({
      patch: patchText("*** Update File: /a.ts", "@@", "-x", "+X1", "@@", "-x", "+X2"),
    });
    expect(text(fs, "/a.ts")).toBe("X1\ny\nX2\ny\nx\ny\n");
    expect(result.changes[0]?.matches.map((match) => match.lines)).toEqual([
      [1, 1],
      [3, 3],
    ]);
  });

  test("an ambiguous block is not refused; the @@ context line moves the cursor", async () => {
    const source = [
      "function a() {",
      "  return 1;",
      "}",
      "function b() {",
      "  return 1;",
      "}",
      "",
    ].join("\n");
    const { applyPatch, fs } = await readAll({ "/a.ts": source });
    await applyPatch({
      patch: patchText(
        "*** Update File: /a.ts",
        "@@ function b() {",
        "-  return 1;",
        "+  return 2;",
      ),
    });
    expect(text(fs, "/a.ts")).toBe(source.replace("b() {\n  return 1;", "b() {\n  return 2;"));
    expect(text(fs, "/a.ts")).toContain("function a() {\n  return 1;");
  });

  test("a hunk before the cursor is not found, even when it is in the file", async () => {
    const { applyPatch, fs } = await readAll({ "/a.ts": "a\nb\nc\n" });
    const result = await applyPatch({
      patch: patchText("*** Update File: /a.ts", "@@", "-c", "+C", "@@", "-a", "+A"),
    });
    expect(errorCode(result)).toBe("PATCH_VERIFY");
    expect(note(result, "patch-verify")?.message).toContain(
      "hunk 2: failed to find the expected lines",
    );
    expect(text(fs, "/a.ts")).toBe("a\nb\nc\n");
  });

  test("a missing context line is a problem", async () => {
    const { applyPatch } = await readAll({ "/a.ts": "a\n" });
    const result = await applyPatch({
      patch: patchText("*** Update File: /a.ts", "@@ class Missing", "-a", "+b"),
    });
    expect(note(result, "patch-verify")?.message).toBe(
      'Patch validation failed (no files were modified):\n- /a.ts: hunk 1: failed to find the context line "class Missing".',
    );
    expect(errorOf(result)?.data).toEqual({
      problems: [{ path: "/a.ts", reason: "context-not-found", hunk: 0 }],
    });
  });

  test("*** End of File matches the block that ends the file", async () => {
    const { applyPatch, fs } = await readAll({ "/a.ts": "end\nmid\nend\n" });
    await applyPatch({
      patch: patchText("*** Update File: /a.ts", "@@", "-end", "+END", "*** End of File"),
    });
    expect(text(fs, "/a.ts")).toBe("end\nmid\nEND\n");
  });

  test("*** End of File with a block that is not at the end is not found", async () => {
    const { applyPatch } = await readAll({ "/a.ts": "a\nb\n" });
    const result = await applyPatch({
      patch: patchText("*** Update File: /a.ts", "@@", "-a", "+A", "*** End of File"),
    });
    expect(errorCode(result)).toBe("PATCH_VERIFY");
  });

  test("a trailing empty old line that is not in the file is dropped and retried (Codex)", async () => {
    const { applyPatch, fs } = await readAll({ "/a.ts": "a\nb" });
    const result = await applyPatch({
      patch: patchText("*** Update File: /a.ts", "@@", " a", "-b", "+B", ""),
    });
    expect(result.status).toBe("ok");
    expect(text(fs, "/a.ts")).toBe("a\nB");
  });

  test("a hunk of added lines goes after its @@ line, or at the end of the file without one", async () => {
    const { applyPatch, fs } = await readAll({ "/a.ts": "head\nbody\ntail\n" });
    await applyPatch({ patch: patchText("*** Update File: /a.ts", "@@ head", "+after head") });
    expect(text(fs, "/a.ts")).toBe("head\nafter head\nbody\ntail\n");
    await applyPatch({ patch: patchText("*** Update File: /a.ts", "+appended") });
    expect(text(fs, "/a.ts")).toBe("head\nafter head\nbody\ntail\nappended\n");
  });

  test("the final-newline state is kept; an empty file gains one", async () => {
    const { applyPatch, fs } = await readAll({ "/no-eol.ts": "a\nb", "/empty.ts": "" });
    await applyPatch({
      patch: patchText(
        "*** Update File: /no-eol.ts",
        "@@",
        "-b",
        "+B",
        "*** Update File: /empty.ts",
        "+first",
      ),
    });
    expect(text(fs, "/no-eol.ts")).toBe("a\nB");
    expect(text(fs, "/empty.ts")).toBe("first\n");
  });

  test("removing every line leaves an empty file", async () => {
    const { applyPatch, fs } = await readAll({ "/a.ts": "a\nb\n" });
    await applyPatch({ patch: patchText("*** Update File: /a.ts", "@@", "-a", "-b") });
    expect(text(fs, "/a.ts")).toBe("");
  });
});

describe("bytes the patch does not name stay the same", () => {
  test("context lines keep their original bytes after a fuzzy match", async () => {
    const source = "if (a) {  \n  say(“hi”);\n}\n";
    const { applyPatch, fs } = await readAll({ "/a.ts": source });
    const result = await applyPatch({
      patch: patchText(
        "*** Update File: /a.ts",
        "@@",
        " if (a) {",
        '-  say("hi");',
        '+  say("bye");',
        " }",
      ),
    });
    expect(text(fs, "/a.ts")).toBe('if (a) {  \n  say("bye");\n}\n');
    expect(result.changes[0]?.matches[0]).toMatchObject({ matcher: "normalized", fuzzy: true });
    expect(note(result, "fuzzy-match")).toEqual({
      code: "fuzzy-match",
      severity: "info",
      message:
        "Hunk 1 matched /a.ts at lines 1-3 only with the normalized matcher, not exactly. Check the result.",
      data: { path: "/a.ts", hunk: 0, matcher: "normalized" },
    });
    expect(textOf(result)).toStartWith(
      "Success. Updated the following files:\nM /a.ts (hunk 1 matched by normalized)",
    );
  });

  test("the line-trimmed matcher is the last stage of the default chain", async () => {
    const { applyPatch, fs } = await readAll({ "/a.py": "def f():\n    return 1\n" });
    const result = await applyPatch({
      patch: patchText("*** Update File: /a.py", "@@", " def f():", "-return 1", "+    return 2"),
    });
    expect(text(fs, "/a.py")).toBe("def f():\n    return 2\n");
    expect(result.changes[0]?.matches[0]?.matcher).toBe("line-trimmed");
  });

  test("$ sequences in + lines stay literal", async () => {
    const { applyPatch, fs } = await readAll({ "/a.ts": "x\n" });
    await applyPatch({
      patch: patchText(
        "*** Update File: /a.ts",
        "@@",
        "-x",
        "+s.replace(/a/, '$&$1$$$`')",
        "*** Add File: /b.ts",
        "+$& $' $1",
      ),
    });
    expect(text(fs, "/a.ts")).toBe("s.replace(/a/, '$&$1$$$`')\n");
    expect(text(fs, "/b.ts")).toBe("$& $' $1\n");
  });

  test("CRLF and a BOM survive an update, from an LF or a CRLF patch", async () => {
    const { applyPatch, fs } = await readAll({ "/a.ts": bytes(BOM, "a\r\nb\r\nc\r\n") });
    await applyPatch({ patch: patchText("*** Update File: /a.ts", "@@", " a", "-b", "+B") });
    expect(fs.peek("/a.ts")?.bytes).toEqual(bytes(BOM, "a\r\nB\r\nc\r\n"));
    const crlf = patchText("*** Update File: /a.ts", "@@", "-c", "+C", "+D").replaceAll(
      "\n",
      "\r\n",
    );
    await applyPatch({ patch: crlf });
    expect(fs.peek("/a.ts")?.bytes).toEqual(bytes(BOM, "a\r\nB\r\nC\r\nD\r\n"));
  });

  test("a mixed-EOL file keeps the CR of every context line", async () => {
    const { applyPatch, fs } = await readAll({ "/a.ts": "a\r\nb\nc\r\n" });
    await applyPatch({ patch: patchText("*** Update File: /a.ts", "@@", " a", "-b", "+B", " c") });
    expect(text(fs, "/a.ts")).toBe("a\r\nB\nc\r\n");
  });

  test("an Add is written in the new-file style, as given", async () => {
    const { applyPatch, fs } = harness();
    await applyPatch({ patch: patchText("*** Add File: /n.txt", "+a", "+", "+b") });
    expect(text(fs, "/n.txt")).toBe("a\n\nb\n");
  });
});

describe("existence problems", () => {
  test("an Add on an existing file is refused and points to Update or write", async () => {
    const setup = await readAll({ "/a.ts": "a\n" });
    const before = snapshot(setup, ["/a.ts"]);
    const result = await setup.applyPatch({ patch: patchText("*** Add File: /a.ts", "+b") });
    expect(errorCode(result)).toBe("PATCH_VERIFY");
    expect(note(result, "patch-verify")?.message).toBe(
      "Patch validation failed (no files were modified):\n- /a.ts already exists. Use *** Update File, or the write tool to replace it.",
    );
    expect(snapshot(setup, ["/a.ts"])).toEqual(before);
  });

  test("an Update or Delete on a missing file, and a move onto an existing file", async () => {
    const { applyPatch, fs } = await readAll({ "/src.ts": "s\n", "/taken.ts": "t\n" });
    const result = await applyPatch({
      patch: patchText(
        "*** Update File: /missing.ts",
        "@@",
        "-a",
        "*** Delete File: /gone.ts",
        "*** Update File: /src.ts",
        "*** Move to: /taken.ts",
      ),
    });
    expect(note(result, "patch-verify")?.message).toBe(
      [
        "Patch validation failed (no files were modified):",
        "- /missing.ts does not exist. Use *** Add File to create it.",
        "- /gone.ts does not exist, so it cannot be deleted.",
        "- /taken.ts already exists, so /src.ts cannot move there. Choose another path, or delete /taken.ts first.",
      ].join("\n"),
    );
    expect(errorOf(result)?.data).toEqual({
      problems: [
        { path: "/missing.ts", reason: "not-found" },
        { path: "/gone.ts", reason: "not-found" },
        { path: "/taken.ts", reason: "move-exists" },
      ],
    });
    expect(text(fs, "/src.ts")).toBe("s\n");
    expect(text(fs, "/taken.ts")).toBe("t\n");
  });

  test("duplicate targets stop the call before any authorize or content read", async () => {
    const setup = await readAll({ "/a.ts": "a\n", "/b.ts": "b\n" });
    const open = spyOn(setup.fs, "open");
    const result = await setup.applyPatch({
      patch: patchText(
        "*** Update File: /a.ts",
        "@@",
        "-a",
        "+A",
        "*** Delete File: /./a.ts",
        "*** Update File: /b.ts",
        "*** Move to: /a.ts",
      ),
    });
    expect(note(result, "patch-verify")?.message).toBe(
      "Patch validation failed (no files were modified):\n- /./a.ts: multiple operations target this file.",
    );
    expect(open).not.toHaveBeenCalled();
  });

  test("a backend without remove() refuses Delete and Move at verify", async () => {
    const { applyPatch } = await readAll(
      { "/a.ts": "a\n", "/b.ts": "b\n" },
      {
        fsOptions: { remove: false },
      },
    );
    const result = await applyPatch({
      patch: patchText("*** Delete File: /a.ts", "*** Update File: /b.ts", "*** Move to: /c.ts"),
    });
    expect(errorOf(result)?.data).toEqual({
      problems: [
        { path: "/a.ts", reason: "unsupported" },
        { path: "/b.ts", reason: "unsupported" },
      ],
    });
  });

  test("problems stop at limits.maxPatchProblems", async () => {
    const setup = await readAll(
      { "/a.ts": "a\n" },
      { patchDeps: { limits: { maxPatchProblems: 2 } } },
    );
    const result = await setup.applyPatch({
      patch: patchText(
        "*** Delete File: /x1",
        "*** Delete File: /x2",
        "*** Delete File: /x3",
        "*** Update File: /a.ts",
        "@@",
        "-nope",
      ),
    });
    expect(note(result, "patch-verify")?.message.split("\n")).toHaveLength(3);
    expect(errorOf(result)?.data?.problems).toHaveLength(2);
  });
});

describe("Delete, Move, and records", () => {
  test("Delete removes the file and its record; a move stores the destination and drops the source", async () => {
    const setup = await readAll({ "/del.ts": "d\n", "/from.ts": "f\n" });
    const result = await setup.applyPatch({
      patch: patchText(
        "*** Delete File: /del.ts",
        "*** Update File: /from.ts",
        "*** Move to: /dir/to.ts",
        "@@",
        "-f",
        "+F",
      ),
    });
    expect(result.status).toBe("ok");
    expect(setup.fs.peek("/del.ts")).toBeNull();
    expect(setup.fs.peek("/from.ts")).toBeNull();
    expect(text(setup.fs, "/dir/to.ts")).toBe("F\n");
    expect(await setup.state.get("/del.ts")).toBeNull();
    expect(await setup.state.get("/from.ts")).toBeNull();
    expect(await setup.state.get("/dir/to.ts")).toMatchObject({
      origin: "write",
      wholeFileVisible: true,
    });
    expect(result.changes.map(({ kind, path, movedFrom }) => ({ kind, path, movedFrom }))).toEqual([
      { kind: "delete", path: "/del.ts", movedFrom: null },
      { kind: "move", path: "/dir/to.ts", movedFrom: "/from.ts" },
    ]);
    expect(result.changes[1]?.diff).toStartWith("--- a/from.ts\n+++ b/dir/to.ts\n");
    expect(textOf(result)).toBe(
      "Success. Updated the following files:\nD /del.ts\nM /dir/to.ts (moved from /from.ts)",
    );
  });

  test("a move without hunks keeps the bytes and the mode", async () => {
    const setup = harness({ files: { "/a.sh": bytes(BOM, "x\r\n") } });
    setup.fs.setFile("/a.sh", bytes(BOM, "x\r\n"), { mode: 0o700 });
    await setup.read({ path: "/a.sh" });
    const result = await setup.applyPatch({
      patch: patchText("*** Update File: /a.sh", "*** Move to: /b.sh"),
    });
    expect(result.changes[0]).toMatchObject({ kind: "move", linesAdded: 0, linesRemoved: 0 });
    expect(setup.fs.peek("/b.sh")).toMatchObject({ bytes: bytes(BOM, "x\r\n"), mode: 0o700 });
  });

  test("an Add records the whole file; a following Update needs no read", async () => {
    const { applyPatch, fs, state } = harness();
    await applyPatch({ patch: patchText("*** Add File: /n.ts", "+a") });
    expect(await state.get("/n.ts")).toMatchObject({ wholeFileVisible: true });
    const second = await applyPatch({
      patch: patchText("*** Update File: /n.ts", "@@", "-a", "+b"),
    });
    expect(second.status).toBe("ok");
    expect(text(fs, "/n.ts")).toBe("b\n");
  });

  test("an Update that changes nothing is no-change and writes nothing", async () => {
    const setup = await readAll({ "/a.ts": "a\n" });
    const before = snapshot(setup, ["/a.ts"]);
    const result = await setup.applyPatch({
      patch: patchText("*** Update File: /a.ts", "@@", "-a", "+a"),
    });
    expect(result.status).toBe("no-change");
    expect(result.unchanged).toEqual(["/a.ts"]);
    expect(textOf(result)).toBe("No change to /a.ts.");
    expect(snapshot(setup, ["/a.ts"])).toEqual(before);
  });
});

describe("preconditions", () => {
  const rematch = { patchDeps: { preconditions: { onStale: "rematch" as const } } };

  test("an unread Update or Delete gives NOT_READ naming every path; an Add needs no read", async () => {
    const setup = harness({ files: { "/a.ts": "a\n", "/b.ts": "b\n" } });
    const result = await setup.applyPatch({
      patch: patchText(
        "*** Add File: /n.ts",
        "+n",
        "*** Update File: /a.ts",
        "@@",
        "-a",
        "*** Delete File: /b.ts",
      ),
    });
    expect(errorOf(result)).toEqual({
      message: expect.any(String),
      code: "NOT_READ",
      phase: "precondition",
      data: {
        failures: [
          { path: "/a.ts", code: "NOT_READ" },
          { path: "/b.ts", code: "NOT_READ" },
        ],
      },
    });
    expect(note(result, "not-read")?.message).toBe(
      "Read /a.ts with the read tool before changing it.\nRead /b.ts with the read tool before changing it.",
    );
    expect(setup.fs.peek("/n.ts")).toBeNull();
  });

  test("a partial read is enough for apply_patch", async () => {
    const setup = harness({ files: { "/a.ts": "a\nb\nc\n" } });
    await setup.read({ path: "/a.ts", limit: 1 });
    const result = await setup.applyPatch({
      patch: patchText("*** Update File: /a.ts", "@@", "-c", "+C"),
    });
    expect(result.status).toBe("ok");
    expect(await setup.state.get("/a.ts")).toMatchObject({ wholeFileVisible: false });
  });

  test("a stale file is patched when every hunk matches exactly", async () => {
    const setup = await readAll({ "/a.ts": "a\nb\n" }, rematch);
    setup.fs.setFile("/a.ts", "a\nb\nextra\n");
    const result = await setup.applyPatch({
      patch: patchText("*** Update File: /a.ts", "@@", "-a", "+A"),
    });
    expect(result.status).toBe("ok");
    expect(text(setup.fs, "/a.ts")).toBe("A\nb\nextra\n");
    expect(codes(result)).toContain("stale-rematched");
    expect(await setup.state.get("/a.ts")).toMatchObject({ wholeFileVisible: false });
  });

  test("on a stale file only the exact matcher runs; a miss gives STALE", async () => {
    const setup = await readAll({ "/a.ts": "a\nb\n" }, rematch);
    setup.fs.setFile("/a.ts", "a  \nb\n");
    const result = await setup.applyPatch({
      patch: patchText("*** Update File: /a.ts", "@@", "-a", "+A"),
    });
    expect(errorOf(result)).toEqual({
      message: expect.any(String),
      code: "STALE",
      phase: "precondition",
      data: { path: "/a.ts", hunk: 0 },
    });
    expect(text(setup.fs, "/a.ts")).toBe("a  \nb\n");
  });

  test("a stale Delete gives STALE: no hunk shows the model saw the change", async () => {
    const setup = await readAll({ "/a.ts": "a\n" });
    setup.fs.setFile("/a.ts", "changed\n");
    const result = await setup.applyPatch({ patch: patchText("*** Delete File: /a.ts") });
    expect(errorCode(result)).toBe("STALE");
    expect(text(setup.fs, "/a.ts")).toBe("changed\n");
  });

  test("by default a stale file gives STALE before any hunk runs", async () => {
    const setup = await readAll({ "/a.ts": "a\n" });
    setup.fs.setFile("/a.ts", "a\nb\n");
    const result = await setup.applyPatch({
      patch: patchText("*** Update File: /a.ts", "@@", "-a", "+A"),
    });
    expect(errorOf(result)).toMatchObject({ code: "STALE", phase: "precondition" });
  });
});

describe("guards, authorize, and hooks", () => {
  test("guards run on every planned change; a refusal writes nothing", async () => {
    const seen: string[] = [];
    const setup = await readAll(
      { "/a.ts": "a\n", "/b.ts": "b\n" },
      {
        deps: {
          guards: [
            {
              id: "spy",
              check: (change) => {
                seen.push(`${change.kind} ${change.displayPath}`);
                return change.kind === "delete"
                  ? {
                      allow: false,
                      note: { code: "no-delete", severity: "warning", message: "No." },
                    }
                  : { allow: true };
              },
            },
          ],
        },
      },
    );
    const result = await setup.applyPatch({
      patch: patchText(
        "*** Add File: /n.ts",
        "+n",
        "*** Update File: /a.ts",
        "@@",
        "-a",
        "+A",
        "*** Delete File: /b.ts",
      ),
    });
    expect(seen).toEqual(["create /n.ts", "update /a.ts", "delete /b.ts"]);
    expect(errorOf(result)).toMatchObject({ code: "GUARD_REFUSED", phase: "guards" });
    expect(setup.fs.peek("/n.ts")).toBeNull();
    expect(text(setup.fs, "/a.ts")).toBe("a\n");
  });

  test("the recommended guards check patch fragments", async () => {
    const { applyPatch, fs } = await readAll(
      { "/a.ts": "a\nb\n" },
      { deps: { guards: recommendedGuards() } },
    );
    const result = await applyPatch({
      patch: patchText("*** Update File: /a.ts", "@@", "-a", "-b", "+1|a", "+2|b"),
    });
    expect(errorOf(result)).toMatchObject({ code: "GUARD_REFUSED" });
    expect(text(fs, "/a.ts")).toBe("a\nb\n");
  });

  test("access targets in patch order: a move is move on the source and create on the destination", async () => {
    const access: string[] = [];
    const change: string[] = [];
    const setup = await readAll(
      { "/u.ts": "u\n", "/d.ts": "d\n", "/m.ts": "m\n" },
      {
        deps: {
          authorize: {
            id: "spy",
            authorize: (target: WriteAuthorizeTarget) => {
              const entry = `${target.action} ${target.requestedPath}`;
              if (target.change === null) access.push(entry);
              else change.push(`${entry} ${target.plan.length}`);
              return { allow: true };
            },
          },
        },
      },
    );
    await setup.applyPatch({
      patch: patchText(
        "*** Add File: /n.ts",
        "+n",
        "*** Update File: /u.ts",
        "@@",
        "-u",
        "+U",
        "*** Delete File: /d.ts",
        "*** Update File: /m.ts",
        "*** Move to: /m2.ts",
      ),
    });
    expect(access).toEqual([
      "create /n.ts",
      "update /u.ts",
      "delete /d.ts",
      "move /m.ts",
      "create /m2.ts",
    ]);
    expect(change).toEqual(["create /n.ts 4", "update /u.ts 4", "delete /d.ts 4", "move /m2.ts 4"]);
  });

  test("authorizer content is refused for apply_patch", async () => {
    const setup = await readAll(
      { "/a.ts": "a\n" },
      {
        deps: {
          authorize: {
            id: "rewriter",
            authorize: (target) =>
              target.change === null ? { allow: true } : { allow: true, content: "x" },
          },
        },
      },
    );
    const result = await setup.applyPatch({
      patch: patchText("*** Update File: /a.ts", "@@", "-a", "+A"),
    });
    expect(errorOf(result)).toEqual({
      message: expect.any(String),
      code: "EXTENSION_FAILED",
      phase: "authorize",
      data: { extension: "authorize", phase: "authorize", id: "rewriter" },
    });
    expect(text(setup.fs, "/a.ts")).toBe("a\n");
  });

  test("newFileMode is asked for an Add and a move destination; a move keeps the source mode otherwise", async () => {
    const asked: string[] = [];
    const setup = harness({
      files: { "/m.txt": "m\n" },
      deps: {
        hooks: [
          executableShebang(),
          {
            id: "spy",
            newFileMode: (change) => {
              asked.push(`${change.kind} ${change.displayPath}`);
              return null;
            },
            afterWrite: () => ({}),
          },
        ],
      },
    });
    setup.fs.setFile("/m.txt", "m\n", { mode: 0o600 });
    await setup.read({ path: "/m.txt" });
    const result = await setup.applyPatch({
      patch: patchText(
        "*** Add File: /run.sh",
        "+#!/bin/sh",
        "+echo hi",
        "*** Add File: /plain.txt",
        "+plain",
        "*** Update File: /m.txt",
        "*** Move to: /m2.txt",
      ),
    });
    expect(result.status).toBe("ok");
    expect(asked).toEqual(["create /plain.txt", "move /m2.txt"]);
    expect(setup.fs.peek("/run.sh")?.mode).toBe(0o755);
    expect(setup.fs.peek("/plain.txt")?.mode).toBe(0o644);
    expect(setup.fs.peek("/m2.txt")?.mode).toBe(0o600);
    expect(codes(result)).toContain("executable");
  });

  test("after-write hooks run once for each changed file, after the whole commit", async () => {
    const seen: string[] = [];
    const setup = await readAll(
      { "/a.ts": "a\n", "/b.ts": "b\n" },
      {
        deps: {
          hooks: [
            {
              id: "spy",
              afterWrite: (change) => {
                seen.push(
                  `${change.kind} ${change.path} ${change.after === null ? "gone" : "there"}`,
                );
                return {};
              },
            },
          ],
        },
      },
    );
    await setup.applyPatch({
      patch: patchText("*** Update File: /a.ts", "@@", "-a", "+A", "*** Delete File: /b.ts"),
    });
    expect(seen).toEqual(["update /a.ts there", "delete /b.ts gone"]);
  });
});

describe("parse, limits, and the parser extension", () => {
  test("a parse error gives PATCH_PARSE with the line", async () => {
    const { applyPatch } = harness();
    const result = await applyPatch({
      patch: "*** Begin Patch\n*** Environment ID: x\n*** End Patch",
    });
    expect(errorOf(result)).toEqual({
      message: expect.any(String),
      code: "PATCH_PARSE",
      phase: "input",
      data: { line: 2, detail: "*** Environment ID is not supported. Remove the line." },
    });
    expect(textOf(result)).toBe(
      "[apply_patch:patch-parse] The patch could not be parsed at line 2: *** Environment ID is not supported. Remove the line.",
    );
  });

  test("more than maxPatchFiles operations give TOO_LARGE", async () => {
    const { applyPatch } = harness({ patchDeps: { limits: { maxPatchFiles: 2 } } });
    const result = await applyPatch({
      patch: patchText("*** Delete File: a", "*** Delete File: b", "*** Delete File: c"),
    });
    expect(errorOf(result)).toEqual({
      message: expect.any(String),
      code: "TOO_LARGE",
      phase: "input",
      data: { limit: 2, operations: 3 },
    });
  });

  test("a host parser's plan is used; a throw or a malformed plan gives EXTENSION_FAILED", async () => {
    const custom: PatchParser = {
      id: "one-line",
      parse: (text) => ({
        ok: true,
        plan: { operations: [{ kind: "add", path: text.trim(), content: "made\n", line: 1 }] },
      }),
    };
    const good = harness({ patchDeps: { patchParser: custom } });
    await good.applyPatch({ patch: "/made.txt" });
    expect(text(good.fs, "/made.txt")).toBe("made\n");

    const throwing = harness({
      patchDeps: {
        patchParser: {
          id: "boom",
          parse: () => {
            throw new Error("boom");
          },
        },
      },
    });
    expect(errorOf(await throwing.applyPatch({ patch: "x" }))).toEqual({
      message: expect.any(String),
      code: "EXTENSION_FAILED",
      phase: "input",
      data: { extension: "patchParser", phase: "input", id: "boom" },
    });
    for (const outcome of [
      null,
      { ok: true, plan: { operations: [] } },
      { ok: true, plan: { operations: [{ kind: "add", path: "", content: "", line: 1 }] } },
      { ok: false, error: { line: 0, detail: "x" } },
    ]) {
      const bad = harness({
        patchDeps: { patchParser: { id: "bad", parse: () => outcome as never } },
      });
      expect(errorCode(await bad.applyPatch({ patch: "x" }))).toBe("EXTENSION_FAILED");
    }
  });

  test("the matchers dependency replaces the patch chain", async () => {
    const { applyPatch, fs } = await readAll(
      { "/a.ts": "  a\n" },
      {
        patchDeps: { matchers: [lineTrimmedMatcher()] },
      },
    );
    const result = await applyPatch({
      patch: patchText("*** Update File: /a.ts", "@@", "-a", "+b"),
    });
    expect(text(fs, "/a.ts")).toBe("b\n");
    expect(result.changes[0]?.matches[0]?.matcher).toBe("line-trimmed");
  });
});
