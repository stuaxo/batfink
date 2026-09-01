// A complete machine snapshot as a plain object: CPU + RAM + every device
// register. The basis for save/restore, time-travel and reproducible tests.
// `snapshotSNA` stays separate — it is the interchange format for other
// emulators; this one is ours.
import type { Z80 } from '../z80/cpu';
import type { CPCMachine } from './machine';
import { updateRomPaging } from './rom';

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
}

/** A deep copy of everything needed to resume exactly where the machine is. */
export function getState(cpu: Z80, m: CPCMachine): MachineState {
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
    ram: m.ram.slice(),
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
    ppiA: m.ppiA, ppiB: m.ppiB, ppiC: m.ppiC, ppiControl: m.ppiControl,
    psgSelect: m.psgSelect,
    frameCycles: m.frameCycles,
    lineCounter: m.lineCounter,
    interruptCounter: m.interruptCounter,
    frames: m.frames,
    frameReady: m.frameReady,
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
  updateRomPaging(m); // re-derive romLow/romHigh from the restored config
  m.ppiA = s.ppiA; m.ppiB = s.ppiB; m.ppiC = s.ppiC; m.ppiControl = s.ppiControl;
  m.psgSelect = s.psgSelect;
  m.frameCycles = s.frameCycles;
  m.lineCounter = s.lineCounter;
  m.interruptCounter = s.interruptCounter;
  m.frames = s.frames;
  m.frameReady = s.frameReady;

  // Re-derive the synth from the restored register file (its tone counters and
  // envelope phase resync within a frame). R13 skipped so the envelope is not
  // retriggered on every seek.
  if (m.audio) for (let r = 0; r <= 12; r++) m.audio.ay.writeReg(r, m.psg[r]);
}
