import { memoryFileSystem } from "@better-fs-tools/fs";
import { textOf } from "@better-fs-tools/read";
import {
  createWriteTool,
  executableShebang,
  generatedFileGuard,
  recommendedGuards,
  syntaxGuard,
  verifyWrite,
} from "@better-fs-tools/write";
import type { Guard, WriteHook } from "@better-fs-tools/write";

// A host guard: refuse tabs in new YAML text.
const noTabsInYaml: Guard<unknown> = {
  id: "no-tabs-in-yaml",
  check(change) {
    const yaml = /\.ya?ml$/u.test(change.resolvedPath);
    if (!yaml || !change.fragments.some((fragment) => fragment.newText.includes("\t"))) {
      return { allow: true };
    }
    return {
      allow: false,
      note: {
        code: "guard-refused",
        severity: "warning",
        message: `${change.displayPath}: YAML does not allow tabs for indentation.`,
      },
    };
  },
};

// A host hook: log each committed change.
const logChanges: WriteHook<unknown> = {
  id: "log-changes",
  afterWrite(change) {
    console.log(`${change.kind} ${change.path} (+${change.linesAdded} -${change.linesRemoved})`);
    return {};
  },
};

const write = createWriteTool({
  fs: memoryFileSystem({ directories: ["/repo"] }),
  // No guards run by default. recommendedGuards() gives the five this
  // package recommends. Passing guards replaces the whole list.
  guards: [
    ...recommendedGuards().filter((guard) => guard.id !== "syntax"),
    syntaxGuard({ parsers: { yaml: (text) => void text } }),
    generatedFileGuard(),
    noTabsInYaml,
  ],
  hooks: [executableShebang(), verifyWrite(), logChanges],
});

console.log(textOf(await write({ path: "/repo/ci.yaml", content: "a:\n\tb: 1\n" })));
// [write:guard-refused] /repo/ci.yaml: YAML does not allow tabs for indentation.

console.log(textOf(await write({ path: "/repo/run.sh", content: "#!/bin/sh\necho hi\n" })));
// create /repo/run.sh (+2 -0)
// Created /repo/run.sh (2 lines).
//
// [write:executable] Made /repo/run.sh executable (mode 755) because it starts with "#!".
