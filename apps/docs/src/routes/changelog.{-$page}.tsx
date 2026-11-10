import { createFileRoute, notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { HomeLayout } from "fumadocs-ui/layouts/home";
import { ChangelogPagination, ChangelogTimeline } from "@/components/changelog";
import { baseOptions } from "@/lib/layout";
import { getReleases } from "@/lib/releases.server";

const loadReleases = createServerFn({ method: "GET" })
  .validator((page: number) => {
    if (!Number.isSafeInteger(page) || page < 1) throw notFound();
    return page;
  })
  .handler(async ({ data: page }) => {
    let releases;
    try {
      releases = await getReleases(page);
    } catch {
      return null;
    }

    if (releases.entries.length === 0) throw notFound();
    return releases;
  });

export const Route = createFileRoute("/changelog/{-$page}")({
  loader: async ({ params }) => {
    const page = Number(params.page ?? 1);
    return { page, releases: await loadReleases({ data: page }) };
  },
  head: () => ({ meta: [{ title: "Changelog | Better FS Tools" }] }),
  component: Changelog,
});

function Changelog() {
  const { page, releases } = Route.useLoaderData();

  return (
    <HomeLayout {...baseOptions()}>
      <main className="mx-auto flex w-full max-w-[900px] flex-col gap-10 px-4 py-12">
        <h1 className="text-3xl font-semibold">Changelog</h1>
        {releases ? (
          <>
            <ChangelogTimeline entries={releases.entries} />
            <ChangelogPagination
              newer={page > 1 ? (page === 2 ? "/changelog" : `/changelog/${page - 1}`) : undefined}
              older={releases.nextPage ? `/changelog/${releases.nextPage}` : undefined}
            />
          </>
        ) : (
          <p className="text-fd-muted-foreground">
            Releases are temporarily unavailable.{" "}
            <a
              href="https://github.com/gingerhendrix/better-fs-tools/releases"
              className="underline"
            >
              View releases on GitHub
            </a>
            .
          </p>
        )}
      </main>
    </HomeLayout>
  );
}
