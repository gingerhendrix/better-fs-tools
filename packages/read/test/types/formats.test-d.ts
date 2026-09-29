// Type tests: `tsc -b` checks this file; Bun never runs it.
import { memoryFileSystem } from "@better-fs-tools/fs";

import {
  deepAgentsFormat,
  hashlineFormat,
  hermesFormat,
  opencodeFormat,
} from "../../src/formats/index.ts";
import {
  createReadTool,
  eofFooter,
  fileHashHeader,
  hashlineGutter,
  lineNumberFormatter,
} from "../../src/index.ts";
import type { ReadFormatter, LineNumberFormatterOptions } from "../../src/index.ts";

interface Host {
  readonly id: string;
}

const fs = memoryFileSystem();

// Each preset fits a tool with a typed host, and a tool with no host.
export const opencode = createReadTool<Host>({ fs, formatter: opencodeFormat() });
export const deepAgents = createReadTool<Host>({ fs, formatter: deepAgentsFormat() });
export const hashline = createReadTool<Host>({ fs, formatter: hashlineFormat() });
export const hermes = createReadTool<Host>({ fs, formatter: hermesFormat() });
export const plain = createReadTool({ fs, formatter: hashlineFormat() });
export const asHostFormatter: ReadFormatter<Host> = opencodeFormat();

// The helpers fill the lineNumberFormatter options.
export const gutter: NonNullable<LineNumberFormatterOptions["gutter"]> = hashlineGutter({
  width: 3,
});
export const custom = createReadTool<Host>({
  fs,
  formatter: lineNumberFormatter({
    gutter: hashlineGutter(),
    header: fileHashHeader(),
    footer: eofFooter((n) => `${n}`),
  }),
});

// @ts-expect-error width is a number
hashlineGutter({ width: "2" });
// @ts-expect-error the footer text takes the total line count
eofFooter((n: string) => n);
// @ts-expect-error presets take no options
opencodeFormat({});
