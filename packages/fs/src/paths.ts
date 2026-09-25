import type { PathOps } from "./contract.ts";

/**
 * The three namespace operations the read core needs. Implemented without
 * a Node path module, so the contract stays runtime neutral.
 */
export const posixPaths: PathOps = Object.freeze({
  dirname(path: string): string {
    const normalized = stripTrailingSlashes(path);
    const index = normalized.lastIndexOf("/");
    if (index < 0) return ".";
    if (index === 0) return "/";
    return normalized.slice(0, index);
  },
  basename(path: string): string {
    const normalized = stripTrailingSlashes(path);
    const index = normalized.lastIndexOf("/");
    return index < 0 ? normalized : normalized.slice(index + 1);
  },
  join(dir: string, name: string): string {
    if (name.startsWith("/")) return name;
    if (dir === "" || dir === ".") return name;
    return `${dir.endsWith("/") ? dir.slice(0, -1) : dir}/${name}`;
  },
});

function stripTrailingSlashes(path: string): string {
  if (path === "/") return path;
  let end = path.length;
  while (end > 1 && path[end - 1] === "/") end -= 1;
  return path.slice(0, end);
}

/** Lexically resolve `value` against `base`. */
export function resolvePosix(base: string, value: string): string {
  const combined = value.startsWith("/") ? value : `${base}/${value}`;
  const segments: string[] = [];
  for (const segment of combined.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return `/${segments.join("/")}`;
}

/** True when `candidate` is `root` or lies beneath it. */
export function containsPosix(root: string, candidate: string): boolean {
  const normalized = root === "/" ? "/" : stripTrailingSlashes(root);
  if (candidate === normalized) return true;
  return candidate.startsWith(normalized === "/" ? "/" : `${normalized}/`);
}
