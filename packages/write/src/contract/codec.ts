import type { ClassificationSample } from "@better-fs-tools/read";

export interface TextStyle {
  /** For example "utf-8". */
  readonly encoding: string;
  readonly bom: boolean;
  /** "crlf": decode turned every CRLF into LF, encode turns LF back. "keep": no conversion (LF-only, mixed, or new). */
  readonly eol: "lf" | "crlf" | "keep";
}

export type DecodeOutcome =
  | { readonly ok: true; readonly text: string; readonly style: TextStyle }
  | { readonly ok: false; readonly detail: string };

export interface Codec {
  readonly id: string;
  /** Whether this codec can decode the file, judged from a sample of its first bytes. Sync. */
  accepts(sample: ClassificationSample): boolean;
  decode(bytes: Uint8Array): DecodeOutcome;
  /** encode(decode(bytes).text, style) must give the same bytes back, or the file is refused as not text. */
  encode(text: string, style: TextStyle): Uint8Array;
  /** Style for a new file. */
  readonly newFileStyle: TextStyle;
}
