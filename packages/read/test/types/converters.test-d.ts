// Type tests: `tsc -b` checks this file; Bun never runs it.
import { memoryFileSystem } from "@better-fs-tools/fs";

import {
  createReadTool,
  directoryListing,
  imageConverter,
  notebookConverter,
  textConverter,
} from "../../src/index.ts";
import type {
  ContentPart,
  Converter,
  ConvertOutcome,
  DirectoryConverter,
  FileConverter,
  ReadHookContext,
  ReadMedia,
  ReadReport,
} from "../../src/index.ts";

interface Host {
  readonly id: string;
}

const fs = memoryFileSystem();

async function* nothing(): AsyncIterable<string> {}

// Host-free converters fit a tool with a typed host, and a tool with none.
export const hostFree = createReadTool<Host>({
  fs,
  converters: [
    imageConverter(),
    notebookConverter(),
    textConverter({ id: "t", accepts: () => true, mimeType: null, run: nothing }),
    directoryListing({ trailingSlash: true }),
  ],
});
export const plainTool = createReadTool({ fs, converters: [imageConverter(), directoryListing()] });
export const unknownFile: FileConverter<Host> = notebookConverter();
export const unknownDirectory: DirectoryConverter<Host> = directoryListing();
export const unknownConverter: Converter<Host> = imageConverter();

// A host-typed converter reads ctx.call.host with its type.
const sessionConverter: FileConverter<Host> = {
  id: "session",
  target: "file",
  accepts: () => true,
  async convert(_input, ctx) {
    return { kind: "text", text: ctx.call.host.id, mimeType: null };
  },
};
const sessionDirectory: DirectoryConverter<Host> = {
  id: "session-dir",
  target: "directory",
  async convert(input, ctx) {
    const listed = await input.list();
    return { kind: "text", text: `${ctx.call.host.id} ${String(listed.ok)}`, mimeType: null };
  },
};
export const mixed = createReadTool<Host>({
  fs,
  converters: [sessionConverter, imageConverter(), sessionDirectory, directoryListing()],
});

// imageConverter and textConverter take their host type from the tool, with no type argument.
export const typedTransform = createReadTool<Host>({
  fs,
  converters: [
    imageConverter({
      transform: async (bytes, _mediaType, ctx) => bytes.subarray(0, ctx.call.host.id.length),
    }),
    textConverter({
      id: "t",
      accepts: () => true,
      mimeType: null,
      run: async function* (_source, ctx) {
        yield ctx.call.host.id;
      },
    }),
  ],
});

createReadTool<Host>({
  fs,
  converters: [
    // @ts-expect-error the host has no session field
    imageConverter({ transform: async (bytes, _type, ctx) => ctx.call.host.session ?? bytes }),
  ],
});

// A converter for another host type does not fit.
declare const otherConverter: FileConverter<{ user: number }>;
// @ts-expect-error the host types differ
createReadTool<Host>({ fs, converters: [otherConverter] });

// Context types widen to unknown.
declare const hook: ReadHookContext<Host>;
export const widened: ReadHookContext<unknown> = hook;

// A file converter needs accepts; a directory converter has none to call.
// @ts-expect-error accepts is required for target "file"
export const noAccepts: FileConverter<unknown> = {
  id: "x",
  target: "file",
  convert: async () => ({ kind: "text", text: "", mimeType: null }),
};

// The outcome and the parts are closed shapes.
// @ts-expect-error "html" is not an outcome kind
export const badKind: ConvertOutcome = { kind: "html", text: "" };
// @ts-expect-error media data is bytes, not base64
export const badPart: ContentPart = { type: "media", mediaType: "image/png", data: "iVBOR" };
export const refusal: ConvertOutcome = {
  kind: "refuse",
  code: "X",
  note: { code: "x", severity: "info", message: "x" },
};

// ReadMedia is an outcome with parts and a conversion.
export function partsOf(outcome: ReadReport): readonly ContentPart[] {
  if (outcome.status === "media") {
    const media: ReadMedia = outcome;
    return media.conversion.converter === "" ? [] : media.parts;
  }
  return [];
}
