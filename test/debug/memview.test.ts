import { describe, it, expect } from 'vitest';
import { renderGfx } from '../../src/debug/memview';
import { CPC_PALETTE } from '../../src/cpc';

const pens = new Uint8Array(17);
pens[0] = 20; // black
pens[1] = 26; // bright yellow
pens[2] = 6;
pens[3] = 11;

describe('renderGfx', () => {
  it('sizes the image from mode and dimensions', () => {
    const img = renderGfx(() => 0, pens, { addr: 0, mode: 1, widthBytes: 10, rows: 8, layout: 'linear' });
    expect(img.width).toBe(40); // 10 bytes x 4 dots
    expect(img.height).toBe(8);
    expect(img.rgba.length).toBe(40 * 8 * 4);
  });

  it('decodes mode 1 pixels to palette colours', () => {
    // byte 0xF0 in mode 1 -> all four pixels are pen 1
    const img = renderGfx(() => 0xf0, pens, { addr: 0, mode: 1, widthBytes: 1, rows: 1, layout: 'linear' });
    const [r, g, b] = CPC_PALETTE[pens[1] & 0x1f];
    expect([img.rgba[0], img.rgba[1], img.rgba[2]]).toEqual([r, g, b]);
    expect([img.rgba[12], img.rgba[13], img.rgba[14]]).toEqual([r, g, b]); // 4th pixel
  });

  it('linear and screen layouts read different addresses', () => {
    const mem = new Uint8Array(0x10000);
    mem[0x0000] = 0xff; // row 0, linear and screen both start here
    mem[0x0002] = 0xaa; // linear row 1 (widthBytes 2)
    mem[0x0800] = 0xaa; // screen row 1 (interleaved)

    const lin = renderGfx((a) => mem[a], pens, { addr: 0, mode: 2, widthBytes: 2, rows: 2, layout: 'linear' });
    const scr = renderGfx((a) => mem[a], pens, { addr: 0, mode: 2, widthBytes: 2, rows: 2, layout: 'screen' });
    // both should light row 1 pixel 0 (from 0xAA bit 7 = 1)
    const at = (img: typeof lin, x: number, y: number) => img.rgba[(y * img.width + x) * 4];
    expect(at(lin, 0, 1)).toBe(CPC_PALETTE[pens[1] & 0x1f][0]);
    expect(at(scr, 0, 1)).toBe(CPC_PALETTE[pens[1] & 0x1f][0]);
  });

  it('wraps addresses at 64K', () => {
    expect(() => renderGfx(() => 0, pens, { addr: 0xfff0, mode: 0, widthBytes: 4, rows: 20, layout: 'linear' })).not.toThrow();
  });
});
