import type { PathResolver } from "@better-fs-tools/read";

export const workspaceAlias: PathResolver<unknown> = {
  id: "workspace-alias",
  resolve: (path) =>
    path.startsWith("$WS/")
      ? { kind: "path", path: `/workspace/${path.slice(4)}` }
      : { kind: "path", path },
};
