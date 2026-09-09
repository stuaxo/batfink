// A read-only description of one frame for a renderer to consume. The software
// renderer (./video) reads it directly; a WebGL renderer uploads it as
// textures. Nothing here is copied — `ram` and the register arrays are live
// references and the renderer must not write them — but the shape names exactly
// what a renderer is allowed to see, so the two implementations can't drift.
// The palette model widens here when per-microsecond splits land
// (plan/webgl-renderer.md Stage 3).
import type { CPCMachine } from './machine';
import { ASIC } from './asic';

export interface FrameView {
  /** 64K screen source. Live reference — do not write. */
  ram: Uint8Array;
  /** Gate Array screen mode, 0-2. */
  mode: number;
  /** CRTC registers as they stand at the end of the frame. */
  crtc: Uint8Array;
  /** Per-scanline palette snapshot: LINES_PER_FRAME * PENS_PER_LINE bytes,
   *  pens 0-15 then the border at index 16. Each line's opening colours. */
  linePens: Uint8Array;
  /** With a Plus ASIC: the same snapshot as 12-bit colour, one Uint16 per
   *  entry packed (R<<8)|(G<<4)|B. Null on a 464 / 6128 — use `linePens` then. */
  linePal12: Uint16Array | null;
  /** Mid-frame pen writes as (line, cycle-in-line, pen, value) quads, in time
   *  order — for colour changes within a scanline. */
  paletteWrites: Int32Array;
  paletteWriteCount: number;
  /** Plus hardware sprites, or null off the Plus family: 16 x 256 bytes of
   *  4bpp pixel data, 16 x 8 bytes of attributes, and the full 32-entry
   *  12-bit palette (sprite inks are entries 16-31). */
  spriteData: Uint8Array | null;
  spriteAttr: Uint8Array | null;
  spritePal12: Uint16Array | null;
}

export function frameView(m: CPCMachine): FrameView {
  return {
    ram: m.ram,
    mode: m.mode,
    crtc: m.crtc,
    linePens: m.linePens,
    linePal12: m.asic ? m.linePal12 : null,
    paletteWrites: m.paletteWrites,
    paletteWriteCount: m.paletteWriteCount,
    spriteData: m.asic ? m.asic.regs.subarray(ASIC.SPRITE_DATA, ASIC.SPRITE_DATA + 0x1000) : null,
    spriteAttr: m.asic ? m.asic.regs.subarray(ASIC.SPRITE_ATTR, ASIC.SPRITE_ATTR + 0x80) : null,
    spritePal12: m.asic ? m.asic.pal12 : null,
  };
}
