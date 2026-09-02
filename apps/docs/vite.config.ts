import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { fumadocsMdx } from "fumadocs-mdx/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [fumadocsMdx(), tailwindcss(), tanstackStart(), react()],
  environments: {
    ssr: {
      optimizeDeps: {
        include: ["fumadocs-mdx/runtime/macro"],
      },
    },
  },
  resolve: {
    tsconfigPaths: true,
  },
});
