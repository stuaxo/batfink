import { describe, it, expect } from 'vitest';
import { makeCPC, frameView, spritePixel, ASIC } from '../../src/cpc';
import { BORDER_X, BORDER_Y } from '../../src/cpc/constants';

// canvas coord for picture pixel (dx, dy)
const cxOf = (dx: number) => BORDER_X + dx;
const cyOf = (dy: number) => (BORDER_Y + dy) * 2;

function plus() {
  const m = makeCPC('gx4000');
  m.reset();
  const a = m.asic!;
  for (let e = 0; e < 32; e++) a.pal12[e] = e; // colour == entry, for easy asserts
  return { m, a };
}

/** sprite `s`: fill 16x16 with pen `pen`, place at (x,y) with mag byte `mag`. */
function put(a: NonNullable<ReturnType<typeof plus>['a']>, s: number, pen: number, x: number, y: number, mag = 0x05) {
  for (let i = 0; i < 256; i++) a.regs[ASIC.SPRITE_DATA + s * 256 + i] = pen;
  const o = ASIC.SPRITE_ATTR + s * 8;
  a.regs[o] = x & 0xff; a.regs[o + 1] = (x >> 8) & 0xff;
  a.regs[o + 2] = y & 0xff; a.regs[o + 3] = (y >> 8) & 0xff;
  a.regs[o + 4] = mag;
}

describe('spritePixel', () => {
  it('returns -1 without an ASIC', () => {
    expect(spritePixel(frameView(makeCPC()), cxOf(10), cyOf(10))).toBe(-1);
  });

  it('shows a sprite pixel where the sprite covers, transparent elsewhere', () => {
    const { m, a } = plus();
    put(a, 0, 7, 20, 30); // pen 7 -> palette entry 16+7 = 23
    const v = frameView(m);
    expect(spritePixel(v, cxOf(25), cyOf(35))).toBe(23);
    expect(spritePixel(v, cxOf(20 + 15), cyOf(30 + 15))).toBe(23); // last pixel
    expect(spritePixel(v, cxOf(36), cyOf(30))).toBe(-1);           // one past the right edge
    expect(spritePixel(v, cxOf(19), cyOf(30))).toBe(-1);           // one before the left edge
  });

  it('pen 0 is transparent', () => {
    const { m, a } = plus();
    put(a, 0, 0, 20, 30);
    expect(spritePixel(frameView(m), cxOf(25), cyOf(35))).toBe(-1);
  });

  it('magnifies per axis', () => {
    const { m, a } = plus();
    put(a, 0, 3, 0, 0, 0x0e); // X mag 2 (bits 0-1 = 2), Y mag 4 (bits 2-3 = 3)
    const v = frameView(m);
    expect(spritePixel(v, cxOf(31), cyOf(63))).toBe(19); // 16*2-1, 16*4-1 still inside
    expect(spritePixel(v, cxOf(32), cyOf(0))).toBe(-1);  // just past 16*2
  });

  it('mag 0 on an axis hides the sprite', () => {
    const { m, a } = plus();
    put(a, 0, 5, 10, 10, 0x00);
    expect(spritePixel(frameView(m), cxOf(15), cyOf(15))).toBe(-1);
  });

  it('sprite 0 wins over sprite 1', () => {
    const { m, a } = plus();
    put(a, 1, 9, 20, 30);
    put(a, 0, 4, 20, 30);
    expect(spritePixel(frameView(m), cxOf(25), cyOf(35))).toBe(20); // entry 16+4
  });

  it('a negative position clips at the left edge', () => {
    const { m, a } = plus();
    put(a, 0, 6, -8, 30);
    const v = frameView(m);
    expect(spritePixel(v, cxOf(0), cyOf(35))).toBe(22);  // sprite pixel 8
    expect(spritePixel(v, cxOf(8), cyOf(35))).toBe(-1);  // past the sprite's right edge (-8 + 16)
  });
});
