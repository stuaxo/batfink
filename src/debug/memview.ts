// Render an arbitrary block of memory as a CPC bitmap — for looking at sprite
// sheets, tiles, fonts or a second screen buffer while the program runs. A pure
// function; the UI owns the canvas.
import { PIXEL_TABLES, CPC_PALETTE } from '../cpc';

export interface GfxParams {
  addr: number;
  mode: 0 | 1 | 2;
  /** bytes per row of the source data */
  widthBytes: number;
  rows: number;
  /** 'linear' = flat data; 'screen' = the CPC's interleaved &800 blocks */
  layout: 'linear' | 'screen';
}

export interface GfxImage {
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
}

const DOTS_PER_BYTE = [2, 4, 8] as const;

/** `pens` is the 17-entry palette (pens 0-15 + border); values 0x00-0x1F. */
export function renderGfx(read: (addr: number) => number, pens: Uint8Array, p: GfxParams): GfxImage {
  const dots = DOTS_PER_BYTE[p.mode];
  const width = Math.max(1, p.widthBytes * dots);
  const height = Math.max(1, p.rows);
  const rgba = new Uint8ClampedArray(width * height * 4);
  const table = PIXEL_TABLES[p.mode];

  for (let row = 0; row < height; row++) {
    for (let col = 0; col < p.widthBytes; col++) {
      const src = p.layout === 'screen'
        ? p.addr + (row & 7) * 0x800 + (row >> 3) * p.widthBytes + col
        : p.addr + row * p.widthBytes + col;
      const decoded = table[read(src & 0xffff)];
      for (let i = 0; i < decoded.length; i++) {
        const x = col * dots + i;
        if (x >= width) break;
        const c = CPC_PALETTE[pens[decoded[i]] & 0x1f];
        const o = (row * width + x) * 4;
        rgba[o] = c[0]; rgba[o + 1] = c[1]; rgba[o + 2] = c[2]; rgba[o + 3] = 255;
      }
    }
  }
  return { width, height, rgba };
}
