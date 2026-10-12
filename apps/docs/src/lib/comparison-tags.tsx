import type { LoaderPlugin } from "fumadocs-core/source";
import { Blocks, Layers, SquareTerminal, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

/** What a compared project ships: a library to build agents, an agent to run, or both. */
export const comparisonCategories = ["framework", "harness", "both"] as const;
export type ComparisonCategory = (typeof comparisonCategories)[number];

/** Main implementation language of the compared tool code. */
export const comparisonLanguages = ["typescript", "python", "rust"] as const;
export type ComparisonLanguage = (typeof comparisonLanguages)[number];

const categoryLabels: Record<ComparisonCategory, string> = {
  framework: "Framework",
  harness: "Harness",
  both: "Framework and harness",
};

const categoryIcons: Record<ComparisonCategory, LucideIcon> = {
  framework: Blocks,
  harness: SquareTerminal,
  both: Layers,
};

const languageLabels: Record<ComparisonLanguage, string> = {
  typescript: "TypeScript",
  python: "Python",
  rust: "Rust",
};

const languageBadges: Record<ComparisonLanguage, string> = {
  typescript: "TS",
  python: "PY",
  rust: "RS",
};

function isOneOf<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}

function ComparisonTags({
  name,
  category,
  language,
}: {
  name: ReactNode;
  category: ComparisonCategory;
  language: ComparisonLanguage;
}) {
  const CategoryIcon = categoryIcons[category];
  const label = `${categoryLabels[category]}, ${languageLabels[language]}`;

  return (
    <span className="comparison-tags-row flex w-full min-w-0 items-center gap-2">
      <span className="min-w-0 flex-1 truncate">{name}</span>
      <span
        className="ms-auto flex shrink-0 items-center gap-1.5 text-fd-muted-foreground"
        title={label}
      >
        <CategoryIcon aria-hidden="true" className="size-3.5" strokeWidth={1.75} />
        <span
          aria-hidden="true"
          className="w-5 rounded-sm border border-current/30 text-center font-mono text-[9px] leading-[14px] font-medium"
        >
          {languageBadges[language]}
        </span>
        <span className="sr-only">{label}</span>
      </span>
    </span>
  );
}

/**
 * Appends a category icon and a language badge to each sidebar link whose page
 * sets both `category` and `language` in its frontmatter. Other pages keep their plain name.
 */
export function comparisonTagsPlugin(): LoaderPlugin {
  return {
    name: "better-fs-tools:comparison-tags",
    transformPageTree: {
      file(node, filePath) {
        if (!filePath) return node;
        const file = this.storage.read(filePath);
        if (file?.format !== "page") return node;

        // The base page type declares no index signature, so copy it into a plain record.
        const { category, language }: Record<string, unknown> = { ...file.data };
        if (!isOneOf(comparisonCategories, category)) return node;
        if (!isOneOf(comparisonLanguages, language)) return node;

        return {
          ...node,
          name: <ComparisonTags name={node.name} category={category} language={language} />,
        };
      },
    },
  };
}
