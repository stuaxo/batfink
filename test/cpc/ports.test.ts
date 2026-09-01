import { describe, it, expect } from 'vitest';
import { makeCPC } from '../../src/cpc';

describe('I/O port decode', () => {
  it('Gate Array: pen select, ink set, mode', () => {
    const m = makeCPC();
    m.bus.out(0x7f00, 0x80 | 0x0d); // mode 1, ROMs off
    expect(m.mode).toBe(1);

    m.bus.out(0x7f00, 0x00 | 3); // select pen 3
    m.bus.out(0x7f00, 0x40 | 0x0a); // set it to hw colour 0x0A
    expect(m.pens[3]).toBe(0x0a);

    m.bus.out(0x7f00, 0x00 | 0x10); // select border
    m.bus.out(0x7f00, 0x40 | 0x04);
    expect(m.pens[16]).toBe(0x04);
  });

  it('CRTC: register select then write', () => {
    const m = makeCPC();
    m.bus.out(0xbc00, 1); // select R1 (horizontal displayed)
    m.bus.out(0xbd00, 42);
    expect(m.crtc[1]).toBe(42);
  });

  it('PPI: port C picks the keyboard line, port A reads it', () => {
    const m = makeCPC();
    m.setKey(2, 5, true); // ShiftLeft: line 2, bit 5
    m.bus.out(0xf600, 2); // PPI port C -> keyboard line 2
    expect(m.bus.in(0xf400) & (1 << 5)).toBe(0); // bit low = pressed
    m.bus.out(0xf600, 3);
    expect(m.bus.in(0xf400)).toBe(0xff); // nothing pressed on line 3
  });

  it('PPI port B reports the VSYNC flag in bit 0', () => {
    const m = makeCPC();
    m.vsync = false;
    expect(m.bus.in(0xf500) & 0x01).toBe(0);
    m.vsync = true;
    expect(m.bus.in(0xf500) & 0x01).toBe(1);
  });

  it('unmapped ports read back 0xFF', () => {
    const m = makeCPC();
    expect(m.bus.in(0x0000)).toBe(0xff);
  });
});
