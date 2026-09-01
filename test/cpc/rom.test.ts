import { describe, it, expect } from 'vitest';
import { makeCPC } from '../../src/cpc';
import { updateRomPaging } from '../../src/cpc/rom';

// A fake 16K ROM whose bytes encode their own address, so a read tells us
// exactly which store answered.
function fakeRom(tag: number): Uint8Array {
  const r = new Uint8Array(0x4000);
  for (let i = 0; i < r.length; i++) r[i] = (tag + i) & 0xff;
  return r;
}

describe('ROM paging', () => {
  it('with no ROMs loaded, reads come straight from RAM', () => {
    const m = makeCPC();
    m.ram[0x0000] = 0x11;
    m.ram[0xc000] = 0x22;
    expect(m.bus.read(0x0000)).toBe(0x11);
    expect(m.bus.read(0xc000)).toBe(0x22);
    expect(m.romLow).toBeNull();
    expect(m.romHigh).toBeNull();
  });

  it('lower ROM pages in and out via Gate Array bit 2', () => {
    const m = makeCPC();
    m.roms.lower = fakeRom(0x40);
    m.ram[0x0000] = 0xaa;

    m.bus.out(0x7f00, 0x88); // %10001000: lower ROM enabled (bit 2 clear)
    expect(m.bus.read(0x0000)).toBe(0x40);
    expect(m.bus.read(0x3fff)).toBe((0x40 + 0x3fff) & 0xff);
    expect(m.bus.read(0x4000)).toBe(m.ram[0x4000]); // window ends at &3FFF

    m.bus.out(0x7f00, 0x8c); // %10001100: lower ROM disabled (bit 2 set)
    expect(m.bus.read(0x0000)).toBe(0xaa);
  });

  it('writes always go to RAM, even with a ROM paged in', () => {
    const m = makeCPC();
    m.roms.lower = fakeRom(0x40);
    m.bus.out(0x7f00, 0x88); // lower ROM enabled

    m.bus.write(0x0000, 0x99);
    expect(m.bus.read(0x0000)).toBe(0x40); // ROM still shadows the read
    expect(m.ram[0x0000]).toBe(0x99); // ...but the write landed

    m.bus.out(0x7f00, 0x8c); // lower ROM disabled
    expect(m.bus.read(0x0000)).toBe(0x99); // paged out: RAM shows through
  });

  it('&DFxx selects the upper ROM, gated by Gate Array bit 3', () => {
    const m = makeCPC();
    m.roms.upper[0] = fakeRom(0x10); // BASIC
    m.roms.upper[7] = fakeRom(0x70); // AMSDOS

    m.bus.out(0x7f00, 0x84); // %10000100: upper ROM enabled (bit 3 clear)
    expect(m.bus.read(0xc000)).toBe(0x10); // defaults to ROM 0

    m.bus.out(0xdf00, 7);
    expect(m.bus.read(0xc000)).toBe(0x70);
    expect(m.bus.read(0xffff)).toBe((0x70 + 0x3fff) & 0xff);

    m.bus.out(0xdf00, 3); // unpopulated -> falls back to ROM 0
    expect(m.bus.read(0xc000)).toBe(0x10);

    m.bus.out(0x7f00, 0x8c); // upper ROM disabled (bit 3 set)
    expect(m.bus.read(0xc000)).toBe(m.ram[0xc000]);
  });

  it('reset pages the ROMs out', () => {
    const m = makeCPC();
    m.roms.lower = fakeRom(0x40);
    m.bus.out(0x7f00, 0x88); // lower ROM enabled
    expect(m.romLow).not.toBeNull();

    m.reset();
    expect(m.romLow).toBeNull();
    expect(m.bus.read(0x0000)).toBe(m.ram[0x0000]);
  });

  it('updateRomPaging honours gaConfig bits directly', () => {
    const m = makeCPC();
    m.roms.lower = fakeRom(0x40);
    m.roms.upper[0] = fakeRom(0x10);

    m.gaConfig = 0x80; // both enabled
    updateRomPaging(m);
    expect(m.romLow).toBe(m.roms.lower);
    expect(m.romHigh).toBe(m.roms.upper[0]);

    m.gaConfig = 0x8d; // both disabled (power-on)
    updateRomPaging(m);
    expect(m.romLow).toBeNull();
    expect(m.romHigh).toBeNull();
  });
});
