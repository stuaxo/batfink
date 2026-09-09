// Given a point on the rendered canvas, work out which screen byte the CRTC and
// Gate Array are fetching for it, and where the pixel sits inside that byte.
import { type CPCMachine, ASIC } from '../cpc';
import { BORDER_X, BORDER_Y } from '../cpc/constants';

export interface ScreenHit {
  addr: number;
  byteValue: number;
  mode: number;
  /** which pixel of the byte, left = 0 */
  pixelInByte: number;
  pixelsPerByte: number;
  /** displayed row 0-199 and byte column */
  row: number;
  byteCol: number;
}

const DOTS = [2, 4, 8];

/** `cx`/`cy` are in canvas pixels (WIDTH x HEIGHT). Null outside the picture. */
export function screenAddressAt(m: CPCMachine, cx: number, cy: number): ScreenHit | null {
  const sscr = m.asic ? m.asic.regs[ASIC.SSCR] : 0;
  const dispX = Math.floor(cx) - BORDER_X - (sscr & 0x0f);
  const row = Math.floor(cy / 2) - BORDER_Y - ((sscr >> 4) & 0x07); // canvas is line-doubled
  if (dispX < 0 || dispX >= 640 || row < 0 || row >= 200) return null;

  const mode = m.mode & 3;
  const pixelsPerByte = DOTS[mode] ?? 4;
  const bytesPerLine = (m.crtc[1] || 40) * 2;
  const canvasPxPerPixel = 640 / (bytesPerLine * pixelsPerByte);
  const logicalX = Math.floor(dispX / canvasPxPerPixel);
  const byteCol = Math.floor(logicalX / pixelsPerByte);
  const pixelInByte = logicalX % pixelsPerByte;

  // Video DMA reads RAM directly, ignoring ROM paging — so this reads `m.ram`,
  // unlike the debugger's hex dump, which follows the CPU through paged ROM.
  const base = (m.crtc[12] & 0x30) << 10;
  const offset = (((m.crtc[12] & 0x03) << 8) | m.crtc[13]) * 2;
  const lineStart = ((row >> 3) * bytesPerLine + offset) & 0x7ff;
  const addr = (base + (row & 7) * 0x800 + ((lineStart + byteCol) & 0x7ff)) & 0xffff;

  return { addr, byteValue: m.ram[addr], mode, pixelInByte, pixelsPerByte, row, byteCol };
}
