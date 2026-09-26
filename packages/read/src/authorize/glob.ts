const GLOBSTAR = Symbol("globstar");

type Segment = RegExp | typeof GLOBSTAR;

/**
 * A matcher over "/"-separated paths. A "**" segment matches zero or more
 * whole segments. "*" matches any run of characters within a segment, and "?"
 * one character. Dot names get no special case. Every other character matches
 * itself. Linear in pattern times path segments: no backtracking across "/".
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
  // reach[j]: the segments so far match the first j parts.
  let reach: boolean[] = parts.map(() => false).concat(false);
  reach[0] = true;
  for (const segment of segments) {
    const next: boolean[] = reach.map(() => false);
    if (segment === GLOBSTAR) {
      let any = false;
      for (let j = 0; j <= parts.length; j += 1) {
        any ||= reach[j] === true;
        next[j] = any;
      }
    } else {
      for (let j = 1; j <= parts.length; j += 1) {
        next[j] = reach[j - 1] === true && segment.test(parts[j - 1] ?? "");
      }
    }
    reach = next;
  }
  return reach[parts.length] === true;
}
