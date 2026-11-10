import { redirect } from "@tanstack/react-router";
import { createMiddleware, createStart } from "@tanstack/react-start";
import { isMarkdownPreferred } from "fumadocs-core/negotiation";
import { getPageMarkdownUrl } from "@/lib/shared";
import { source } from "@/lib/source";

const llmMiddleware = createMiddleware().server(async ({ next, request }) => {
  const url = new URL(request.url);
  if (
    url.pathname.startsWith("/changelog") ||
    url.pathname.startsWith("/api") ||
    /\.[^/]+(?:\/|$)/.test(url.pathname)
  ) {
    return next();
  }

  let slugs;
  try {
    slugs = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  } catch {
    return next();
  }

  const page = source.getPage(slugs);
  if (!page) return next();

  if (isMarkdownPreferred(request)) {
    url.pathname = getPageMarkdownUrl(page).url;
    throw redirect({ href: url.href, headers: { Vary: "Accept" } });
  }

  const result = await next();
  result.response.headers.append("Vary", "Accept");
  return result;
});

export const startInstance = createStart(() => ({
  requestMiddleware: [llmMiddleware],
}));
