// JSON values only: a model never sends undefined, NaN, or a function.
const STRINGS = [
  "a.txt",
  "dir/a b.txt",
  " padded.txt ",
  "é.txt",
  "",
  " ",
  "\t\n",
  " ",
  " ",
  "﻿",
  "a\u0000b",
  "\u0000",
  "2",
];
const NUMBERS = [
  0,
  -0,
  1,
  2,
  3,
  10,
  -1,
  1.5,
  2.0,
  1e308,
  Number.MAX_SAFE_INTEGER,
  Number.MAX_SAFE_INTEGER + 1,
];
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

function value(random: () => number): unknown {
  const roll = random();
  if (roll < 0.45) return pick(random, NUMBERS);
  if (roll < 0.85) return pick(random, STRINGS);
  return pick(random, OTHERS);
}

export function generatedInputs(keys: readonly string[], count: number, seed = 1): unknown[] {
  const random = generator(seed);
  const pool = [...keys, "file_path", "extra"];
  const inputs: unknown[] = [];
  for (let index = 0; index < count; index += 1) {
    if (random() < 0.05) {
      inputs.push(value(random));
      continue;
    }
    const input: Record<string, unknown> = {};
    for (const key of pool) {
      const chance = keys.includes(key) ? 0.7 : 0.08;
      if (random() < chance) input[key] = value(random);
    }
    // Most inputs get a valid path, so the other keys decide the outcome.
    if (random() < 0.6 && keys[0] !== undefined) input[keys[0]] = pick(random, STRINGS.slice(0, 4));
    inputs.push(input);
  }
  return inputs;
}
