import { describe, it, expect } from 'vitest';
import { makeZ80 } from '../../src/z80/cpu';
import { makeCPC, readCpr, writeCpr, runUntil } from '../../src/cpc';
import { installCartridge } from '../../src/cpc/roms';

const block = (fill: number): Uint8Array => new Uint8Array(0x4000).fill(fill);

describe('readCpr / writeCpr', () => {
  it('round-trips a multi-block cartridge', () => {
    const pages = [block(0x11), block(0x22), block(0x33)];
    const round = readCpr(writeCpr(pages));
    expect(round.length).toBe(3);
    expect([...round[0].subarray(0, 2)]).toEqual([0x11, 0x11]);
    expect([...round[2].subarray(0, 2)]).toEqual([0x33, 0x33]);
  });

  it('zero-pads a short block up to 16K', () => {
    const short = new Uint8Array(0x4000);
    short.set([1, 2, 3]);
    // hand-write a chunk that declares only 3 bytes
    const out = new Uint8Array(12 + 8 + 4); // RIFF hdr + one 3-byte (padded to 4) chunk
    out.set([...'RIFF'].map((c) => c.charCodeAt(0)), 0);
    new DataView(out.buffer).setUint32(4, 4 + 8 + 4, true);
    out.set([...'AMS!'].map((c) => c.charCodeAt(0)), 8);
    out.set([...'cb00'].map((c) => c.charCodeAt(0)), 12);
    new DataView(out.buffer).setUint32(16, 3, true);
    out.set([1, 2, 3], 20);

    const pages = readCpr(out);
    expect(pages[0].length).toBe(0x4000);
    expect([...pages[0].subarray(0, 4)]).toEqual([1, 2, 3, 0]);
  });

  it('fills gaps between sparse blocks', () => {
    const pages: Uint8Array[] = [];
    pages[0] = block(0xaa);
    pages[3] = block(0xbb);
    const round = readCpr(writeCpr(pages));
    expect(round.length).toBe(4);
    expect(round[1].every((v) => v === 0)).toBe(true);
    expect(round[3][0]).toBe(0xbb);
  });

  it('drops trailing empty blocks on write', () => {
    const pages = [block(0x11), block(0), block(0)];
    expect(readCpr(writeCpr(pages)).length).toBe(1);
  });

  it('rejects a non-RIFF or non-AMS! file', () => {
    expect(() => readCpr(new Uint8Array(4))).toThrow(/RIFF/);
    const notAms = writeCpr([block(1)]);
    notAms.set([...'TZX '].map((c) => c.charCodeAt(0)), 8);
    expect(() => readCpr(notAms)).toThrow(/cartridge/);
  });

  it('rejects a cartridge with no block 0', () => {
    // RIFF / AMS! wrapper carrying only a cb01 chunk
    const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
    const out = new Uint8Array(12 + 8 + 0x4000);
    out.set(ascii('RIFF'), 0);
    new DataView(out.buffer).setUint32(4, out.length - 8, true);
    out.set(ascii('AMS!'), 8);
    out.set(ascii('cb01'), 12);
    new DataView(out.buffer).setUint32(16, 0x4000, true);
    expect(() => readCpr(out)).toThrow(/block 0/);
  });
});

describe('installCartridge', () => {
  it('runs block 0 from the reset vector', () => {
    const boot = block(0);
    // at &0000: LD A,&C9 / LD (&8000),A / HALT
    boot.set([0x3e, 0xc9, 0x32, 0x00, 0x80, 0x76], 0x0000);
    const pages = [boot, block(0x77)];

    const m = makeCPC('gx4000');
    const cpu = makeZ80(m.bus);
    m.reset();
    installCartridge(m, pages);
    cpu.reset();
    cpu.PC = 0x0000;

    runUntil(cpu, m, { maxSteps: 20 });
    expect(m.ram[0x8000]).toBe(0xc9); // block 0 executed
    expect(m.bus.read(0x0000)).toBe(0x3e); // block 0 still shadows &0000
  });

  it('the ROM-select latch pages a block into &C000', () => {
    const m = makeCPC('gx4000');
    const pages = [block(0x00), block(0x11), block(0x22)];
    m.reset();
    installCartridge(m, pages);

    m.bus.out(0x7f00, 0x84); // upper ROM window enabled
    expect(m.bus.read(0xc000)).toBe(0x00); // block 0 by default
    m.bus.out(0xdf00, 2);
    expect(m.bus.read(0xc000)).toBe(0x22);
  });
});
