// Cassette playback. Turns a .cdt / TZX pulse stream into transitions on PPI
// port B bit 7; the firmware's own CAS IN routines time the edges, exactly as
// on a real machine. Stepped from the frame loop like AudioSink; the machine
// holds `m.tape` null until a tape is mounted, so a tapeless machine pays only
// a null check.

const TZX_HZ = 3_500_000;    // the TZX/Spectrum clock pulse lengths are given in
const CPU_HZ = 3_993_600;    // our CPU clock
const toCpu = (tzx: number) => Math.round((tzx * CPU_HZ) / TZX_HZ);

// Pulse timings (TZX T-states) for a standard-speed block (TZX 0x10).
const ROM_PILOT = 2168;
const ROM_SYNC1 = 667;
const ROM_SYNC2 = 735;
const ROM_ZERO = 855;
const ROM_ONE = 1710;
const ROM_PILOT_HEADER = 8063;
const ROM_PILOT_DATA = 3223;

export class Tape {
  private readonly pulses: Int32Array; // T-state durations; level flips each one
  private index = 0;
  private remaining: number;
  private lvl = 0;
  private ended = false;
  motorOn = false;

  constructor(pulses: Int32Array) {
    this.pulses = pulses;
    this.remaining = pulses.length ? pulses[0] : 0;
    this.ended = pulses.length === 0;
  }

  /** The cassette-read bit the firmware polls (PPI port B bit 7). */
  get level(): number { return this.lvl; }
  get atEnd(): boolean { return this.ended; }
  get position(): number { return this.index; }
  get length(): number { return this.pulses.length; }

  /** Advance by one instruction's worth of T-states. */
  advance(tstates: number): void {
    if (!this.motorOn || this.ended) return;
    this.remaining -= tstates;
    while (this.remaining <= 0) {
      if (++this.index >= this.pulses.length) { this.ended = true; return; }
      this.lvl ^= 1;
      this.remaining += this.pulses[this.index];
    }
  }

  rewind(): void {
    this.index = 0;
    this.remaining = this.pulses.length ? this.pulses[0] : 0;
    this.lvl = 0;
    this.ended = this.pulses.length === 0;
  }

  getState(): TapeState {
    return { index: this.index, remaining: this.remaining, lvl: this.lvl, ended: this.ended, motorOn: this.motorOn };
  }

  setState(s: TapeState): void {
    this.index = s.index;
    this.remaining = s.remaining;
    this.lvl = s.lvl;
    this.ended = s.ended;
    this.motorOn = s.motorOn;
  }
}

export interface TapeState {
  index: number;
  remaining: number;
  lvl: number;
  ended: boolean;
  motorOn: boolean;
}

/** Expand a `.cdt` / `.tzx` image to a flat pulse list in CPU T-states. Covers
 *  the block types our own `makeCdt` writes (0x11) plus enough of the standard
 *  set for simple real images. Throws on a block it can't play. */
export function readCdt(image: Uint8Array): Int32Array {
  if (String.fromCharCode(...image.subarray(0, 7)) !== 'ZXTape!') {
    throw new Error('not a .cdt / .tzx image');
  }
  const out: number[] = [];
  const word = (at: number) => image[at] | (image[at + 1] << 8);
  const pilotTone = (len: number, count: number) => { for (let i = 0; i < count; i++) out.push(toCpu(len)); };
  const dataBits = (data: Uint8Array, lastBits: number, zero: number, one: number) => {
    for (let b = 0; b < data.length; b++) {
      const n = b === data.length - 1 ? lastBits : 8;
      for (let bit = 7; bit > 7 - n; bit--) {
        const p = toCpu(((data[b] >> bit) & 1) ? one : zero);
        out.push(p, p);
      }
    }
  };
  const gap = (ms: number) => { if (ms > 0) out.push(toCpu((ms * TZX_HZ) / 1000)); };

  let p = 10; // past "ZXTape!\x1A" + version
  while (p < image.length) {
    const id = image[p++];
    if (id === 0x10) { // standard speed data
      const pause = word(p);
      const len = word(p + 2);
      const data = image.subarray(p + 4, p + 4 + len);
      p += 4 + len;
      pilotTone(ROM_PILOT, data.length && data[0] < 128 ? ROM_PILOT_HEADER : ROM_PILOT_DATA);
      out.push(toCpu(ROM_SYNC1), toCpu(ROM_SYNC2));
      dataBits(data, 8, ROM_ZERO, ROM_ONE);
      gap(pause);
    } else if (id === 0x11) { // turbo speed data — what makeCdt writes
      const pilot = word(p), sync1 = word(p + 2), sync2 = word(p + 4);
      const zero = word(p + 6), one = word(p + 8);
      const pilotCount = word(p + 10);
      const lastBits = image[p + 12];
      const pause = word(p + 13);
      const len = image[p + 15] | (image[p + 16] << 8) | (image[p + 17] << 16);
      const data = image.subarray(p + 18, p + 18 + len);
      p += 18 + len;
      pilotTone(pilot, pilotCount);
      out.push(toCpu(sync1), toCpu(sync2));
      dataBits(data, lastBits || 8, zero, one);
      gap(pause);
    } else if (id === 0x12) { // pure tone
      pilotTone(word(p), word(p + 2));
      p += 4;
    } else if (id === 0x13) { // pulse sequence
      const n = image[p++];
      for (let i = 0; i < n; i++) { out.push(toCpu(word(p))); p += 2; }
    } else if (id === 0x14) { // pure data
      const zero = word(p), one = word(p + 2);
      const lastBits = image[p + 4];
      const pause = word(p + 5);
      const len = image[p + 7] | (image[p + 8] << 8) | (image[p + 9] << 16);
      const data = image.subarray(p + 10, p + 10 + len);
      p += 10 + len;
      dataBits(data, lastBits || 8, zero, one);
      gap(pause);
    } else if (id === 0x20) { // pause / stop the tape
      gap(word(p));
      p += 2;
    } else if (id === 0x30) { // text description
      p += 1 + image[p];
    } else if (id === 0x32) { // archive info
      p += 2 + word(p);
    } else if (id === 0x33) { // hardware type
      p += 1 + image[p] * 3;
    } else if (id === 0x35) { // custom info
      p += 0x14 + (image[p + 0x10] | (image[p + 0x11] << 8) | (image[p + 0x12] << 16) | (image[p + 0x13] << 24));
    } else {
      throw new Error(`unsupported TZX block 0x${id.toString(16).padStart(2, '0')}`);
    }
  }
  return Int32Array.from(out);
}
