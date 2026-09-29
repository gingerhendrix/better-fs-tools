import { defaultReadLimits } from "../../src/index.ts";
import type { ReadFormatContext, ReadMedia } from "../../src/index.ts";

export const PIXELS = Uint8Array.from([0x89, 0x50, 0x4e, 0x47]);

export const mediaOutcome: ReadMedia = {
  tool: "read",
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

export function formatContext(mode: "model" | "view"): ReadFormatContext<unknown> {
  return { digest: null, limits: defaultReadLimits, mode, call: { host: undefined } };
}
