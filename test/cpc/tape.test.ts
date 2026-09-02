import { describe, it, expect } from 'vitest';
import { Tape, readCdt } from '../../src/cpc';
import { makeCdt } from '../../src/export';

describe('Tape', () => {
  it('holds its level until the motor turns on', () => {
    const t = new Tape(Int32Array.from([100, 100, 100]));
    t.advance(1000);
    expect(t.level).toBe(0);
    expect(t.position).toBe(0);
    t.motorOn = true;
    t.advance(150);
    expect(t.level).toBe(1); // crossed the first boundary
  });

  it('toggles the level at each pulse boundary', () => {
    const t = new Tape(Int32Array.from([100, 100, 100, 100]));
    t.motorOn = true;
    const seen: number[] = [t.level];
    for (let i = 0; i < 4; i++) { t.advance(100); seen.push(t.level); }
    expect(seen).toEqual([0, 1, 0, 1, 1]); // last advance runs off the end, no flip
    expect(t.atEnd).toBe(true);
  });

  it('rewinds to the start', () => {
    const t = new Tape(Int32Array.from([50, 50]));
    t.motorOn = true;
    t.advance(999);
    expect(t.atEnd).toBe(true);
    t.rewind();
    expect(t.atEnd).toBe(false);
    expect(t.level).toBe(0);
    expect(t.position).toBe(0);
  });

  it('snapshot / restore keeps the play position', () => {
    const t = new Tape(Int32Array.from([200, 200, 200, 200]));
    t.motorOn = true;
    t.advance(250);
    const s = t.getState();

    const t2 = new Tape(Int32Array.from([200, 200, 200, 200]));
    t2.setState(s);
    expect(t2.level).toBe(t.level);
    expect(t2.position).toBe(t.position);
    t2.advance(200);
    t.advance(200);
    expect(t2.level).toBe(t.level);
  });
});

describe('readCdt', () => {
  it('rejects a non-tape blob', () => {
    expect(() => readCdt(new Uint8Array(64))).toThrow(/not a .cdt/);
  });

  it('expands a makeCdt image to a pulse list', () => {
    const cdt = makeCdt(new Uint8Array([1, 2, 3, 4]), { filename: 'X', loadAddr: 0x4000, entryAddr: 0x4000 });
    const pulses = readCdt(cdt);
    // header record + data record, each = pilot tone (thousands of pulses) +
    // 2 sync + 2 per data bit + a gap
    expect(pulses.length).toBeGreaterThan(8000);
    expect(pulses.every((p) => p > 0)).toBe(true);
    // the leading pilot pulses are all one length
    expect(pulses[0]).toBe(pulses[1]);
    expect(pulses[0]).toBe(pulses[100]);
  });

  it('skips metadata blocks (text, archive info)', () => {
    // ZXTape! 1.20, a 0x30 text block "hi", then a 0x20 pause of 0
    const img = Uint8Array.from([
      0x5a, 0x58, 0x54, 0x61, 0x70, 0x65, 0x21, 0x1a, 1, 20,
      0x30, 2, 0x68, 0x69,
      0x20, 0x00, 0x00,
    ]);
    expect(readCdt(img)).toHaveLength(0);
  });
});
