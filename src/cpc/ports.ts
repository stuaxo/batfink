// Z80 I/O space decode for the CPC 464: Gate Array (ink/mode), CRTC 6845
// (register select + write), the ROM-select latch, and the PPI 8255 that the
// keyboard and VSYNC flag hang off. The address decode is partial, matching the
// real machine: a device responds whenever its bits are clear, so several can
// react to one OUT.
import type { Bus } from '../z80/bus';
import type { CPCMachine } from './machine';

export function makeBus(m: CPCMachine): Bus {
  return {
    read: (a) => m.ram[a],
    write: (a, v) => { m.ram[a] = v; },

    out: (port, v) => {
      if ((port & 0xc000) === 0x4000) { // Gate Array
        switch (v & 0xc0) {
          case 0x00: m.penSelect = (v & 0x10) ? 16 : (v & 0x0f); break;
          case 0x40: m.pens[m.penSelect] = v & 0x1f; break;
          case 0x80: m.mode = v & 0x03; m.gaConfig = v; break;
          case 0xc0: m.ramConfig = v; break;
        }
      } else if ((port & 0x4000) === 0 && (port & 0x8000) === 0x8000) {
        // 0xBCxx-0xBFxx: CRTC 6845
        const fn = (port >> 8) & 3;
        if (fn === 0) m.crtcSelect = v & 0x1f;
        else if (fn === 1) m.crtc[m.crtcSelect] = v;
      } else if ((port & 0x2000) === 0) {
        m.romSelect = v; // 0xDFxx: upper ROM number
      } else if ((port & 0x0800) === 0) {
        // 0xF4xx-0xF7xx: PPI 8255
        const fn = (port >> 8) & 3;
        if (fn === 0) m.ppiA = v;
        else if (fn === 1) m.ppiB = v;
        else if (fn === 2) { m.ppiC = v; m.kbdLine = v & 0x0f; }
        else if (v & 0x80) m.ppiControl = v;
      }
    },

    in: (port) => {
      if ((port & 0x0800) === 0) {
        const fn = (port >> 8) & 3;
        if (fn === 0) return m.keys[m.kbdLine] ?? 0xff; // port A: key matrix
        if (fn === 1) return (m.vsync ? 0x01 : 0x00) | 0x1e; // port B: bit0 = VSYNC
      }
      return 0xff;
    },
  };
}
