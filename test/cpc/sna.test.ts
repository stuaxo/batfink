import { describe, it, expect } from 'vitest';
import { makeZ80 } from '../../src/z80/cpu';
import { makeCPC, snapshotSNA } from '../../src/cpc';

describe('.SNA snapshot', () => {
  it('writes a version 2 header and a 64K memory dump', () => {
    const m = makeCPC();
    const cpu = makeZ80(m.bus);
    cpu.reset();
    cpu.PC = 0x4000;
    cpu.SP = 0xbff0;
    m.ram[0x1234] = 0xab;

    const sna = snapshotSNA(cpu, m);

    expect(sna.length).toBe(0x100 + 0x10000);
    expect(String.fromCharCode(...sna.slice(0, 8))).toBe('MV - SNA');
    expect(sna[0x10]).toBe(2); // version
    expect(sna[0x23] | (sna[0x24] << 8)).toBe(0x4000); // PC
    expect(sna[0x21] | (sna[0x22] << 8)).toBe(0xbff0); // SP
    expect(sna[0x6b]).toBe(64); // 64K dump
    expect(sna[0x100 + 0x1234]).toBe(0xab);
  });

  it('captures the Gate Array mode and palette', () => {
    const m = makeCPC();
    const cpu = makeZ80(m.bus);
    m.bus.out(0x7f00, 0x8d); // both ROMs off, mode 1
    m.bus.out(0x7f00, 0x00); // select pen 0
    m.bus.out(0x7f00, 0x54); // set pen 0 -> hw colour 0x14

    const sna = snapshotSNA(cpu, m);
    expect(sna[0x2f]).toBe(0x14); // pen 0
    expect(sna[0x40] & 0x1f).toBe(0x0d); // GA config low bits
  });
});
