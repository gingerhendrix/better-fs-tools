import type { Digest, DigestStream } from "../contract/digest.ts";

/* FIPS 180-4, section 4.2.2: the first 32 bits of the fractional parts of the cube roots of the first 64 primes. */
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/* Section 5.3.3: the first 32 bits of the fractional parts of the square roots of the first 8 primes. */
const INITIAL = [
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
] as const;

const ENCODER = new TextEncoder();

/**
 * SHA-256 in plain JavaScript, with no Node module, so it works in a Cloudflare
 * Worker. It gives the same hashes as `nodeDigest()` from
 * `@better-fs-tools/node`, so both can share one state store.
 */
export function sha256Digest(): Digest {
  return Object.freeze({
    id: "sha256",
    create: (): DigestStream => new Sha256Stream(),
    hash(value: string): string {
      const stream = new Sha256Stream();
      stream.update(ENCODER.encode(value));
      return stream.digest();
    },
  });
}

class Sha256Stream implements DigestStream {
  private readonly state = Uint32Array.from(INITIAL);
  private readonly block = new Uint8Array(64);
  private readonly words = new Uint32Array(64);
  private filled = 0;
  // A double holds every length below 2^53 exactly.
  private totalBytes = 0;
  private finished = false;

  update(bytes: Uint8Array): void {
    if (this.finished) throw new TypeError("sha256 stream is already finished");
    this.totalBytes += bytes.byteLength;
    let offset = 0;
    if (this.filled > 0) {
      const take = Math.min(64 - this.filled, bytes.byteLength);
      this.block.set(bytes.subarray(0, take), this.filled);
      this.filled += take;
      offset = take;
      if (this.filled < 64) return;
      this.compress(this.block, 0);
      this.filled = 0;
    }
    for (; offset + 64 <= bytes.byteLength; offset += 64) this.compress(bytes, offset);
    if (offset < bytes.byteLength) {
      this.block.set(bytes.subarray(offset), 0);
      this.filled = bytes.byteLength - offset;
    }
  }

  digest(): string {
    if (this.finished) throw new TypeError("sha256 stream is already finished");
    this.finished = true;
    const bits = this.totalBytes * 8;
    this.block[this.filled] = 0x80;
    this.block.fill(0, this.filled + 1);
    if (this.filled >= 56) {
      this.compress(this.block, 0);
      this.block.fill(0);
    }
    setUint64BigEndian(new DataView(this.block.buffer), 56, bits);
    this.compress(this.block, 0);
    let hex = "sha256:";
    for (const word of this.state) hex += word.toString(16).padStart(8, "0");
    return hex;
  }

  private compress(bytes: Uint8Array, offset: number): void {
    const w = this.words;
    for (let i = 0; i < 16; i++) {
      const j = offset + i * 4;
      w[i] = (bytes[j]! << 24) | (bytes[j + 1]! << 16) | (bytes[j + 2]! << 8) | bytes[j + 3]!;
    }
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15]!;
      const b = w[i - 2]!;
      const s0 = rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3);
      const s1 = rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) | 0;
    }
    const s = this.state;
    let a = s[0]!;
    let b = s[1]!;
    let c = s[2]!;
    let d = s[3]!;
    let e = s[4]!;
    let f = s[5]!;
    let g = s[6]!;
    let h = s[7]!;
    for (let i = 0; i < 64; i++) {
      const t1 =
        (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i]! + w[i]!) | 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) | 0;
    }
    s[0] = s[0]! + a;
    s[1] = s[1]! + b;
    s[2] = s[2]! + c;
    s[3] = s[3]! + d;
    s[4] = s[4]! + e;
    s[5] = s[5]! + f;
    s[6] = s[6]! + g;
    s[7] = s[7]! + h;
  }
}

function setUint64BigEndian(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, Math.floor(value / 0x1_0000_0000));
  view.setUint32(offset + 4, value >>> 0);
}

function rotr(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}
