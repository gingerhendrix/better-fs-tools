/** Line numbers for offsets in one text. Lines are one-based. A final "\n" ends the last line. */
export class LineIndex {
  private readonly breaks: number[] = [];

  constructor(readonly text: string) {
    for (let at = text.indexOf("\n"); at !== -1; at = text.indexOf("\n", at + 1)) {
      this.breaks.push(at);
    }
  }

  /** Lines in the text. 0 for an empty text. */
  get count(): number {
    if (this.text === "") return 0;
    return this.breaks.length + (this.text.endsWith("\n") ? 0 : 1);
  }

  /** The line that holds the character at `offset`. An offset at the end is on the last line. */
  lineOf(offset: number): number {
    let low = 0;
    let high = this.breaks.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if ((this.breaks[middle] ?? 0) < offset) low = middle + 1;
      else high = middle;
    }
    return Math.max(1, Math.min(low + 1, this.count));
  }

  /** First and last line of the text between start and end. An empty span is on the line of start. */
  span(start: number, end: number): [number, number] {
    const first = this.lineOf(start);
    return [first, end > start ? Math.max(first, this.lineOf(end - 1)) : first];
  }

  /** The text of a line, without its "\n" or a "\r" before it. */
  line(number: number): string {
    const start = number <= 1 ? 0 : (this.breaks[number - 2] ?? this.text.length) + 1;
    const end = this.breaks[number - 1] ?? this.text.length;
    const line = this.text.slice(start, end);
    return line.endsWith("\r") ? line.slice(0, -1) : line;
  }
}
