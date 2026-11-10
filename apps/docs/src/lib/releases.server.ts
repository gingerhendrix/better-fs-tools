import { githubReleases, type GitHubReleases } from "@fumadocs/changelog/github";

type CachedReleases = Omit<GitHubReleases, "entries"> & {
  entries: (Omit<GitHubReleases["entries"][number], "date"> & { date: string })[];
};

export async function getReleases(page: number): Promise<GitHubReleases> {
  // Workers provide caches.default; plain Vite development does not.
  const cache = (globalThis.caches as (CacheStorage & { default?: Cache }) | undefined)?.default;
  const cacheKey = `https://betterfs.dev/_cache/github-releases?page=${page}`;

  try {
    const cached = await cache?.match(cacheKey);
    if (cached) {
      const releases = (await cached.json()) as CachedReleases;
      return {
        ...releases,
        entries: releases.entries.map((entry) => ({ ...entry, date: new Date(entry.date) })),
      };
    }
  } catch {
    // A cache failure should not prevent reading releases from GitHub.
  }

  const releases = await githubReleases({
    owner: "gingerhendrix",
    repo: "better-fs-tools",
    token: process.env.GITHUB_TOKEN,
    page,
  });

  try {
    await cache?.put(
      cacheKey,
      new Response(JSON.stringify(releases), {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "public, max-age=3600",
        },
      }),
    );
  } catch {
    // Releases are still usable if the Worker cache is unavailable.
  }

  return releases;
}
