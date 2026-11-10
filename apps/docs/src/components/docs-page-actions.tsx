import { MarkdownCopyButton, ViewOptionsPopover } from "fumadocs-ui/layouts/docs/page";

export function DocsPageActions({
  path,
  markdownUrl,
}: Readonly<{ path: string; markdownUrl: string }>) {
  return (
    <div className="flex flex-row items-center gap-2 border-b pt-2 pb-6">
      <MarkdownCopyButton markdownUrl={markdownUrl} />
      <ViewOptionsPopover
        markdownUrl={markdownUrl}
        githubUrl={`https://github.com/gingerhendrix/better-fs-tools/blob/main/apps/docs/content/docs/${encodeURI(path)}`}
      />
    </div>
  );
}
