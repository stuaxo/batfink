import { describe, it, expect, vi } from 'vitest';
import { makeCPC } from '../../src/cpc';

/** The canonical CPC sequence to write PSG register `reg` with `value`. */
function psgWrite(m: ReturnType<typeof makeCPC>, reg: number, value: number) {
  m.bus.out(0xf400, reg); // port A = register number
  m.bus.out(0xf6c0, 0xc0); // port C: BDIR|BC1 -> latch address
  m.bus.out(0xf600, 0x00); // port C: inactive
  m.bus.out(0xf400, value); // port A = data
  m.bus.out(0xf680, 0x80); // port C: BDIR -> write
  m.bus.out(0xf600, 0x00); // port C: inactive
}

describe('PSG register access', () => {
  it('the PPI write dance lands in m.psg', () => {
    const m = makeCPC();
    psgWrite(m, 0, 0xfe); // tone A fine
    psgWrite(m, 8, 0x0d); // volume A
    expect(m.psg[0]).toBe(0xfe);
    expect(m.psg[8]).toBe(0x0d);
    expect(m.psgSelect).toBe(8);
  });

  it('applies the per-register mask', () => {
    const m = makeCPC();
    psgWrite(m, 1, 0xff); // tone A coarse -> 4 bits
    psgWrite(m, 6, 0xff); // noise -> 5 bits
    psgWrite(m, 13, 0xff); // envelope shape -> 4 bits
    expect(m.psg[1]).toBe(0x0f);
    expect(m.psg[6]).toBe(0x1f);
    expect(m.psg[13]).toBe(0x0f);
  });

  it('notifies psgWrite with the masked value', () => {
    const m = makeCPC();
    const hook = vi.fn();
    m.psgWrite = hook;
    psgWrite(m, 7, 0x38); // mixer
    psgWrite(m, 8, 0x1f);
    expect(hook).toHaveBeenCalledWith(7, 0x38);
    expect(hook).toHaveBeenCalledWith(8, 0x1f);
  });

  it('the snapshot carries PSG state', () => {
    const m = makeCPC();
    psgWrite(m, 2, 0x55);
    expect(m.psg[2]).toBe(0x55);
    const fresh = makeCPC();
    expect(fresh.psg[2]).toBe(0); // reset state is silent
  });

  it('latch alone does not write', () => {
    const m = makeCPC();
    m.bus.out(0xf400, 5); // port A = 5
    m.bus.out(0xf6c0, 0xc0); // latch
    m.bus.out(0xf400, 0x99); // port A = 0x99, but no write strobe
    expect(m.psg[5]).toBe(0);
    expect(m.psgSelect).toBe(5);
  });
});
