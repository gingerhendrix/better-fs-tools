/**
 * Folds the differences that make a copied filename miss on a POSIX
 * filesystem: NFC and NFD, narrow and non-breaking spaces, and typographic
 * quotes.
 */
export function canonicalizeFileName(value: string): string {
  return value
    .normalize("NFC")
    .replace(/[  ]/gu, " ")
    .replace(/[‘’]/gu, "'")
    .replace(/[“”]/gu, '"');
}
