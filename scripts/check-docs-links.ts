/**
 * Checks every internal link of the docs site. A link to a page must name a page
 * that exists, and a `#anchor` must name a heading on that page.
 *
 * Run: bun run check:links
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

const CONTENT = join(import.meta.dirname, "..", "apps", "docs", "content", "docs");

interface Page {
  readonly file: string;
  readonly anchors: ReadonlySet<string>;
  readonly links: readonly { readonly line: number; readonly target: string }[];
}

function mdxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return mdxFiles(path);
    return entry.name.endsWith(".mdx") ? [path] : [];
  });
}

/** The URL path of a content file: `a/index.mdx` is `/a`, `a/b.mdx` is `/a/b`. */
function urlOf(file: string): string {
  const parts = relative(CONTENT, file)
    .replace(/\.mdx$/u, "")
    .split(sep);
  if (parts.at(-1) === "index") parts.pop();
  return `/${parts.join("/")}`;
}

/** The heading slug of github-slugger, which Fumadocs uses for heading ids. */
function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, "")
    .replace(/ /gu, "-");
}

/** The plain text of a Markdown heading, as mdast-util-to-string gives it. */
function headingText(raw: string): string {
  return raw
    .replace(/\[([^\]]*)\]\([^)]*\)/gu, "$1")
    .replace(/`([^`]*)`/gu, "$1")
    .replace(/\*\*|\*/gu, "")
    .trim();
}

function parse(file: string): Page {
  const anchors = new Set<string>();
  const seen = new Map<string, number>();
  const links: { line: number; target: string }[] = [];
  let fence: string | null = null;
  readFileSync(file, "utf8")
    .split("\n")
    .forEach((text, index) => {
      const marker = /^\s*(`{3,}|~{3,})/u.exec(text)?.[1];
      if (marker !== undefined) {
        if (fence === null) fence = marker;
        else if (marker.startsWith(fence)) fence = null;
        return;
      }
      if (fence !== null) return;
      const heading = /^#{1,6}\s+(.*)$/u.exec(text)?.[1];
      if (heading !== undefined) {
        const base = slug(headingText(heading));
        const count = seen.get(base) ?? 0;
        seen.set(base, count + 1);
        anchors.add(count === 0 ? base : `${base}-${count}`);
      }
      const inline = text.replace(/`[^`]*`/gu, "");
      for (const match of inline.matchAll(/\]\((\/[^)\s]*|#[^)\s]*)\)|href="(\/[^"]*|#[^"]*)"/gu)) {
        links.push({ line: index + 1, target: (match[1] ?? match[2]) as string });
      }
    });
  return { file, anchors, links };
}

const pages = new Map(mdxFiles(CONTENT).map((file) => [urlOf(file), parse(file)]));
const problems: string[] = [];

for (const [url, page] of pages) {
  for (const { line, target } of page.links) {
    const [path = "", anchor] = target.split("#", 2);
    const targetUrl = path === "" ? url : path.replace(/\/$/u, "") || "/";
    const where = `${relative(process.cwd(), page.file)}:${line}`;
    const linked = pages.get(targetUrl);
    if (linked === undefined) {
      problems.push(`${where}: no page at ${targetUrl}`);
    } else if (anchor !== undefined && anchor !== "" && !linked.anchors.has(anchor)) {
      problems.push(`${where}: no heading #${anchor} on ${targetUrl}`);
    }
  }
}

if (problems.length > 0) {
  console.error(problems.join("\n"));
  console.error(`\n${problems.length} broken docs link(s).`);
  process.exit(1);
}
const count = [...pages.values()].reduce((total, page) => total + page.links.length, 0);
console.log(`Checked ${count} internal links in ${pages.size} docs pages.`);
