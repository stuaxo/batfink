import { describe, it, expect } from 'vitest';
import { instructionCost, formatCost } from '../../src/debug/timing';

describe('instructionCost', () => {
  it('unconditional instructions have a single cost, rounded to /4', () => {
    expect(instructionCost([0x00])).toEqual({ min: 4, max: 4 }); // nop
    expect(instructionCost([0x3e, 0x41])).toEqual({ min: 8, max: 8 }); // ld a,n (7 -> 8)
    expect(instructionCost([0x21, 0, 0])).toEqual({ min: 12, max: 12 }); // ld hl,nn (10 -> 12)
    expect(instructionCost([0xc3, 0, 0])).toEqual({ min: 12, max: 12 }); // jp nn (10 -> 12)
  });

  it('conditional branches report taken / not-taken', () => {
    const jr = instructionCost([0x20, 0x00]); // jr nz
    expect(jr.max).toBeGreaterThan(jr.min);
    expect(jr.min).toBeGreaterThanOrEqual(8);

    const call = instructionCost([0xc4, 0, 0]); // call nz
    expect(call.max).toBeGreaterThan(call.min);

    const ret = instructionCost([0xc0]); // ret nz
    expect(ret.max).toBeGreaterThan(ret.min);
  });

  it('jp cc is the same either way', () => {
    expect(instructionCost([0xca, 0, 0])).toEqual({ min: 12, max: 12 }); // jp z,nn
  });

  it('djnz reports both paths', () => {
    const c = instructionCost([0x10, 0x00]);
    expect(c.max).toBeGreaterThan(c.min);
  });

  it('ldir reports repeat vs done', () => {
    const c = instructionCost([0xed, 0xb0]);
    expect(c.max).toBeGreaterThan(c.min);
  });

  it('formats as max/min for the ambiguous ones', () => {
    expect(formatCost({ min: 4, max: 4 })).toBe('4');
    expect(formatCost({ min: 8, max: 12 })).toBe('12/8');
  });
});
