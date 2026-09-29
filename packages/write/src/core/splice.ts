export interface Splice {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

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

export function placed(splices: readonly Splice[]): { start: number; end: number }[] {
  let shift = 0;
  return splices.map((splice) => {
    const start = splice.start + shift;
    shift += splice.text.length - (splice.end - splice.start);
    return { start, end: start + splice.text.length };
  });
}
