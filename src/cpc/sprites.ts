// Plus / GX4000 hardware sprites: 16 sprites, 16x16, one nibble per pixel
// (0 = transparent), 1x / 2x / 4x magnification per axis, a signed position, and
// a fixed priority — sprite 0 is on top. Composited over the picture (and, on
// real hardware, the border; not yet here). Shared by both renderers so they
// can't drift — see plan/plus-range.md Stage 3.
import { BORDER_X, BORDER_Y } from './constants';
import type { FrameView } from './frameview';

/** magnification field -> pixel scale; 0 means the sprite is not displayed. */
const MAG = [0, 1, 2, 4] as const;

/** The top-most sprite pixel covering canvas (cx, cy), as a packed 12-bit
 *  colour, or -1 for none. Returns -1 without a Plus ASIC. */
export function spritePixel(v: FrameView, cx: number, cy: number): number {
  const data = v.spriteData;
  const attr = v.spriteAttr;
  const pal = v.spritePal12;
  if (!data || !attr || !pal) return -1;

  const dx = cx - BORDER_X;          // picture pixel (mode-2 units), 0..639
  const dy = (cy >> 1) - BORDER_Y;   // picture scanline, 0..199
  if (dx < 0 || dx >= 640 || dy < 0 || dy >= 200) return -1;

  for (let s = 0; s < 16; s++) {
    const o = s * 8;
    const mag = attr[o + 4];
    const mx = MAG[mag & 3];
    const my = MAG[(mag >> 2) & 3];
    if (mx === 0 || my === 0) continue;

    let x = attr[o] | (attr[o + 1] << 8);
    let y = attr[o + 2] | (attr[o + 3] << 8);
    if (x >= 0x8000) x -= 0x10000;
    if (y >= 0x8000) y -= 0x10000;

    const px = dx - x;
    const py = dy - y;
    if (px < 0 || px >= 16 * mx || py < 0 || py >= 16 * my) continue;

    const pen = data[s * 256 + ((py / my) | 0) * 16 + ((px / mx) | 0)] & 0x0f;
    if (pen === 0) continue; // transparent
    return pal[16 + pen];    // sprite ink N -> palette entry 16 + N
  }
  return -1;
}
