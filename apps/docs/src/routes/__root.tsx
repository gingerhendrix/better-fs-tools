import { HeadContent, Link, Outlet, Scripts, createRootRoute } from "@tanstack/react-router";
import { RootProvider } from "fumadocs-ui/provider/tanstack";
import type { ReactNode } from "react";
import appCss from "@/styles/app.css?url";

const description = "Focused filesystem tools for TypeScript.";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Better FS Tools" },
      { name: "description", content: description },
      { property: "og:title", content: "Better FS Tools" },
      { property: "og:description", content: description },
      { property: "og:type", content: "website" },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  component: RootComponent,
  notFoundComponent: NotFound,
});

function NotFound() {
  return (
    <main className="mx-auto flex max-w-xl flex-1 flex-col justify-center gap-4 px-6 py-16">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="text-fd-muted-foreground">This page does not exist. It may have moved.</p>
      <p className="flex gap-4">
        <Link to="/" className="underline">
          Home
        </Link>
        <Link to="/$" params={{ _splat: "get-started" }} className="underline">
          Get started
        </Link>
      </p>
    </main>
  );
}

function RootComponent() {
  return (
    <RootDocument>
      <Outlet />
    </RootDocument>
  );
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body className="flex min-h-screen flex-col">
        <RootProvider>{children}</RootProvider>
        <Scripts />
      </body>
    </html>
  );
}
