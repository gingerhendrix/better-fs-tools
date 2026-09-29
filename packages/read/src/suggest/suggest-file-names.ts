/** Up to `maximum` names close to `requested`: same stem, a shared prefix, or a small edit distance. */
export function suggestFileNames(
  requested: string,
  names: readonly string[],
  maximum: number,
): readonly string[] {
  const requestedLower = requested.toLowerCase();
  const requestedStem = stem(requestedLower);
  return names
    .map((name) => ({ name, score: suggestionScore(requestedLower, requestedStem, name) }))
    .filter(({ score }) => score < Number.POSITIVE_INFINITY)
    .sort((left, right) => left.score - right.score || left.name.localeCompare(right.name))
    .slice(0, maximum)
    .map(({ name }) => name);
}

function suggestionScore(requested: string, requestedStem: string, candidate: string): number {
  const lower = candidate.toLowerCase();
  if (lower === requested) return 0;
  if (stem(lower) === requestedStem) return 10;
  if (lower.startsWith(requested) || requested.startsWith(lower)) {
    return 20 + Math.abs(lower.length - requested.length);
  }
  const distance = boundedDistance(requested, lower, 3);
  return distance === null ? Number.POSITIVE_INFINITY : 30 + distance;
}

function stem(value: string): string {
  const index = value.lastIndexOf(".");
  return index <= 0 ? value : value.slice(0, index);
}

function boundedDistance(left: string, right: string, maximum: number): number | null {
  if (Math.abs(left.length - right.length) > maximum) return null;
  let prior = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const next = [leftIndex];
    let rowMinimum = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const value = Math.min(
        (prior[rightIndex] as number) + 1,
        (next[rightIndex - 1] as number) + 1,
        (prior[rightIndex - 1] as number) + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
      next.push(value);
      rowMinimum = Math.min(rowMinimum, value);
    }
    if (rowMinimum > maximum) return null;
    prior = next;
  }
  const distance = prior[right.length] as number;
  return distance <= maximum ? distance : null;
}
