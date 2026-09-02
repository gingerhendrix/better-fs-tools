import { createFileRoute, notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { useFumadocsLoader } from "fumadocs-core/source/client";
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { DocsBody, DocsDescription, DocsPage, DocsTitle } from "fumadocs-ui/layouts/docs/page";
import { Suspense, use } from "react";
import { useMDXComponents } from "@/components/mdx";
import { baseOptions } from "@/lib/layout";
import { docs, source } from "@/lib/source";

const loadPage = createServerFn({ method: "GET" }).handler(async () => {
  const page = source.getPage([]);
  if (!page) throw notFound();

  return {
    path: page.path,
    pageTree: await source.serializePageTree(source.getPageTree()),
  };
});

export const Route = createFileRoute("/")({
  loader: async () => {
    const data = await loadPage();
    await docs.getPage(data.path)?.preload();
    return data;
  },
  component: Documentation,
});

function Content({ path }: Readonly<{ path: string }>) {
  const page = docs.getPage(path);
  if (!page) throw new Error(`Unknown documentation page: ${path}`);

  const { toc } = use(page.load());
  const MDX = page.body;

  return (
    <DocsPage toc={toc}>
      <DocsTitle>{page.title}</DocsTitle>
      <DocsDescription>{page.description}</DocsDescription>
      <DocsBody>
        <MDX components={useMDXComponents()} />
      </DocsBody>
    </DocsPage>
  );
}

function Documentation() {
  const data = useFumadocsLoader(Route.useLoaderData());

  return (
    <DocsLayout {...baseOptions()} tree={data.pageTree}>
      <Suspense>
        <Content path={data.path} />
      </Suspense>
    </DocsLayout>
  );
}
