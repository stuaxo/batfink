import { describe, it, expect } from 'vitest';
import { makeCPC } from '../../src/cpc';
import { screenAddressAt } from '../../src/debug/screen';
import { BORDER_X, BORDER_Y } from '../../src/cpc/constants';

describe('screenAddressAt', () => {
  it('maps the top-left displayed pixel to the screen base', () => {
    const m = makeCPC(); // default CRTC: R1=40, R12=0x30 -> base &C000, offset 0
    const hit = screenAddressAt(m, BORDER_X, BORDER_Y * 2)!;
    expect(hit).not.toBeNull();
    expect(hit.addr).toBe(0xc000);
    expect(hit.byteCol).toBe(0);
    expect(hit.row).toBe(0);
    expect(hit.pixelInByte).toBe(0);
  });

  it('returns null outside the picture', () => {
    const m = makeCPC();
    expect(screenAddressAt(m, 0, 0)).toBeNull(); // in the border
    expect(screenAddressAt(m, 5000, 5000)).toBeNull();
  });

  it('interleaves rows in &800 blocks', () => {
    const m = makeCPC();
    // row 1 is raster 1 of char row 0 -> base + 0x800
    const r1 = screenAddressAt(m, BORDER_X, (BORDER_Y + 1) * 2)!;
    expect(r1.addr).toBe(0xc800);
    // row 8 is raster 0 of char row 1 -> base + bytesPerLine (80)
    const r8 = screenAddressAt(m, BORDER_X, (BORDER_Y + 8) * 2)!;
    expect(r8.addr).toBe(0xc000 + 80);
  });

  it('reports the pixel within the byte for the mode', () => {
    const m = makeCPC();
    m.mode = 1; // 4 pixels per byte, 2 canvas px each
    const hit = screenAddressAt(m, BORDER_X + 5, BORDER_Y * 2)!;
    expect(hit.pixelsPerByte).toBe(4);
    expect(hit.pixelInByte).toBe(2); // 5 canvas px -> logical px 2
    expect(hit.byteCol).toBe(0);
  });

  it('follows the CRTC display-start offset', () => {
    const m = makeCPC();
    m.crtc[13] = 10; // offset = 20 bytes
    const hit = screenAddressAt(m, BORDER_X, BORDER_Y * 2)!;
    expect(hit.addr).toBe(0xc000 + 20);
  });
});
