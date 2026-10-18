const CR = "\r";

/**
 * Builds the new lines for one loose hit so that text the model did not
 * change keeps the file's bytes.
 *
 * - `file` holds the file's own text of the matched lines, `old` the model's
 *   text of the same lines, and `next` the model's new lines.
 * - With `keepUnchanged`, the leading and trailing lines where `old` and
 *   `next` agree are written from `file`.
 * - Each other new line takes the CR of the file line it replaces, so a
 *   mixed-EOL file keeps its CRLF lines. The last new line pairs with the
 *   last replaced line when no kept line follows it.
 */
export function keepFileLines(
  file: readonly string[],
  old: readonly string[],
  next: readonly string[],
  keepUnchanged: boolean,
): string[] {
  const room = Math.min(old.length, next.length);
  let head = 0;
  if (keepUnchanged) {
    while (head < room && old[head] === next[head]) head += 1;
  }
  let tail = 0;
  if (keepUnchanged) {
    while (head + tail < room && old.at(-1 - tail) === next.at(-1 - tail)) tail += 1;
  }
  const replaced = file.slice(head, file.length - tail);
  const written = next.slice(head, next.length - tail);
  const middle = written.map((line, at) => {
    if (replaced.length === 0 || line.endsWith(CR)) return line;
    const lastWithoutKept = tail === 0 && at === written.length - 1;
    const pair = lastWithoutKept ? replaced.length - 1 : Math.min(at, replaced.length - 1);
    return (replaced[pair] as string).endsWith(CR) ? `${line}${CR}` : line;
  });
  return [...file.slice(0, head), ...middle, ...file.slice(file.length - tail)];
}

/**
 * The `Matcher.adapt` rule for a loose hit in text mode. When the old text and
 * the new text are the same, the edit exists only to change the characters the
 * matcher folded, so the new text is written as given, with the file's CRs.
 * Otherwise the unchanged leading and trailing lines keep the file's bytes.
 * `lined` says whether line N of the region matched line N of the old text;
 * when it did not, the new text is written as given.
 */
export function adaptKeepingBytes(
  newText: string,
  region: string,
  needle: string,
  lined: (file: readonly string[], old: readonly string[]) => boolean,
): string {
  const file = region.split("\n");
  const old = needle.split("\n");
  if (file.length !== old.length || !lined(file, old)) return newText;
  return keepFileLines(file, old, newText.split("\n"), newText !== needle).join("\n");
}
