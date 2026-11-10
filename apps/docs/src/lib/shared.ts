import { createGetUrl } from "fumadocs-core/source";

const getDocsUrl = createGetUrl("/");

export function getPageMarkdownUrl(page: { slugs: string[]; locale?: string }) {
  const segments = [...page.slugs];
  if (segments.length === 0) {
    segments.push("index.md");
  } else {
    segments[segments.length - 1] += ".md";
  }

  return { segments, url: getDocsUrl(segments, page.locale) };
}

/** Decode the Markdown route's segments into documentation page slugs. */
export function decodeMarkdownUrl(segments: string[]) {
  if (segments.length === 0) return [];

  const out = [...segments];
  const last = out.length - 1;
  out[last] = out[last]?.replace(/\.md$/, "") ?? "";
  if (out.length === 1 && out[0] === "index") out.pop();
  return out;
}
