// ROM paging for the CPC 464. Two 16K windows page over RAM: the lower ROM (OS)
// at &0000 and one selectable upper ROM at &C000. Reads see ROM when the window
// is enabled; writes always go to RAM. With no ROM images loaded every field is
// null and the machine is byte-for-byte the RAM-only model — real images arrive
// in a later PR.
import type { CPCMachine } from './machine';

export interface RomSet {
  /** Lower ROM mapped at &0000-&3FFF, or null. */
  lower: Uint8Array | null;
  /** Upper ROMs by number: 0 = BASIC, 7 = AMSDOS. Sparse. */
  upper: (Uint8Array | null)[];
}

export function emptyRomSet(): RomSet {
  return { lower: null, upper: [] };
}

/** Recompute the ROM visible in each window. Call on any paging change: the
 *  Gate Array ROM-enable bits (&7Fxx bits 2/3) or the ROM-select latch (&DFxx).
 *  gaConfig bit 2 = lower ROM disable, bit 3 = upper ROM disable. */
export function updateRomPaging(m: CPCMachine): void {
  const { lower, upper } = m.roms;
  m.romLow = lower && (m.gaConfig & 0x04) === 0 ? lower : null;
  // An unpopulated upper ROM number falls back to ROM 0 (BASIC) on the 464.
  const hi = upper[m.romSelect] ?? upper[0] ?? null;
  m.romHigh = hi && (m.gaConfig & 0x08) === 0 ? hi : null;
}
