import { defaultLimits } from "../../src/index.ts";
import type { FormatContext, ReadMedia } from "../../src/index.ts";

export const PIXELS = Uint8Array.from([0x89, 0x50, 0x4e, 0x47]);

/** A media outcome with a caption part, an image part, and one note. */
export const mediaOutcome: ReadMedia = {
  status: "media",
  request: { path: "/a.png", offset: 1, limit: 2_000, ranged: false },
  file: {
    requestedPath: "/a.png",
    resolvedPath: "/a.png",
    displayPath: "/a.png",
    backend: "memory",
    size: 4,
    mtimeMs: null,
    identity: null,
    mimeType: null,
    resolvedFrom: null,
    version: null,
  },
  classification: {
    kind: "unsupported",
    classifier: "image",
    code: "IMAGE",
    mimeType: "image/png",
    confidence: "high",
    reasons: ["image-magic"],
  },
  conversion: { converter: "image", mimeType: "image/png" },
  parts: [
    { type: "text", text: "caption" },
    { type: "media", mediaType: "image/png", data: PIXELS, name: "a.png" },
  ],
  observation: null,
  notes: [{ code: "resized", severity: "info", message: "Resized." }],
};

export function formatContext(mode: "model" | "view"): FormatContext<unknown> {
  return { digest: null, limits: defaultLimits, mode, call: { host: undefined } };
}
