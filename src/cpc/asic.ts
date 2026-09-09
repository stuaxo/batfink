// The Amstrad Plus / GX4000 ASIC. This file owns the unlock state machine and
// the 16K register page; what the registers *do* (4096-colour palette, hardware
// sprites, raster interrupt, DMA sound) lands stage by stage — see
// plan/plus-range.md. On a 464 / 6128 `m.asic` is null and every path is a
// single null check.

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
  reset(): void;
  /** Feed a byte written to &BCxx. */
  feedUnlock(v: number): void;
}

export function makeAsic(): Asic {
  const a: Asic = {
    regs: new Uint8Array(0x4000),
    unlocked: false,
    pageIn: false,
    unlockProgress: 0,
    reset() {
      this.regs.fill(0);
      this.unlocked = false;
      this.pageIn = false;
      this.unlockProgress = 0;
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
  };
  return a;
}
