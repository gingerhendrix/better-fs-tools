import type { Codec, TextStyle } from "../contract/codec.ts";

const BOM = Uint8Array.of(0xef, 0xbb, 0xbf);
const NEW_FILE_STYLE: TextStyle = Object.freeze({ encoding: "utf-8", bom: false, eol: "keep" });

/**
 * UTF-8 with the BOM and line endings kept. Accepts a sample that is valid
 * UTF-8, allowing a character cut at the end of a partial sample. Decode
 * strips one BOM. When every LF in the file follows a CR (and there is at
 * least one), the style is "crlf": decode turns CRLF into LF and encode turns
 * LF back. A file with no CRLF is "lf". Any other mix is "keep", with no
 * conversion. Encode of a decoded text gives the same bytes back.
 */
export function utf8Codec(): Codec {
  return Object.freeze<Codec>({
    id: "utf-8",
    newFileStyle: NEW_FILE_STYLE,
    accepts(sample) {
      try {
        new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(sample.bytes, {
          stream: !sample.complete,
        });
        return true;
      } catch {
        return false;
      }
    },
    decode(bytes) {
      const bom = startsWithBom(bytes);
      let raw: string;
      try {
        raw = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
          bom ? bytes.subarray(BOM.byteLength) : bytes,
        );
      } catch {
        return { ok: false, detail: "invalid UTF-8" };
      }
      const eol = lineEndings(raw);
      const text = eol === "crlf" ? raw.replaceAll("\r\n", "\n") : raw;
      return { ok: true, text, style: { encoding: "utf-8", bom, eol } };
    },
    encode(text, style) {
      const body = new TextEncoder().encode(
        style.eol === "crlf" ? text.replaceAll("\n", "\r\n") : text,
      );
      if (!style.bom) return body;
      const bytes = new Uint8Array(BOM.byteLength + body.byteLength);
      bytes.set(BOM);
      bytes.set(body, BOM.byteLength);
      return bytes;
    },
  });
}

function startsWithBom(bytes: Uint8Array): boolean {
  return bytes[0] === BOM[0] && bytes[1] === BOM[1] && bytes[2] === BOM[2];
}

/** "crlf" when every LF follows a CR and there is at least one, "lf" when none does, else "keep". */
function lineEndings(text: string): TextStyle["eol"] {
  let lf = 0;
  let crlf = 0;
  for (let index = text.indexOf("\n"); index !== -1; index = text.indexOf("\n", index + 1)) {
    lf += 1;
    if (index > 0 && text.charCodeAt(index - 1) === 13) crlf += 1;
  }
  if (crlf === 0) return "lf";
  return crlf === lf ? "crlf" : "keep";
}
