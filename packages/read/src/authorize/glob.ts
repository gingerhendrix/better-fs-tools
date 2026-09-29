const GLOBSTAR = Symbol("globstar");

type Segment = RegExp | typeof GLOBSTAR;

/**
 * Compiles a glob into a matcher for "/"-separated paths. A "**" segment
 * matches zero or more whole segments. "*" matches any run of characters within
 * a segment, and "?" one character. Dot names get no special case. Every other
 * character matches itself. Matching time is linear in pattern and path length.
 */
export function compileGlob(pattern: string): (path: string) => boolean {
  const segments: readonly Segment[] = pattern
    .split("/")
    .map((segment) => (segment === "**" ? GLOBSTAR : segmentPattern(segment)));
  return (path) => matches(segments, path.split("/"));
}

function segmentPattern(segment: string): RegExp {
  let source = "";
  for (const char of segment) {
    if (char === "*") source += "[^/]*";
    else if (char === "?") source += "[^/]";
    else source += char.replace(/[\\^$.|+()[\]{}]/g, "\\$&");
  }
  return new RegExp(`^${source}$`, "u");
}

function matches(segments: readonly Segment[], parts: readonly string[]): boolean {
  let segmentsMatchFirstParts: boolean[] = parts.map(() => false).concat(false);
  segmentsMatchFirstParts[0] = true;
  for (const segment of segments) {
    const next: boolean[] = segmentsMatchFirstParts.map(() => false);
    if (segment === GLOBSTAR) {
      let anyEarlierMatched = false;
      for (let j = 0; j <= parts.length; j += 1) {
        anyEarlierMatched ||= segmentsMatchFirstParts[j] === true;
        next[j] = anyEarlierMatched;
      }
    } else {
      for (let j = 1; j <= parts.length; j += 1) {
        next[j] = segmentsMatchFirstParts[j - 1] === true && segment.test(parts[j - 1] ?? "");
      }
    }
    segmentsMatchFirstParts = next;
  }
  return segmentsMatchFirstParts[parts.length] === true;
}
