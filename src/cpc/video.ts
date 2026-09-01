// Turns the current machine state into pixels. Every scanline is drawn from its
// own palette snapshot (m.linePens), so raster splits survive into the border
// exactly as they do on a real machine.
import { CPC_PALETTE, type Rgb } from './palette';
import { PIXEL_TABLES } from './pixels';
import { BORDER_X, BORDER_Y, WIDTH, LINES_PER_FRAME, PENS_PER_LINE } from './constants';
import type { CPCMachine } from './machine';

const P = PENS_PER_LINE;

/** Render one frame into an RGBA buffer, BORDER_X/BORDER_Y included. */
export function renderFrame(m: CPCMachine, rgba: Uint8ClampedArray): void {
  const { crtc, ram, linePens } = m;
  const base = (crtc[12] & 0x30) << 10;
  const offset = (((crtc[12] & 0x03) << 8) | crtc[13]) * 2;
  const bytesPerLine = crtc[1] * 2;
  const rows = Math.min(crtc[6], 25) * 8;
  const table = PIXEL_TABLES[m.mode];
  const dotsPerByte = m.mode === 0 ? 2 : m.mode === 1 ? 4 : 8;
  const scale = 8 / dotsPerByte;
  const rgb = new Uint8Array(48);

  const fillRow = (o0: number, col: Rgb) => {
    for (let x = 0; x < WIDTH; x++) {
      const o = o0 + x * 4;
      rgba[o] = col[0]; rgba[o + 1] = col[1]; rgba[o + 2] = col[2]; rgba[o + 3] = 255;
    }
  };
  const dbl = (o0: number) => rgba.copyWithin(o0 + WIDTH * 4, o0, o0 + WIDTH * 4);

  for (let i = 0; i < BORDER_Y; i++) { // top border
    const line = (LINES_PER_FRAME - BORDER_Y + i) % LINES_PER_FRAME;
    const o0 = (i * 2) * WIDTH * 4;
    fillRow(o0, CPC_PALETTE[linePens[line * P + 16] & 0x1f]);
    dbl(o0);
  }
  for (let y = 0; y < 200; y++) { // displayed rows
    const lp = y * P;
    for (let p = 0; p < 16; p++) {
      const col = CPC_PALETTE[linePens[lp + p] & 0x1f];
      rgb[p * 3] = col[0]; rgb[p * 3 + 1] = col[1]; rgb[p * 3 + 2] = col[2];
    }
    const borderCol = CPC_PALETTE[linePens[lp + 16] & 0x1f];
    const o0 = ((y + BORDER_Y) * 2) * WIDTH * 4;
    fillRow(o0, borderCol);
    if (y < rows) {
      const raster = y & 7, charRow = y >> 3;
      const lineStart = (charRow * bytesPerLine + offset) & 0x7ff;
      let x = BORDER_X;
      for (let b = 0; b < 80 && x < BORDER_X + 640; b++) {
        const addr = base + raster * 0x800 + ((lineStart + b) & 0x7ff);
        const pix = table[ram[addr]];
        for (let i = 0; i < pix.length; i++) {
          const p = pix[i] * 3;
          for (let s = 0; s < scale; s++) {
            const o = o0 + x * 4;
            rgba[o] = rgb[p]; rgba[o + 1] = rgb[p + 1]; rgba[o + 2] = rgb[p + 2]; rgba[o + 3] = 255;
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
    fillRow(o0, CPC_PALETTE[linePens[line * P + 16] & 0x1f]);
    dbl(o0);
  }
}
