/**
 * Tegami release configuration and CLI. Run with `bun run tegami [command]`.
 * docs/releasing.md describes the release flow.
 */
import { tegami } from "tegami";
import type { PackageOptions } from "tegami";
import { runCli } from "tegami/cli";
import { github } from "tegami/plugins/github";

import { RULES, SCOPE } from "./package-check/rules.ts";
import { applyPublishConfig } from "./release/publish-config-plugin.ts";

/** Every package that check:packages verifies is published, and all share one version. */
const packages: Record<string, PackageOptions<"better-fs-tools">> = Object.fromEntries(
  Object.keys(RULES).map((folder) => [`${SCOPE}/${folder}`, { group: "better-fs-tools" }]),
);

const paper = tegami({
  groups: {
    "better-fs-tools": {
      syncBump: true,
      syncGitTag: true,
    },
  },
  ignore: ["better-fs-tools", `${SCOPE}/docs`, `${SCOPE}/examples`],
  npm: {
    client: "bun",
    trustedPublish: {
      provider: "github",
      workflow: "release.yml",
    },
  },
  packages,
  plugins: [
    github({
      repo: "gingerhendrix/better-fs-tools",
      versionPr: {
        base: "main",
      },
    }),
    applyPublishConfig(),
  ],
});

await runCli(paper);
