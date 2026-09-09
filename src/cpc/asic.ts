// The Amstrad Plus / GX4000 ASIC. This file owns the unlock state machine, the
// 16K register page, and the 4096-colour palette derived from it; hardware
// sprites, raster interrupt and DMA sound land stage by stage — see
// plan/plus-range.md. On a 464 / 6128 `m.asic` is null and every path is a
// single null check.
import { CPC_PALETTE } from './palette';

/** Written one byte at a time to the CRTC register-select port (&BCxx). Once
 *  the whole sequence has been seen the ASIC registers become addressable.
 *  Leading &FF bytes are absorbed (the sequence itself starts with one). */
export const ASIC_UNLOCK: readonly number[] = [
  0xff, 0x00, 0xff, 0x77, 0xb3, 0x51, 0xa8, 0xd4, 0x62,
  0x39, 0x9c, 0x46, 0x2b, 0x15, 0x8a, 0xcd, 0xee,
];

/** Register-page offsets (into the 16K page mapped at &4000-&7FFF). */
export const ASIC = {
  SPRITE_DATA: 0x0000, // 16 sprites x 16x16, one byte per pixel (low nibble)
  SPRITE_ATTR: 0x2000, // 16 x 8 bytes: X (12b), Y (12b), magnification
  PALETTE: 0x2400,     // 32 entries x 2 bytes, 12-bit GgggRRRR / ----BBBB
  PRI: 0x2800,         // programmable raster interrupt scanline
  SPLT: 0x2801,        // split-screen scanline
  SSA: 0x2802,         // split-screen secondary address (2 bytes)
  SSCR: 0x2804,        // soft-scroll control
  IVR: 0x2805,         // interrupt vector
  ANALOGUE: 0x2808,    // 8 bytes of analogue / pad inputs
  DMA: 0x2c00,         // 3 DMA channels + control (16 bytes)
} as const;

export interface Asic {
  /** The 16K register page. Mapped over &4000-&7FFF while `pageIn`. */
  regs: Uint8Array;
  unlocked: boolean;
  /** ASIC registers are visible at &4000-&7FFF (upper-ROM select &B8-&BF). */
  pageIn: boolean;
  /** bytes of ASIC_UNLOCK matched so far. */
  unlockProgress: number;
  /** Effective screen palette, 17 entries, packed 12-bit (R<<8)|(G<<4)|B with
   *  each channel a 0-15 nibble. Kept in step with the palette registers and
   *  with Gate Array ink writes. */
  pal12: Uint16Array;
  reset(): void;
  /** Feed a byte written to &BCxx. */
  feedUnlock(v: number): void;
  /** A write hit register-page offset `off`; refresh pal12 if it was a colour. */
  onRegWrite(off: number): void;
  /** A Gate Array ink write (&7F40) — translate the hardware colour to 12-bit
   *  and store it in the palette registers. */
  gaInk(pen: number, hwColour: number): void;
  /** Rebuild pal12 from the palette registers (after a state restore). */
  syncPalette(): void;
}

/** Screen palette entries: pens 0-15 plus the border at 16. 17-31 are sprites. */
const SCREEN_ENTRIES = 17;

/** Nearest 12-bit nibble for a Gate Array channel level (0 / 128 / 255). */
const nib = (level: number): number => (level === 0 ? 0 : level >= 255 ? 15 : 8);

/** A Gate Array hardware colour (0-31) as a packed 12-bit value, for a renderer
 *  that needs to place a classic ink on a Plus 4096-colour scanline. */
export function hwTo12(hwColour: number): number {
  const [r, g, b] = CPC_PALETTE[hwColour & 0x1f];
  return (nib(r) << 8) | (nib(g) << 4) | nib(b);
}

export function makeAsic(): Asic {
  const a: Asic = {
    regs: new Uint8Array(0x4000),
    unlocked: false,
    pageIn: false,
    unlockProgress: 0,
    pal12: new Uint16Array(SCREEN_ENTRIES),
    reset() {
      this.regs.fill(0);
      this.unlocked = false;
      this.pageIn = false;
      this.unlockProgress = 0;
      this.pal12.fill(0);
    },
    feedUnlock(v: number) {
      if (v === ASIC_UNLOCK[this.unlockProgress]) {
        if (++this.unlockProgress === ASIC_UNLOCK.length) {
          this.unlocked = true;
          this.unlockProgress = 0;
        }
      } else {
        this.unlockProgress = v === ASIC_UNLOCK[0] ? 1 : 0;
      }
    },
    onRegWrite(off: number) {
      const rel = off - ASIC.PALETTE;
      if (rel >= 0 && rel < SCREEN_ENTRIES * 2) syncEntry(this, rel >> 1);
    },
    gaInk(pen: number, hwColour: number) {
      const [r, g, b] = CPC_PALETTE[hwColour & 0x1f];
      const o = ASIC.PALETTE + pen * 2;
      this.regs[o] = (nib(g) << 4) | nib(r); // GGGGRRRR
      this.regs[o + 1] = nib(b);             // ----BBBB
      syncEntry(this, pen);
    },
    syncPalette() {
      for (let e = 0; e < SCREEN_ENTRIES; e++) syncEntry(this, e);
    },
  };
  return a;
}

/** entry `e` (0-16): pack the two palette-register bytes into pal12. */
function syncEntry(a: Asic, e: number): void {
  const o = ASIC.PALETTE + e * 2;
  const b0 = a.regs[o];      // GGGGRRRR
  const b1 = a.regs[o + 1];  // ----BBBB
  a.pal12[e] = ((b0 & 0x0f) << 8) | (b0 & 0xf0) | (b1 & 0x0f);
}
