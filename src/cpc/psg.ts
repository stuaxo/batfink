// AY-3-8912 register access via the PPI 8255. Port A carries the data byte;
// port C bits 7 (BDIR) and 6 (BC1) select the operation. See plan/sound.md.
import type { CPCMachine } from './machine';

// Bits that actually reach each register.
const REG_MASK = [
  0xff, 0x0f, 0xff, 0x0f, 0xff, 0x0f, 0x1f, 0xff,
  0x1f, 0x1f, 0x1f, 0xff, 0xff, 0x0f, 0xff, 0xff,
];

/** Act on the current PPI port A / port C state. Call after any port C write. */
export function psgStrobe(m: CPCMachine): void {
  switch ((m.ppiC >> 6) & 3) {
    case 3: // latch register address
      m.psgSelect = m.ppiA & 0x0f;
      break;
    case 2: { // write
      const reg = m.psgSelect & 0x0f;
      m.psg[reg] = m.ppiA & REG_MASK[reg]; // hardware-accurate for the snapshot
      m.psgWrite?.(reg, m.ppiA); // raw; the synth masks as the chip does, and
      break; //                     needs to see R13 = 0xFF ("no retrigger")
    }
    // 0 inactive, 1 read — PSG reads are not emulated (nothing needs them; the
    // keyboard is served directly from the matrix in ports.ts).
  }
}
