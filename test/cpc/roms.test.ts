import { describe, it, expect } from 'vitest';
import { makeCPC } from '../../src/cpc';
import { splitFirmware, installFirmware, removeFirmware } from '../../src/cpc/roms';

function fakeFirmware(): Uint8Array {
  const rom = new Uint8Array(0x8000);
  rom.fill(0xa1, 0x0000, 0x4000); // lower
  rom.fill(0xb2, 0x4000, 0x8000); // upper
  return rom;
}

describe('firmware ROM loading', () => {
  it('splitFirmware halves a 32K image', () => {
    const { lower, upper } = splitFirmware(fakeFirmware());
    expect(lower.length).toBe(0x4000);
    expect(upper.length).toBe(0x4000);
    expect(lower[0]).toBe(0xa1);
    expect(upper[0]).toBe(0xb2);
  });

  it('splitFirmware rejects a wrong size', () => {
    expect(() => splitFirmware(new Uint8Array(0x4000))).toThrow(/32768/);
  });

  it('installFirmware maps lower + BASIC and enables both windows', () => {
    const m = makeCPC();
    installFirmware(m, fakeFirmware());
    expect(m.bus.read(0x0000)).toBe(0xa1);
    expect(m.bus.read(0xc000)).toBe(0xb2);
    expect(m.bus.read(0x8000)).toBe(m.ram[0x8000]); // RAM window untouched
  });

  it('installFirmware maps AMSDOS as upper ROM 7', () => {
    const m = makeCPC();
    installFirmware(m, fakeFirmware(), { amsdos: new Uint8Array(0x4000).fill(0xc3) });
    m.bus.out(0xdf00, 7);
    expect(m.bus.read(0xc000)).toBe(0xc3);
    expect(() => installFirmware(m, fakeFirmware(), { amsdos: new Uint8Array(10) })).toThrow(/16384/);
  });

  it('removeFirmware returns to the bare RAM-only machine', () => {
    const m = makeCPC();
    installFirmware(m, fakeFirmware());
    removeFirmware(m);
    expect(m.romLow).toBeNull();
    expect(m.romHigh).toBeNull();
    expect(m.bus.read(0x0000)).toBe(m.ram[0x0000]);
  });

  it('firmware ROMs still page out when a program sets the Gate Array', () => {
    const m = makeCPC();
    installFirmware(m, fakeFirmware());
    m.bus.out(0x7f00, 0x8d); // %10001101: both ROMs off, mode 1 — as demos do
    expect(m.bus.read(0x0000)).toBe(m.ram[0x0000]);
    expect(m.bus.read(0xc000)).toBe(m.ram[0xc000]);
  });
});
