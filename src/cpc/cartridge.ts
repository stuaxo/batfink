// Amstrad Plus / GX4000 cartridge images (.cpr). A RIFF file, form type `AMS!`,
// carrying up to 32 chunks `cb00`..`cb31` of one 16K ROM block each. The Plus
// serves its ROM space from these blocks the way a classic CPC serves it from
// masked ROMs — see ./rom.

const BLOCK = 0x4000;
const MAX_BLOCKS = 32;

const tag = (b: Uint8Array, o: number): string =>
  String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);

/** Parse a `.cpr` into its 16K blocks, densely indexed from 0. Missing blocks
 *  up to the highest present one are zero-filled; block 0 must be present. */
export function readCpr(bytes: Uint8Array): Uint8Array[] {
  if (bytes.length < 12 || tag(bytes, 0) !== 'RIFF') throw new Error('not a RIFF file');
  if (tag(bytes, 8) !== 'AMS!') throw new Error('not an Amstrad Plus cartridge (.cpr)');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  const blocks: (Uint8Array | undefined)[] = [];
  let o = 12;
  while (o + 8 <= bytes.length) {
    const id = tag(bytes, o);
    const size = dv.getUint32(o + 4, true);
    o += 8;
    const m = /^cb([0-9]{2})$/.exec(id);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n < MAX_BLOCKS) {
        const page = new Uint8Array(BLOCK);
        page.set(bytes.subarray(o, o + Math.min(size, BLOCK)));
        blocks[n] = page;
      }
    }
    o += size + (size & 1); // RIFF pads chunks to an even length
  }

  if (!blocks[0]) throw new Error('cartridge has no block 0');
  const pages: Uint8Array[] = [];
  for (let i = 0; i < blocks.length; i++) pages[i] = blocks[i] ?? new Uint8Array(BLOCK);
  return pages;
}

/** Build a `.cpr` from 16K blocks. Trailing all-zero blocks are dropped. */
export function writeCpr(pages: Uint8Array[]): Uint8Array {
  let last = pages.length - 1;
  while (last > 0 && pages[last]?.every((v) => v === 0)) last--;
  const used = pages.slice(0, last + 1);

  const body = 4 + used.length * (8 + BLOCK); // 'AMS!' + chunks
  const out = new Uint8Array(8 + body);
  const dv = new DataView(out.buffer);
  const put = (o: number, s: string) => { for (let i = 0; i < s.length; i++) out[o + i] = s.charCodeAt(i); };

  put(0, 'RIFF');
  dv.setUint32(4, body, true);
  put(8, 'AMS!');
  let o = 12;
  used.forEach((page, n) => {
    put(o, 'cb' + String(n).padStart(2, '0'));
    dv.setUint32(o + 4, BLOCK, true);
    out.set(page.subarray(0, BLOCK), o + 8);
    o += 8 + BLOCK;
  });
  return out;
}
