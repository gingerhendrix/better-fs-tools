/**
 * The package rules from plan section 3, as data. A new package folder, a new
 * dependency, or a new peer must be added here before the check passes.
 */
export interface PackageRule {
  /** Other @better-fs-tools packages in `dependencies`, by folder name. */
  readonly dependencies: readonly string[];
  /** Required peers and their ranges. */
  readonly peers: Readonly<Record<string, string>>;
  /** True when the package may import `node:*` builtins. */
  readonly node: boolean;
  /** Extra top-level paths the tarball ships besides dist, README.md, LICENSE, and package.json. */
  readonly extraFiles: readonly string[];
}

export const SCOPE = "@better-fs-tools";

export const RULES: Readonly<Record<string, PackageRule>> = {
  fs: { dependencies: [], peers: {}, node: false, extraFiles: [] },
  read: { dependencies: ["fs"], peers: {}, node: false, extraFiles: ["docs"] },
  write: { dependencies: ["fs", "read"], peers: {}, node: false, extraFiles: ["docs"] },
  shell: { dependencies: ["fs", "read"], peers: {}, node: false, extraFiles: [] },
  node: { dependencies: ["fs", "read", "write", "shell"], peers: {}, node: true, extraFiles: [] },
  "ai-sdk": {
    dependencies: ["read", "write", "shell"],
    peers: { ai: "^7.0.77" },
    node: false,
    extraFiles: [],
  },
  pi: {
    dependencies: ["node", "read", "write", "shell"],
    peers: { "@earendil-works/pi-coding-agent": "^0.84.2", typebox: "^1.3.16" },
    node: true,
    extraFiles: [],
  },
  "cloudflare-shell": { dependencies: ["fs"], peers: {}, node: false, extraFiles: [] },
  "cloudflare-computer": { dependencies: ["fs"], peers: {}, node: false, extraFiles: [] },
  "just-bash": {
    dependencies: ["fs", "shell"],
    peers: { "just-bash": "3.4.2" },
    node: false,
    extraFiles: [],
  },
};

/** Packages whose declarations must type-check with no Node or Bun types. */
export const RUNTIME_NEUTRAL = [
  "fs",
  "read",
  "write",
  "shell",
  "cloudflare-shell",
  "cloudflare-computer",
  "just-bash",
];

/**
 * Entries that are empty on purpose, until the batch that fills them. The Node
 * consumer fails when a listed entry exports something, so the batch that adds
 * exports must remove its entry here. None are left.
 */
export const EMPTY_ENTRIES: readonly string[] = [];

export interface ExportTarget {
  readonly types?: string;
  readonly import?: string;
}

export interface Manifest {
  readonly name: string;
  readonly version: string;
  readonly license?: string;
  readonly type?: string;
  readonly sideEffects?: boolean;
  readonly exports: Readonly<Record<string, string | ExportTarget>>;
  readonly files?: readonly string[];
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
  readonly peerDependencies?: Readonly<Record<string, string>>;
  readonly optionalDependencies?: Readonly<Record<string, string>>;
  readonly publishConfig?: Readonly<Record<string, unknown>>;
  readonly pi?: { readonly extensions?: readonly string[] };
}

const RANGE_FIELDS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
] as const;

/**
 * Checks the packed manifest against the rule for its folder. `source` is the
 * workspace manifest, used to prove every development export was published.
 */
export function checkManifest(
  folder: string,
  packed: Manifest,
  source: Manifest,
  version: string,
): string[] {
  const rule = RULES[folder];
  if (rule === undefined)
    return [`packages/${folder} has no rule in scripts/package-check/rules.ts`];
  const failures: string[] = [];
  const fail = (message: string) => failures.push(`${packed.name}: ${message}`);

  if (packed.name !== `${SCOPE}/${folder}`) fail(`name should be ${SCOPE}/${folder}`);
  if (packed.version !== version) fail(`version ${packed.version} is not the lockstep ${version}`);
  if (packed.type !== "module") fail("type should be module");
  if (packed.sideEffects !== false) fail("sideEffects should be false");
  if (packed.license !== "MIT") fail("license should be MIT");

  for (const field of RANGE_FIELDS) {
    for (const [name, range] of Object.entries(packed[field] ?? {})) {
      if (/^(workspace|catalog):/u.test(range)) fail(`${field}.${name} still has ${range}`);
    }
  }

  const internal = Object.entries(packed.dependencies ?? {})
    .filter(([name]) => name.startsWith(`${SCOPE}/`))
    .map(([name, range]) => {
      if (range !== `^${version}`) fail(`dependencies.${name} is ${range}, not ^${version}`);
      return name.slice(SCOPE.length + 1);
    });
  if (!sameSet(internal, rule.dependencies)) {
    fail(`depends on [${internal.sort().join(", ")}], plan says [${rule.dependencies.join(", ")}]`);
  }
  const external = Object.keys(packed.dependencies ?? {}).filter((n) => !n.startsWith(`${SCOPE}/`));
  if (external.length > 0) fail(`unexpected runtime dependencies: ${external.join(", ")}`);

  const peers = packed.peerDependencies ?? {};
  if (!sameSet(Object.keys(peers), Object.keys(rule.peers))) {
    fail(
      `peers [${Object.keys(peers).join(", ")}], plan says [${Object.keys(rule.peers).join(", ")}]`,
    );
  }
  for (const [name, range] of Object.entries(rule.peers)) {
    if (peers[name] !== undefined && peers[name] !== range) {
      fail(`peer ${name} is ${peers[name]}, plan says ${range}`);
    }
  }

  if (!sameSet(Object.keys(packed.exports), Object.keys(source.exports))) {
    fail("published exports do not have the same keys as the development exports");
  }
  for (const [key, target] of Object.entries(packed.exports)) {
    if (typeof target === "string" || target.types === undefined || target.import === undefined) {
      fail(`export ${key} needs types and import conditions`);
      continue;
    }
    for (const file of [target.types, target.import]) {
      if (!file.startsWith("./dist/")) fail(`export ${key} points outside dist: ${file}`);
    }
  }

  if (folder === "pi") {
    const extensions = packed.pi?.extensions ?? [];
    if (extensions.length === 0) fail("pi.extensions is missing");
    for (const entry of extensions) {
      if (!entry.startsWith("./dist/")) fail(`pi.extensions points outside dist: ${entry}`);
    }
  } else if (packed.pi !== undefined) {
    fail("only @better-fs-tools/pi may have a pi field");
  }
  return failures;
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  const left = new Set(a);
  return left.size === new Set(b).size && b.every((value) => left.has(value));
}
