/** One replacement: original offsets and the text that takes their place. */
export interface Splice {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

/**
 * The literal splice (section 5.4). Splices are sorted and do not overlap.
 * They apply from the last to the first, so no offset shifts. The result is
 * built from slices: String.prototype.replace is never called, so `$&`,
 * `$$`, `$1`, and `` $` `` in the new text stay literal.
 */
export function spliceAll(text: string, splices: readonly Splice[]): string {
  const parts: string[] = [];
  let tail = text.length;
  for (let index = splices.length - 1; index >= 0; index -= 1) {
    const splice = splices[index] as Splice;
    parts.push(text.slice(splice.end, tail), splice.text);
    tail = splice.start;
  }
  parts.push(text.slice(0, tail));
  return parts.reverse().join("");
}

/** Where each splice's text sits in the result, in the same order. */
export function placed(splices: readonly Splice[]): { start: number; end: number }[] {
  let shift = 0;
  return splices.map((splice) => {
    const start = splice.start + shift;
    shift += splice.text.length - (splice.end - splice.start);
    return { start, end: start + splice.text.length };
  });
}
