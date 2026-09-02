// A complete machine snapshot as a plain object: CPU + RAM + every device
// register. The basis for save/restore, time-travel and reproducible tests.
// `snapshotSNA` stays separate — it is the interchange format for other
// emulators; this one is ours.
import type { Z80 } from '../z80/cpu';
import type { CPCMachine } from './machine';
import { updateRomPaging } from './rom';
import { flushBanks } from './banking';
import type { FdcState } from './fdc';

export interface CpuState {
  r: number[];
  rs: number[];
  f: number;
  fs: number;
  sp: number;
  pc: number;
  ix: number;
  iy: number;
  i: number;
  rr: number;
  iff1: number;
  iff2: number;
  im: number;
  halted: boolean;
  tstates: number;
}

export interface MachineState {
  cpu: CpuState;
  ram: Uint8Array;
  crtc: Uint8Array;
  pens: Uint8Array;
  psg: Uint8Array;
  keys: Uint8Array;
  linePens: Uint8Array;
  mode: number;
  penSelect: number;
  crtcSelect: number;
  kbdLine: number;
  vsync: boolean;
  gaConfig: number;
  ramConfig: number;
  romSelect: number;
  ram128: boolean;
  /** full 128K bank image when ram128; null otherwise (`ram` holds the 64K). */
  banks: Uint8Array | null;
  bankAt: number[];
  ppiA: number;
  ppiB: number;
  ppiC: number;
  ppiControl: number;
  psgSelect: number;
  frameCycles: number;
  lineCounter: number;
  interruptCounter: number;
  frames: number;
  frameReady: boolean;
  fdc: FdcState;
}

/** A deep copy of everything needed to resume exactly where the machine is. */
export function getState(cpu: Z80, m: CPCMachine): MachineState {
  flushBanks(m); // make m.banks a complete 128K image (no-op without 128K)
  return {
    cpu: {
      r: Array.from(cpu.R),
      rs: Array.from(cpu.Rs),
      f: cpu.F, fs: cpu.Fs,
      sp: cpu.SP, pc: cpu.PC, ix: cpu.IX, iy: cpu.IY,
      i: cpu.I, rr: cpu.Rr,
      iff1: cpu.IFF1, iff2: cpu.IFF2, im: cpu.IM,
      halted: cpu.halted, tstates: cpu.tstates,
    },
    // With 128K, `banks` holds everything and `ram` (the visible 64K) is
    // rebuilt from it on restore — no point copying both.
    ram: m.ram128 ? new Uint8Array(0) : m.ram.slice(),
    crtc: m.crtc.slice(),
    pens: m.pens.slice(),
    psg: m.psg.slice(),
    keys: m.keys.slice(),
    linePens: m.linePens.slice(),
    mode: m.mode,
    penSelect: m.penSelect,
    crtcSelect: m.crtcSelect,
    kbdLine: m.kbdLine,
    vsync: m.vsync,
    gaConfig: m.gaConfig,
    ramConfig: m.ramConfig,
    romSelect: m.romSelect,
    ram128: m.ram128,
    banks: m.banks ? m.banks.slice() : null,
    bankAt: Array.from(m.bankAt),
    ppiA: m.ppiA, ppiB: m.ppiB, ppiC: m.ppiC, ppiControl: m.ppiControl,
    psgSelect: m.psgSelect,
    frameCycles: m.frameCycles,
    lineCounter: m.lineCounter,
    interruptCounter: m.interruptCounter,
    frames: m.frames,
    frameReady: m.frameReady,
    fdc: m.fdc.getState(),
  };
}

/** Restore a snapshot. Writes into the existing arrays — the CPU and bus
 *  captured them by reference at construction. */
export function setState(cpu: Z80, m: CPCMachine, s: MachineState): void {
  cpu.R.set(s.cpu.r);
  cpu.Rs.set(s.cpu.rs);
  cpu.F = s.cpu.f; cpu.Fs = s.cpu.fs;
  cpu.SP = s.cpu.sp; cpu.PC = s.cpu.pc; cpu.IX = s.cpu.ix; cpu.IY = s.cpu.iy;
  cpu.I = s.cpu.i; cpu.Rr = s.cpu.rr;
  cpu.IFF1 = s.cpu.iff1; cpu.IFF2 = s.cpu.iff2; cpu.IM = s.cpu.im;
  cpu.halted = s.cpu.halted; cpu.tstates = s.cpu.tstates;

  m.ram.set(s.ram);
  m.crtc.set(s.crtc);
  m.pens.set(s.pens);
  m.psg.set(s.psg);
  m.keys.set(s.keys);
  m.linePens.set(s.linePens);
  m.mode = s.mode;
  m.penSelect = s.penSelect;
  m.crtcSelect = s.crtcSelect;
  m.kbdLine = s.kbdLine;
  m.vsync = s.vsync;
  m.gaConfig = s.gaConfig;
  m.ramConfig = s.ramConfig;
  m.romSelect = s.romSelect;
  m.ram128 = s.ram128;
  if (s.ram128 && s.banks) {
    m.banks ??= new Uint8Array(s.banks.length);
    m.banks.set(s.banks);
    m.bankAt.set(s.bankAt);
    const B = 0x4000;
    for (let sl = 0; sl < 4; sl++) {
      m.ram.set(m.banks.subarray(s.bankAt[sl] * B, s.bankAt[sl] * B + B), sl * B);
    }
  } else {
    m.banks = null;
  }
  updateRomPaging(m); // re-derive romLow/romHigh from the restored config
  m.ppiA = s.ppiA; m.ppiB = s.ppiB; m.ppiC = s.ppiC; m.ppiControl = s.ppiControl;
  m.psgSelect = s.psgSelect;
  m.frameCycles = s.frameCycles;
  m.lineCounter = s.lineCounter;
  m.interruptCounter = s.interruptCounter;
  m.frames = s.frames;
  m.frameReady = s.frameReady;
  m.fdc.setState(s.fdc);

  // Re-derive the synth from the restored register file (its tone counters and
  // envelope phase resync within a frame). R13 skipped so the envelope is not
  // retriggered on every seek.
  if (m.audio) for (let r = 0; r <= 12; r++) m.audio.ay.writeReg(r, m.psg[r]);
}
