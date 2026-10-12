import { loader } from "fumadocs-core/source";
import { pageSchema } from "fumadocs-core/source/schema";
import { defineDocs } from "fumadocs-mdx/macro";
import { z } from "zod";
import { comparisonCategories, comparisonLanguages, comparisonTagsPlugin } from "./comparison-tags";

export const docs = defineDocs({
  dir: "content/docs",
  docs: {
    async: true,
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
