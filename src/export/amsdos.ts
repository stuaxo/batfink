// AMSDOS 128-byte file header. Prepended to a binary so AMSDOS recognises it and
// knows where to load and run it. Layout and the 67-byte checksum follow the
// firmware spec.

export interface AmsdosMeta {
  /** 1-8 chars before the dot, 0-3 after. Case and padding are handled here. */
  filename: string;
  /** 0 = BASIC, 1 = protected, 2 = binary. Defaults to binary. */
  type?: number;
  loadAddr: number;
  /** Defaults to loadAddr. */
  entryAddr?: number;
}

/** `NAME.EXT` -> 8-byte name and 3-byte extension, space padded, upper case. */
export function amsdosName(filename: string): { name: Uint8Array; ext: Uint8Array } {
  const dot = filename.lastIndexOf('.');
  const stem = (dot >= 0 ? filename.slice(0, dot) : filename).toUpperCase();
  const suffix = (dot >= 0 ? filename.slice(dot + 1) : '').toUpperCase();
  const pad = (s: string, n: number) => {
    const b = new Uint8Array(n).fill(0x20);
    for (let i = 0; i < Math.min(s.length, n); i++) b[i] = s.charCodeAt(i) & 0x7f;
    return b;
  };
  return { name: pad(stem, 8), ext: pad(suffix, 3) };
}

/** Sum of the first 67 header bytes, as a 16-bit value. */
export function amsdosChecksum(header: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < 67; i++) sum += header[i];
  return sum & 0xffff;
}

/** Build the 128-byte header for `data` (the length is taken from `data`). */
export function amsdosHeader(data: Uint8Array, meta: AmsdosMeta): Uint8Array {
  const h = new Uint8Array(128);
  const { name, ext } = amsdosName(meta.filename);
  h.set(name, 1);
  h.set(ext, 9);
  h[18] = meta.type ?? 2;
  const len = data.length;
  const entry = meta.entryAddr ?? meta.loadAddr;
  h[19] = len & 0xff; h[20] = (len >> 8) & 0xff;
  h[21] = meta.loadAddr & 0xff; h[22] = (meta.loadAddr >> 8) & 0xff;
  h[24] = len & 0xff; h[25] = (len >> 8) & 0xff;
  h[26] = entry & 0xff; h[27] = (entry >> 8) & 0xff;
  h[64] = len & 0xff; h[65] = (len >> 8) & 0xff; h[66] = (len >> 16) & 0xff;
  const ck = amsdosChecksum(h);
  h[67] = ck & 0xff; h[68] = (ck >> 8) & 0xff;
  return h;
}

/** `data` with a fresh 128-byte AMSDOS header in front. */
export function withAmsdosHeader(data: Uint8Array, meta: AmsdosMeta): Uint8Array {
  const out = new Uint8Array(128 + data.length);
  out.set(amsdosHeader(data, meta), 0);
  out.set(data, 128);
  return out;
}

/** True if `data` starts with a header whose stored checksum matches. */
export function hasAmsdosHeader(data: Uint8Array): boolean {
  if (data.length < 128) return false;
  let or = 0;
  for (let i = 0; i < 69; i++) or |= data[i];
  if (!or) return false;
  const stored = data[67] | (data[68] << 8);
  return stored === amsdosChecksum(data.subarray(0, 128));
}
