import { describe, it, expect } from 'vitest';
import { makeCPC, CPC_PALETTE, WIDTH, HEIGHT } from '../../src/cpc';
import { BORDER_X, BORDER_Y, PENS_PER_LINE } from '../../src/cpc/constants';

const rgbAt = (buf: Uint8ClampedArray, x: number, canvasRow: number): number[] => {
  const o = (canvasRow * WIDTH + x) * 4;
  return [buf[o], buf[o + 1], buf[o + 2]];
};

describe('mid-line palette split', () => {
  it('a pen write partway along a scanline changes colour from that point right', () => {
    const m = makeCPC();
    m.reset();
    // Displayed row 0: every byte 0xF0 -> four mode-1 pixels of pen 1.
    for (let b = 0; b < 80; b++) m.ram[0xc000 + b] = 0xf0;
    m.linePens[PENS_PER_LINE * 0 + 1] = 6; // row opens with pen 1 = colour 6

    // ...then pen 1 is rewritten to colour 26 at cycle 80 of line 0 (~byte 40).
    m.paletteWrites.set([0, 80, 1, 26]);
    m.paletteWriteCount = 1;

    const rgba = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
    m.render(rgba);

    const row = (0 + BORDER_Y) * 2; // displayed row 0
    expect(rgbAt(rgba, BORDER_X + 40, row)).toEqual([...CPC_PALETTE[6]]);
    expect(rgbAt(rgba, BORDER_X + 600, row)).toEqual([...CPC_PALETTE[26]]);
  });

  it('with no mid-line writes the row is a single colour', () => {
    const m = makeCPC();
    m.reset();
    for (let b = 0; b < 80; b++) m.ram[0xc000 + b] = 0xf0;
    m.linePens[PENS_PER_LINE * 0 + 1] = 6;

    const rgba = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
    m.render(rgba);

    const row = BORDER_Y * 2;
    expect(rgbAt(rgba, BORDER_X + 40, row)).toEqual([...CPC_PALETTE[6]]);
    expect(rgbAt(rgba, BORDER_X + 600, row)).toEqual([...CPC_PALETTE[6]]);
  });
});
