export interface Folded {
  readonly text: string;
  readonly sourceStart: Int32Array;
  readonly sourceEnd: Int32Array;
  /** FIRST: the unit starts its source span's output. LAST: it ends it. */
  readonly edges: Uint8Array;
  readonly trimmedEnd: boolean;
}

export const FIRST = 1;
export const LAST = 2;
const BLANK = 4;

const LF = 10;
const MARK = /^\p{M}/u;

export function fold(text: string): Folded {
  const out = new FoldedUnitBuffer(text.length);
  let index = 0;
  while (index < text.length) {
    const code = text.charCodeAt(index);
    const next = text.charCodeAt(index + 1);
    if (foldsToItself(code, next)) {
      out.push(code, index, index + 1, FIRST | LAST | (isBlank(code) ? BLANK : 0));
      index += 1;
      continue;
    }
    let end = index + unitLength(text, index);
    while (end < text.length) {
      const point = text.codePointAt(end) ?? 0;
      if (point < 0x300 || !MARK.test(String.fromCodePoint(point))) break;
      end += point > 0xffff ? 2 : 1;
    }
    const folded = replaceLookalikes(text.slice(index, end).normalize("NFKC"));
    let blank = BLANK;
    for (let unit = 0; unit < folded.length; unit += 1) {
      if (!isBlank(folded.charCodeAt(unit))) blank = 0;
    }
    for (let unit = 0; unit < folded.length; unit += 1) {
      const edges = (unit === 0 ? FIRST : 0) | (unit === folded.length - 1 ? LAST : 0);
      out.push(folded.charCodeAt(unit), index, end, edges | blank);
    }
    index = end;
  }
  return out.dropTrailingBlanks();
}

function foldsToItself(code: number, next: number): boolean {
  const isAscii = code < 0x80;
  const mayHaveCombiningMark = next >= 0x300;
  return isAscii && !mayHaveCombiningMark;
}

function isBlank(code: number): boolean {
  return code === 32 || code === 9 || code === 13;
}

function unitLength(text: string, index: number): number {
  return (text.codePointAt(index) ?? 0) > 0xffff ? 2 : 1;
}

function replaceLookalikes(text: string): string {
  let result = "";
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    result += code < 0x80 ? text[index] : (MAPPED.get(code) ?? text[index]);
  }
  return result;
}

const MAPPED: ReadonlyMap<number, string> = new Map([
  ...[0x2018, 0x2019, 0x201a, 0x201b].map((code) => [code, "'"] as const),
  ...[0x201c, 0x201d, 0x201e, 0x201f].map((code) => [code, '"'] as const),
  ...[0x2010, 0x2011, 0x2012, 0x2013, 0x2014, 0x2015, 0x2212].map((code) => [code, "-"] as const),
  ...[0x00a0, 0x202f, 0x205f, 0x3000].map((code) => [code, " "] as const),
  ...Array.from({ length: 11 }, (_, offset) => [0x2000 + offset, " "] as const),
]);

class FoldedUnitBuffer {
  private codes: Uint16Array;
  private starts: Int32Array;
  private ends: Int32Array;
  private flags: Uint8Array;
  private length = 0;

  constructor(capacity: number) {
    const size = Math.max(16, capacity);
    this.codes = new Uint16Array(size);
    this.starts = new Int32Array(size);
    this.ends = new Int32Array(size);
    this.flags = new Uint8Array(size);
  }

  push(code: number, start: number, end: number, flags: number): void {
    if (this.length === this.codes.length) this.grow();
    this.codes[this.length] = code;
    this.starts[this.length] = start;
    this.ends[this.length] = end;
    this.flags[this.length] = flags;
    this.length += 1;
  }

  private grow(): void {
    const size = this.codes.length * 2;
    const codes = new Uint16Array(size);
    codes.set(this.codes);
    this.codes = codes;
    const starts = new Int32Array(size);
    starts.set(this.starts);
    this.starts = starts;
    const ends = new Int32Array(size);
    ends.set(this.ends);
    this.ends = ends;
    const flags = new Uint8Array(size);
    flags.set(this.flags);
    this.flags = flags;
  }

  dropTrailingBlanks(): Folded {
    const keep = new Uint8Array(this.length).fill(1);
    let run = -1;
    for (let index = 0; index < this.length; index += 1) {
      const flags = this.flags[index] ?? 0;
      if (flags & BLANK) {
        if (run === -1) run = index;
        continue;
      }
      if (this.codes[index] === LF && run !== -1) keep.fill(0, run, index);
      run = -1;
    }
    const trimmedEnd = run !== -1;
    if (trimmedEnd) keep.fill(0, run, this.length);

    let kept = 0;
    for (const flag of keep) kept += flag;
    const codes = new Uint16Array(kept);
    const start = new Int32Array(kept);
    const end = new Int32Array(kept);
    const edges = new Uint8Array(kept);
    let at = 0;
    for (let index = 0; index < this.length; index += 1) {
      if (keep[index] === 0) continue;
      codes[at] = this.codes[index] ?? 0;
      start[at] = this.starts[index] ?? 0;
      end[at] = this.ends[index] ?? 0;
      edges[at] = (this.flags[index] ?? 0) & (FIRST | LAST);
      at += 1;
    }
    return { text: fromCodes(codes), sourceStart: start, sourceEnd: end, edges, trimmedEnd };
  }
}

function fromCodes(codes: Uint16Array): string {
  const parts: string[] = [];
  for (let index = 0; index < codes.length; index += 8_192) {
    parts.push(String.fromCharCode(...codes.subarray(index, index + 8_192)));
  }
  return parts.join("");
}
