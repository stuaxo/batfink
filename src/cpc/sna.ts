import type { Z80 } from '../z80/cpu';
import type { CPCMachine } from './machine';

// Write the whole machine out as a version 2 .SNA snapshot: a 256-byte header of
// Z80, Gate Array, CRTC, PPI and PSG state, then the 64K of RAM. Every CPC
// emulator reads this, which makes it the way to check that code written here
// behaves the same somewhere else.
export function snapshotSNA(cpu: Z80, m: CPCMachine): Uint8Array {
  const out = new Uint8Array(0x100 + 0x10000);
  const id = 'MV - SNA';
  for (let i = 0; i < 8; i++) out[i] = id.charCodeAt(i);
  out[0x10] = 2; // snapshot version
  out[0x11] = cpu.F; out[0x12] = cpu.R[7]; // AF
  out[0x13] = cpu.R[1]; out[0x14] = cpu.R[0]; // BC
  out[0x15] = cpu.R[3]; out[0x16] = cpu.R[2]; // DE
  out[0x17] = cpu.R[5]; out[0x18] = cpu.R[4]; // HL
  out[0x19] = cpu.Rr & 0xff; out[0x1a] = cpu.I;
  out[0x1b] = cpu.IFF1 ? 1 : 0;
  out[0x1c] = cpu.IFF2 ? 1 : 0;
  out[0x1d] = cpu.IX & 0xff; out[0x1e] = (cpu.IX >> 8) & 0xff;
  out[0x1f] = cpu.IY & 0xff; out[0x20] = (cpu.IY >> 8) & 0xff;
  out[0x21] = cpu.SP & 0xff; out[0x22] = (cpu.SP >> 8) & 0xff;
  out[0x23] = cpu.PC & 0xff; out[0x24] = (cpu.PC >> 8) & 0xff;
  out[0x25] = cpu.IM;
  out[0x26] = cpu.Fs; out[0x27] = cpu.Rs[7]; // AF'
  out[0x28] = cpu.Rs[1]; out[0x29] = cpu.Rs[0]; // BC'
  out[0x2a] = cpu.Rs[3]; out[0x2b] = cpu.Rs[2]; // DE'
  out[0x2c] = cpu.Rs[5]; out[0x2d] = cpu.Rs[4]; // HL'
  out[0x2e] = m.penSelect & 0x1f;
  for (let p = 0; p < 17; p++) out[0x2f + p] = m.pens[p] & 0x1f;
  out[0x40] = (m.gaConfig & 0x1f) | 0x80;
  out[0x41] = m.ramConfig & 0x3f;
  out[0x42] = m.crtcSelect & 0x1f;
  for (let r = 0; r < 18; r++) out[0x43 + r] = m.crtc[r];
  out[0x55] = m.romSelect & 0xff;
  out[0x56] = m.ppiA & 0xff;
  out[0x57] = m.ppiB & 0xff;
  out[0x58] = m.ppiC & 0xff;
  out[0x59] = m.ppiControl | 0x80;
  out[0x5a] = m.psgSelect & 0x0f;
  for (let i = 0; i < 16; i++) out[0x5b + i] = m.psg[i];
  out[0x6b] = 64; out[0x6c] = 0; // 64K memory dump
  out[0x6d] = 0; // CPC 464
  out[0x6e] = 0; // interrupt number
  out.set(m.ram, 0x100);
  return out;
}
