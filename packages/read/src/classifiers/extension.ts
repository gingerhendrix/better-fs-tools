import type { Classifier, NoteOverride } from "../contract/classify.ts";
import { classifier, refusal } from "./shared.ts";

export interface ExtensionClassifierOptions {
  /** Keyed by extension, with or without the leading dot. Case-insensitive. */
  readonly unsupported?: Readonly<
    Record<string, { code: string; mimeType?: string; note?: NoteOverride }>
  >;
  /** Extensions forced to text. */
  readonly text?: readonly string[];
}

/**
 * Extension-only detection (Deep Agents, Mastra). Place it before
 * defaultClassifiers(). It never reads the bytes, so its confidence is
 * "medium". An extension it does not know gets no opinion.
 */
export function extensionClassifier(options: ExtensionClassifierOptions): Classifier {
  const unsupported = new Map(
    Object.entries(options.unsupported ?? {}).map(([key, value]) => [normalize(key), value]),
  );
  const text = new Set((options.text ?? []).map(normalize));

  return classifier("extension", (sample) => {
    const extension = extensionOf(sample.path);
    if (extension === null) return null;
    const refused = unsupported.get(extension);
    if (refused !== undefined) {
      return refusal({
        code: refused.code,
        mimeType: refused.mimeType ?? null,
        confidence: "medium",
        reasons: [`extension:${extension}`],
        sample,
        override: refused.note,
        message: `Files with the .${extension} extension are not supported as UTF-8 text.`,
      });
    }
    if (!text.has(extension)) return null;
    return {
      kind: "text",
      mimeType: sample.mimeType ?? "text/plain",
      confidence: "medium",
      reasons: [`extension:${extension}`],
    };
  });
}

function normalize(extension: string): string {
  return extension.replace(/^\./u, "").toLowerCase();
}

function extensionOf(path: string): string | null {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const index = name.lastIndexOf(".");
  if (index <= 0 || index === name.length - 1) return null;
  return name.slice(index + 1).toLowerCase();
}
