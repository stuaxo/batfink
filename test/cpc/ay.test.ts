import { describe, it, expect } from 'vitest';
import { Ay } from '../../src/cpc/ay';

const SR = 48000;

function run(ay: Ay, n: number): Float64Array {
  const buf = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    ay.process();
    ay.removeDc();
    buf[i] = ay.left + ay.right;
  }
  return buf;
}

const rms = (b: Float64Array) => Math.sqrt([...b].reduce((a, v) => a + v * v, 0) / b.length);
/** RMS of the settled tail (past the DC filter's ~1024-sample warm-up). */
const tailRms = (b: Float64Array) => rms(b.subarray(Math.min(3000, b.length >> 1)));

function dominantHz(b: Float64Array): number {
  let crossings = 0;
  for (let i = 1; i < b.length; i++) if ((b[i - 1] < 0) !== (b[i] < 0)) crossings++;
  return (crossings / 2) * (SR / b.length);
}

describe('Ay', () => {
  it('is silent at volume 0', () => {
    const ay = new Ay(1_000_000, SR);
    ay.writeReg(8, 0);
    ay.writeReg(9, 0);
    ay.writeReg(10, 0);
    expect(rms(run(ay, 4000))).toBe(0);
  });

  it('a channel with tone and noise both off holds a DC level (digidrum trick)', () => {
    const ay = new Ay(1_000_000, SR);
    ay.writeReg(7, 0x3f); // tone + noise off on all channels
    ay.writeReg(8, 15);
    const b = run(ay, 8000);
    // strong DC once the resampler has filled, before the blocker removes it
    expect(Math.abs(b[120])).toBeGreaterThan(0.4);
    expect(tailRms(b)).toBeLessThan(0.05);
  });

  it('plays a tone near the expected frequency', () => {
    const ay = new Ay(1_000_000, SR);
    const period = Math.round(1_000_000 / (16 * 440)); // ~142
    ay.writeReg(0, period & 0xff);
    ay.writeReg(1, period >> 8);
    ay.writeReg(8, 15);
    ay.writeReg(7, 0b111_110); // tone A on
    const hz = dominantHz(run(ay, SR));
    expect(hz).toBeGreaterThan(400);
    expect(hz).toBeLessThan(480);
  });

  it('louder volume is louder', () => {
    const period = 200;
    const at = (vol: number) => {
      const ay = new Ay(1_000_000, SR);
      ay.writeReg(0, period & 0xff);
      ay.writeReg(1, period >> 8);
      ay.writeReg(8, vol);
      ay.writeReg(7, 0b111_110);
      return rms(run(ay, 8000));
    };
    expect(at(4)).toBeGreaterThan(at(1));
    expect(at(15)).toBeGreaterThan(at(8));
  });

  it('the noise channel is broadband', () => {
    const ay = new Ay(1_000_000, SR);
    ay.writeReg(6, 8); // noise period
    ay.writeReg(8, 15);
    ay.writeReg(7, 0b110_111); // noise A on (bit3=0), tone A off
    const b = run(ay, 8000);
    expect(rms(b)).toBeGreaterThan(0.05);
    expect(dominantHz(b)).toBeGreaterThan(1000); // not a clean pitch
  });

  it('a repeating envelope modulates a held channel', () => {
    const ay = new Ay(1_000_000, SR);
    ay.writeReg(0, 4); ay.writeReg(1, 0); // fast tone so it is "on" often
    ay.writeReg(11, 0x00); ay.writeReg(12, 0x20); // envelope period
    ay.writeReg(13, 0x0e); // continue+attack+alternate -> triangle
    ay.writeReg(8, 0x10); // channel A uses the envelope
    ay.writeReg(7, 0b111_110);
    const b = run(ay, SR);
    // envelope makes the amplitude rise and fall: windowed RMS should vary
    const w = 2400;
    let lo = Infinity;
    let hi = 0;
    for (let i = 0; i + w < b.length; i += w) {
      const r = rms(b.subarray(i, i + w));
      lo = Math.min(lo, r);
      hi = Math.max(hi, r);
    }
    expect(hi).toBeGreaterThan(lo * 1.5);
  });

  it('writeReg(13, 0xFF) is a no-op, other values retrigger', () => {
    const setup = () => {
      const ay = new Ay(1_000_000, SR);
      ay.writeReg(0, 3); ay.writeReg(1, 0);
      ay.writeReg(11, 0x40); ay.writeReg(12, 0x00);
      ay.writeReg(8, 0x10); // channel A on the envelope
      ay.writeReg(7, 0b111_110);
      ay.writeReg(13, 0x0c); // sawtooth
      run(ay, 5000); // let the envelope get somewhere mid-ramp
      return ay;
    };
    const a = setup();
    const b = setup();
    a.writeReg(13, 0xff); // no-op
    b.writeReg(13, 0x0c); // retrigger -> envelope restarts from 0
    const aRms = rms(run(a, 400));
    const bRms = rms(run(b, 400));
    // right after a retrigger the ramp is near the bottom -> quieter
    expect(bRms).toBeLessThan(aRms);
  });

  it('reset silences it', () => {
    const ay = new Ay(1_000_000, SR);
    ay.writeReg(0, 100); ay.writeReg(8, 15); ay.writeReg(7, 0b111_110);
    expect(tailRms(run(ay, 4000))).toBeGreaterThan(0.05);
    ay.reset();
    ay.writeReg(8, 0);
    expect(rms(run(ay, 4000))).toBe(0);
  });
});
