import { describe, expect, test } from "bun:test";

import { omissionGuard } from "../../src/index.ts";
import { errorCode, harness, text } from "../helpers.ts";
import { change, guardContext, verdict } from "./helpers.ts";

const OLD = [
  "function a() {",
  "  one();",
  "  two();",
  "  three();",
  "  four();",
  "  five();",
  "  six();",
  "  seven();",
  "}",
].join("\n");

function check(newText: string, oldText = OLD, tool: "write" | "edit" = "edit") {
  return verdict(
    omissionGuard().check(
      change({ tool, before: oldText, after: newText, fragments: [{ oldText, newText }] }),
      guardContext(tool),
    ),
  );
}

describe("omissionGuard", () => {
  test.each([
    "  // ... rest of code",
    "  // ... existing code ...",
    "  # ... existing code ...",
    "  <!-- ... unchanged -->",
    "  /* ... rest of the function ... */",
    "  {/* ... other items ... */}",
    "  // existing code ...",
    "  -- … remaining columns",
    "  // rest of the file unchanged",
    "  // (existing methods remain the same)",
    "  # remaining tests omitted",
  ])("refuses %s when the new text is shorter", (placeholder) => {
    expect(check(`function a() {\n  one();\n${placeholder}\n}`)).toBe("omission");
  });

  test("near miss: the placeholder is already in the old text", () => {
    const old = "function a() {\n  // ... rest of code\n  one();\n  two();\n}";
    expect(check("function a() {\n  // ... rest of code\n}", old)).toBe("allow");
  });

  test("near miss: new text that is not shorter", () => {
    expect(check("x\n// ... rest of code\n", "x\n")).toBe("allow");
  });

  test("a create is not checked", () => {
    const decision = omissionGuard().check(
      change({ after: "// ... rest of code\n" }),
      guardContext(),
    );
    expect(verdict(decision)).toBe("allow");
  });

  test.each([
    // Python stubs.
    "def f():\n    ...",
    "    ...",
    // A bare ellipsis comment names nothing that is left out.
    "  // ...",
    // Ordinary comments.
    "  // Handle the rest of the input here",
    "  // TODO: the existing parser is slow",
    "  // See the other overload.",
    "  const rest = args.slice(1); // rest of args",
    '  console.log("...rest of code");',
  ])("ordinary content is allowed: %s", (line) => {
    expect(check(`function a() {\n${line}\n}`)).toBe("allow");
  });

  test("the message fits the tool", () => {
    const edit = omissionGuard().check(
      change({
        tool: "edit",
        before: OLD,
        after: "x",
        fragments: [{ oldText: OLD, newText: "a();\n// ... rest of code" }],
      }),
      guardContext("edit"),
    );
    const write = omissionGuard().check(
      change({ before: OLD, after: "a();\n// ... rest of code" }),
      guardContext(),
    );
    expect([edit, write]).toEqual([
      {
        allow: false,
        note: {
          code: "omission",
          severity: "warning",
          message:
            'The newText for /a.txt has a placeholder instead of code: "// ... rest of code". It would delete the lines it stands for. Write those lines out in full, or make the oldText smaller so they stay unchanged.',
          data: { line: "// ... rest of code" },
        },
      },
      {
        allow: false,
        note: {
          code: "omission",
          severity: "warning",
          message:
            'The content for /a.txt has a placeholder instead of code: "// ... rest of code". It would delete the lines it stands for. Send the complete file content, or use the edit tool to change only part of the file.',
          data: { line: "// ... rest of code" },
        },
      },
    ]);
  });

  test("host patterns replace the defaults", () => {
    const guard = omissionGuard({ patterns: [/^SNIP$/u] });
    const run = (newText: string) =>
      verdict(
        guard.check(
          change({ before: OLD, after: newText, fragments: [{ oldText: OLD, newText }] }),
          guardContext(),
        ),
      );
    expect([run("a\nSNIP"), run("a\n// ... rest of code")]).toEqual(["omission", "allow"]);
  });

  test("on by default for write: a replace that drops code is refused", async () => {
    const { fs, read, write } = harness({ files: { "/a.ts": `${OLD}\n` } });
    await read({ path: "/a.ts" });
    const result = await write({
      path: "/a.ts",
      content: "function a() {\n  // ... rest of code\n}\n",
    });
    expect(errorCode(result)).toBe("GUARD_REFUSED");
    expect(text(fs, "/a.ts")).toBe(`${OLD}\n`);
  });
});
