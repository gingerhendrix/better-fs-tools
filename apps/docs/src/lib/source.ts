import { llms, loader } from "fumadocs-core/source";
import { pageSchema } from "fumadocs-core/source/schema";
import { defineDocs } from "fumadocs-mdx/macro";
import { z } from "zod";
import { comparisonCategories, comparisonLanguages, comparisonTagsPlugin } from "./comparison-tags";

export const docs = defineDocs({
  dir: "content/docs",
  docs: {
    async: true,
    postprocess: {
      includeProcessedMarkdown: true,
    },
    schema: pageSchema.extend({
      category: z.enum(comparisonCategories).optional(),
      language: z.enum(comparisonLanguages).optional(),
    }),
  },
});

export const source = loader({
  baseUrl: "/",
  source: docs.toFumadocsSource(),
  plugins: [comparisonTagsPlugin()],
});

export const docsLlms = llms(source, {
  renderPage: async (page) => `# ${page.data.title} (${page.url})

${await page.data.getText("processed")}`,
});
