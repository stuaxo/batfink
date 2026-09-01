// Steps the AY alongside the CPU and accumulates stereo samples. The UI drains
// it once per frame and hands the samples to Web Audio. Null on the machine
// when sound is off.
import { Ay } from './ay';
import { CYCLES_PER_FRAME } from './constants';

const CPU_HZ = CYCLES_PER_FRAME * 50; // 3_993_600

export class AudioSink {
  readonly ay: Ay;
  private readonly tstatesPerSample: number;
  private clock = 0;
  private readonly buf: Float32Array;
  private len = 0;

  constructor(readonly sampleRate: number, capacityMs = 500) {
    this.ay = new Ay(1_000_000, sampleRate);
    this.tstatesPerSample = CPU_HZ / sampleRate;
    this.buf = new Float32Array(Math.ceil((sampleRate * capacityMs) / 1000) * 2);
  }

  /** Advance by one instruction's worth of T-states. */
  step(tstates: number): void {
    this.clock += tstates;
    while (this.clock >= this.tstatesPerSample) {
      this.clock -= this.tstatesPerSample;
      this.ay.process();
      this.ay.removeDc();
      if (this.len + 2 <= this.buf.length) {
        this.buf[this.len++] = this.ay.left;
        this.buf[this.len++] = this.ay.right;
      }
    }
  }

  /** Take the accumulated interleaved L/R samples and reset the buffer. */
  drain(): Float32Array {
    const out = this.buf.slice(0, this.len);
    this.len = 0;
    return out;
  }

  get pending(): number {
    return this.len >> 1;
  }

  reset(): void {
    this.ay.reset();
    this.clock = 0;
    this.len = 0;
  }
}
