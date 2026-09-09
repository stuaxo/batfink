// Plus DMA sound: three channels each walk a list of 16-bit entries in RAM and
// poke the PSG, so "hardware" music plays with no CPU cost. Stepped from the
// frame loop alongside the audio sink; only touched while m.asic.dmaOn.
//
// List entry format (per Kevin Thacker's Plus documentation):
//   0x0RDD  LOAD   PSG register R (0-15) := DD
//   0x1NNN  PAUSE  wait NNN channel ticks
//   0x2xNN  REPEAT set the loop marker here; NN loops (0 = forever)
//   0x4xxx  control: bit 0 LOOP to marker, bit 4 raise interrupt, bit 5 STOP
import type { CPCMachine } from './machine';
import { REG_MASK } from './psg';

/** One channel tick is 4 T-states (the ~1 MHz sound clock); a channel advances
 *  one list entry every (prescaler + 1) ticks. Tempo is approximate. */
const TICK_TSTATES = 4;

export function stepDma(m: CPCMachine, dt: number): void {
  const asic = m.asic;
  if (!asic) return;

  for (let ch = 0; ch < 3; ch++) {
    const c = asic.dma[ch];
    if (!c.active) continue;
    c.ticks += dt;
    const period = TICK_TSTATES * (c.prescaler + 1);

    while (c.active && c.ticks >= period) {
      c.ticks -= period;
      if (c.pause > 0) { c.pause--; continue; }

      const i = m.ram[c.addr] | (m.ram[c.addr + 1] << 8);
      c.addr = (c.addr + 2) & 0xffff;

      switch (i & 0xf000) {
        case 0x0000: { // LOAD
          const reg = (i >> 8) & 0x0f;
          const val = i & 0xff;
          if (reg < 14) {
            m.psg[reg] = val & REG_MASK[reg];
            m.psgWrite?.(reg, val);
          }
          break;
        }
        case 0x1000: // PAUSE
          c.pause = i & 0x0fff;
          break;
        case 0x2000: // REPEAT — mark the loop point
          c.loopAddr = c.addr;
          c.loopCount = i & 0x003f;
          break;
        case 0x4000: // control
          if (i & 0x0010) asic.regs[0x2c0f] |= 1 << (5 + ch); // IRQ pending
          if (i & 0x0001) { // LOOP
            if (c.loopCount === 0 || --c.loopCount > 0) c.addr = c.loopAddr;
          }
          if (i & 0x0020) c.active = false; // STOP
          break;
      }
    }
  }

  asic.dmaOn = asic.dma.some((c) => c.active);
}
