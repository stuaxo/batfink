// Turns the current machine state into pixels. Each scanline opens with its own
// palette snapshot (m.linePens / m.linePal12) so raster splits survive into the
// border; pen writes made partway through a line's active display
// (m.paletteWrites) then take effect from that point rightward, for mid-line
// colour changes. With a Plus ASIC the palette is 12-bit, otherwise the
// 27-colour Gate Array table.
import { CPC_PALETTE, type Rgb } from './palette';
import { hwTo12 } from './asic';
import { spritePixel } from './sprites';
import { PIXEL_TABLES } from './pixels';
import { BORDER_X, BORDER_Y, WIDTH, LINES_PER_FRAME, PENS_PER_LINE } from './constants';
import type { CPCMachine } from './machine';
import { type FrameView, frameView } from './frameview';

const P = PENS_PER_LINE;

const unpack12 = (c: number): Rgb =>
  [((c >> 8) & 0xf) * 17, ((c >> 4) & 0xf) * 17, (c & 0xf) * 17];

/** Render one frame into an RGBA buffer, BORDER_X/BORDER_Y included. */
export function renderFrame(m: CPCMachine, rgba: Uint8ClampedArray): void {
  renderView(frameView(m), rgba);
}

/** The software renderer: a `FrameView` to RGBA. The reference implementation
 *  and the test oracle — see plan/webgl-renderer.md. */
export function renderView(v: FrameView, rgba: Uint8ClampedArray): void {
  const { crtc, ram, linePens, linePal12 } = v;
  const base = (crtc[12] & 0x30) << 10;
  const offset = (((crtc[12] & 0x03) << 8) | crtc[13]) * 2;
  const bytesPerLine = crtc[1] * 2;
  const rows = Math.min(crtc[6], 25) * 8;
  const table = PIXEL_TABLES[v.mode];
  const dotsPerByte = v.mode === 0 ? 2 : v.mode === 1 ? 4 : 8;
  const scale = 8 / dotsPerByte;
  const rgb = new Uint8Array(48);

  // A line's opening colour for a pen, and a raw Gate Array colour written
  // mid-line — 12-bit on a Plus, the 27-colour table otherwise.
  const colourAt = linePal12
    ? (line: number, pen: number) => unpack12(linePal12[line * P + pen])
    : (line: number, pen: number) => CPC_PALETTE[linePens[line * P + pen] & 0x1f];
  const colourHw = linePal12
    ? (hw: number) => unpack12(hwTo12(hw))
    : (hw: number) => CPC_PALETTE[hw & 0x1f];

  const fillRow = (o0: number, col: Rgb) => {
    for (let x = 0; x < WIDTH; x++) {
      const o = o0 + x * 4;
      rgba[o] = col[0]; rgba[o + 1] = col[1]; rgba[o + 2] = col[2]; rgba[o + 3] = 255;
    }
  };
  const dbl = (o0: number) => rgba.copyWithin(o0 + WIDTH * 4, o0, o0 + WIDTH * 4);

  // Mid-line pen writes bucketed by scanline, in time (== cycle) order. Border
  // writes (pen 16) are not placed mid-line yet — the border keeps its opening
  // colour for the whole row.
  const midLine: (number[] | undefined)[] = new Array(LINES_PER_FRAME);
  for (let i = 0; i < v.paletteWriteCount; i++) {
    if (v.paletteWrites[i * 4 + 2] >= 16) continue;
    const ln = v.paletteWrites[i * 4];
    (midLine[ln] ??= []).push(i);
  }

  for (let i = 0; i < BORDER_Y; i++) { // top border
    const line = (LINES_PER_FRAME - BORDER_Y + i) % LINES_PER_FRAME;
    const o0 = (i * 2) * WIDTH * 4;
    fillRow(o0, colourAt(line, 16));
    dbl(o0);
  }
  for (let y = 0; y < 200; y++) { // displayed rows
    for (let p = 0; p < 16; p++) {
      const col = colourAt(y, p);
      rgb[p * 3] = col[0]; rgb[p * 3 + 1] = col[1]; rgb[p * 3 + 2] = col[2];
    }
    const o0 = ((y + BORDER_Y) * 2) * WIDTH * 4;
    fillRow(o0, colourAt(y, 16));
    if (y < rows && y >= v.vscroll) {
      const sy = y - v.vscroll; // soft scroll: shift the picture down
      const raster = sy & 7, charRow = sy >> 3;
      const lineStart = (charRow * bytesPerLine + offset) & 0x7ff;
      const rw = midLine[y];
      let rwi = 0;
      let x = BORDER_X + v.hscroll; // ...and right; the border fills the gap
      for (let b = 0; b < 80 && x < BORDER_X + 640; b++) {
        if (rw) { // apply pen writes the raster has reached (2 T-states / byte)
          const reached = b * 2;
          while (rwi < rw.length && v.paletteWrites[rw[rwi] * 4 + 1] <= reached) {
            const wp = v.paletteWrites[rw[rwi] * 4 + 2] * 3;
            const col = colourHw(v.paletteWrites[rw[rwi] * 4 + 3]);
            rgb[wp] = col[0]; rgb[wp + 1] = col[1]; rgb[wp + 2] = col[2];
            rwi++;
          }
        }
        const addr = base + raster * 0x800 + ((lineStart + b) & 0x7ff);
        const pix = table[ram[addr]];
        for (let i = 0; i < pix.length; i++) {
          const p = pix[i] * 3;
          for (let s = 0; s < scale; s++) {
            if (x < BORDER_X + 640) { // clip the right edge (matters with hscroll)
              const o = o0 + x * 4;
              rgba[o] = rgb[p]; rgba[o + 1] = rgb[p + 1]; rgba[o + 2] = rgb[p + 2]; rgba[o + 3] = 255;
            }
            x++;
          }
        }
      }
    }
    dbl(o0);
  }
  for (let i = 0; i < BORDER_Y; i++) { // bottom border
    const line = (200 + i) % LINES_PER_FRAME;
    const o0 = ((200 + BORDER_Y + i) * 2) * WIDTH * 4;
    fillRow(o0, colourAt(line, 16));
    dbl(o0);
  }

  // Hardware sprites over the picture (Plus only; a no-op otherwise).
  if (v.spriteData) {
    for (let cy = BORDER_Y * 2; cy < (BORDER_Y + 200) * 2; cy++) {
      for (let cx = BORDER_X; cx < BORDER_X + 640; cx++) {
        const sp = spritePixel(v, cx, cy);
        if (sp < 0) continue;
        const o = (cy * WIDTH + cx) * 4;
        rgba[o] = ((sp >> 8) & 0xf) * 17;
        rgba[o + 1] = ((sp >> 4) & 0xf) * 17;
        rgba[o + 2] = (sp & 0xf) * 17;
        rgba[o + 3] = 255;
      }
    }
  }
}
