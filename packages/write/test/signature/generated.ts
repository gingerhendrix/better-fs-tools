/**
 * Deterministic model-like inputs for signature tests, as the read signature
 * tests make them. A seeded generator keeps failures reproducible. Values are
 * JSON values only: a model never sends undefined, NaN, or a function.
 */
const STRINGS = [
  "a.txt",
  "dir/a b.txt",
  "x",
  "",
  " ",
  "\t\n",
  "a\u0000b",
  "\u0000",
  "*** Begin Patch",
];
const NUMBERS = [0, 1, -1, 1.5];
const OTHERS: unknown[] = [true, false, null, [], ["a.txt"], {}, { path: "a.txt" }];

export function generator(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(random: () => number, values: readonly T[]): T {
  return values[Math.floor(random() * values.length)] as T;
}

function scalar(random: () => number): unknown {
  const roll = random();
  if (roll < 0.15) return pick(random, NUMBERS);
  if (roll < 0.35) return pick(random, OTHERS);
  if (roll < 0.9) return pick(random, STRINGS);
  return random() < 0.5;
}

function object(random: () => number, keys: readonly string[], nested: NestedKeys): unknown {
  const input: Record<string, unknown> = {};
  for (const key of [...keys, "file_path", "extra"]) {
    const chance = keys.includes(key) ? 0.85 : 0.05;
    if (random() >= chance) continue;
    const inner = nested[key];
    input[key] = inner !== undefined && random() < 0.8 ? array(random, inner) : scalar(random);
  }
  return input;
}

function array(random: () => number, keys: readonly string[]): unknown[] {
  const length = Math.floor(random() * 3);
  return Array.from({ length }, () => (random() < 0.9 ? object(random, keys, {}) : scalar(random)));
}

/** Keys whose value is an array of objects with the given keys. */
export type NestedKeys = Readonly<Record<string, readonly string[]>>;

/** `count` inputs over the given keys, with extra keys and non-objects mixed in. */
export function generatedInputs(
  keys: readonly string[],
  count: number,
  nested: NestedKeys = {},
  seed = 1,
): unknown[] {
  const random = generator(seed);
  const inputs: unknown[] = [];
  for (let index = 0; index < count; index += 1) {
    inputs.push(random() < 0.05 ? scalar(random) : object(random, keys, nested));
  }
  return inputs;
}
