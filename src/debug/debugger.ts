// Drives the machine for debugging: pause / step / step-over / run-to-cursor
// and breakpoints, on top of runUntil. DOM-free; the UI wires buttons to this
// and re-renders on `onStop`.
import type { Z80 } from '../z80/cpu';
import { type CPCMachine, runUntil, type RunCondition } from '../cpc';
import { disassemble } from '../asm';
import { Trace } from './trace';

const STEP_OVER_LIMIT = 4_000_000; // instructions before step-over gives up

export type DebugState = 'running' | 'paused';

export interface RegisterView {
  af: number; bc: number; de: number; hl: number;
  sp: number; pc: number; ix: number; iy: number;
  i: number; r: number;
  iff1: boolean; iff2: boolean; im: number;
  flags: { s: boolean; z: boolean; h: boolean; pv: boolean; n: boolean; c: boolean };
}

export class Debugger {
  state: DebugState = 'running';
  readonly breakpoints = new Set<number>();
  readonly trace: Trace;
  /** Called whenever execution pauses (breakpoint, or a step completed). */
  onStop: (() => void) | null = null;

  constructor(private readonly cpu: Z80, private readonly m: CPCMachine) {
    this.trace = new Trace(cpu);
  }

  /** Read a byte as the CPU sees it now — through any paged-in ROM. */
  readByte = (addr: number): number => this.m.bus.read(addr & 0xffff);

  /** Add the trace hook to a run condition when recording is on. */
  private traced(cond: RunCondition): RunCondition {
    return this.trace.enabled ? { ...cond, onStep: this.trace.record } : cond;
  }

  isPaused(): boolean {
    return this.state === 'paused';
  }

  /** Advance up to `frames` whole frames, unless paused or a breakpoint hits. */
  runFrames(frames: number): void {
    if (this.state === 'paused') return;
    for (let i = 0; i < frames; i++) {
      const reason = runUntil(this.cpu, this.m, this.traced({ frame: true, breakpoints: this.breakpoints, audio: true }));
      if (reason === 'frame') this.m.frames++;
      if (reason === 'breakpoint') { this.pause(); return; }
    }
  }

  pause(): void {
    if (this.state === 'paused') return;
    this.state = 'paused';
    this.onStop?.();
  }

  resume(): void {
    if (this.state !== 'paused') return;
    // Step past a breakpoint sitting on the current PC so we don't re-trigger it.
    if (this.breakpoints.has(this.cpu.PC)) runUntil(this.cpu, this.m, { maxSteps: 1 });
    this.state = 'running';
  }

  /** One instruction. Leaves the machine paused. */
  step(): void {
    this.state = 'paused';
    runUntil(this.cpu, this.m, this.traced({ maxSteps: 1 }));
    this.onStop?.();
  }

  /** One instruction, but run a call / rst to its return. Leaves it paused. */
  stepOver(): void {
    this.state = 'paused';
    const d = disassemble(this.readByte, this.cpu.PC);
    if (d.isCall) {
      const ret = (this.cpu.PC + d.length) & 0xffff;
      const bp = new Set(this.breakpoints);
      bp.add(ret);
      runUntil(this.cpu, this.m, this.traced({ breakpoints: bp, maxSteps: STEP_OVER_LIMIT }));
    } else {
      runUntil(this.cpu, this.m, this.traced({ maxSteps: 1 }));
    }
    this.onStop?.();
  }

  /** Run until PC reaches `addr` (or a real breakpoint, or the limit). */
  runToCursor(addr: number): void {
    const bp = new Set(this.breakpoints);
    bp.add(addr & 0xffff);
    runUntil(this.cpu, this.m, this.traced({ maxSteps: 1 })); // move off the current instruction
    runUntil(this.cpu, this.m, this.traced({ breakpoints: bp, maxSteps: STEP_OVER_LIMIT }));
    this.state = 'paused';
    this.onStop?.();
  }

  toggleBreakpoint(addr: number): boolean {
    const a = addr & 0xffff;
    if (this.breakpoints.has(a)) { this.breakpoints.delete(a); return false; }
    this.breakpoints.add(a);
    return true;
  }

  registers(): RegisterView {
    const { cpu } = this;
    const f = cpu.F;
    return {
      af: (cpu.R[7] << 8) | f,
      bc: cpu.getBC(), de: cpu.getDE(), hl: cpu.getHL(),
      sp: cpu.SP, pc: cpu.PC, ix: cpu.IX, iy: cpu.IY,
      i: cpu.I, r: cpu.Rr & 0xff,
      iff1: !!cpu.IFF1, iff2: !!cpu.IFF2, im: cpu.IM,
      flags: {
        s: !!(f & 0x80), z: !!(f & 0x40), h: !!(f & 0x10),
        pv: !!(f & 0x04), n: !!(f & 0x02), c: !!(f & 0x01),
      },
    };
  }

  /** A copy of `length` bytes from `addr`, wrapping at 64K. Reads the CPU's
   *  view, so a paged-in ROM shows through. */
  readMemory(addr: number, length: number): Uint8Array {
    const out = new Uint8Array(length);
    for (let i = 0; i < length; i++) out[i] = this.readByte(addr + i);
    return out;
  }

  /** The last `n` traced instructions, most recent first, each disassembled. */
  traceLines(n: number): Array<{ pc: number; a: number; f: number; bc: number; de: number; hl: number; sp: number; text: string }> {
    return this.trace.recent(n).map((e) => ({
      ...e,
      text: disassemble(this.readByte, e.pc).text,
    }));
  }

  private decodeAt(addr: number): DisasmRow {
    return { addr, ...disassemble(this.readByte, addr & 0xffff) };
  }

  /** `count` decoded instructions starting at `from`. */
  disassembleFrom(from: number, count: number): DisasmRow[] {
    const out: DisasmRow[] = [];
    let addr = from & 0xffff;
    for (let i = 0; i < count; i++) {
      const d = this.decodeAt(addr);
      out.push(d);
      addr = (addr + d.length) & 0xffff;
    }
    return out;
  }

  /** `count` rows around `pc`, backing up to an instruction boundary so the
   *  row at `pc` is always present and the listing stays aligned. */
  disassembleAround(pc: number, before: number, count: number): DisasmRow[] {
    for (let start = Math.max(0, pc - before); start < pc; start++) {
      let a = start;
      while (a < pc) a += this.decodeAt(a).length;
      if (a === pc) return this.disassembleFrom(start, count);
    }
    return this.disassembleFrom(pc, count);
  }
}

export type DisasmRow = { addr: number } & ReturnType<typeof disassemble>;
