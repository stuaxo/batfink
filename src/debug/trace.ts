// A ring buffer of recently executed instructions — "how did I get here?".
// Off by default; when on it costs one record() call per instruction.
import type { Z80 } from '../z80/cpu';

export interface TraceEntry {
  pc: number;
  a: number;
  f: number;
  bc: number;
  de: number;
  hl: number;
  sp: number;
}

export class Trace {
  enabled = false;
  private readonly buf: TraceEntry[];
  private readonly cap: number;
  private head = 0;
  private count = 0;

  constructor(private readonly cpu: Z80, cap = 1024) {
    this.cap = cap;
    this.buf = Array.from({ length: cap }, () => ({ pc: 0, a: 0, f: 0, bc: 0, de: 0, hl: 0, sp: 0 }));
  }

  // Bound method: passed straight to runUntil's onStep. Called after the
  // instruction at `pc`, so the registers are its result.
  readonly record = (pc: number): void => {
    const e = this.buf[this.head];
    e.pc = pc;
    e.a = this.cpu.R[7];
    e.f = this.cpu.F;
    e.bc = this.cpu.getBC();
    e.de = this.cpu.getDE();
    e.hl = this.cpu.getHL();
    e.sp = this.cpu.SP;
    this.head = (this.head + 1) % this.cap;
    if (this.count < this.cap) this.count++;
  };

  clear(): void {
    this.head = 0;
    this.count = 0;
  }

  get length(): number {
    return this.count;
  }

  /** The last `n` entries, most recent first. */
  recent(n: number): TraceEntry[] {
    const out: TraceEntry[] = [];
    const take = Math.min(n, this.count);
    for (let i = 1; i <= take; i++) {
      const src = this.buf[(this.head - i + this.cap) % this.cap];
      out.push({ ...src });
    }
    return out;
  }
}
