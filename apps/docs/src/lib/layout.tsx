import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";
import { BetterFsToolsLogo } from "@/components/better-fs-tools-logo";

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: <BetterFsToolsLogo className="h-10 w-auto" />,
    },
  };
}
