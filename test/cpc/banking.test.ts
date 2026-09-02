import { describe, it, expect } from 'vitest';
import { makeZ80 } from '../../src/z80/cpu';
import { makeCPC, setExtRam, setRamConfig, RAM_CONFIGS, getState, setState } from '../../src/cpc';

const cfg = (n: number) => 0xc0 | n;

describe('6128 RAM banking', () => {
  it('a 464 machine ignores RAM-config writes', () => {
    const m = makeCPC();
    m.ram[0x4000] = 0x11;
    m.bus.out(0x7f00, cfg(2));
    expect(m.ram128).toBe(false);
    expect(m.banks).toBeNull();
    expect(m.ram[0x4000]).toBe(0x11); // unchanged
  });

  it('setExtRam turns the second 64K on, config 0', () => {
    const m = makeCPC();
    m.ram.fill(0x22);
    setExtRam(m, true);
    expect(m.ram128).toBe(true);
    expect(m.banks).toHaveLength(8 * 0x4000);
    expect(Array.from(m.bankAt)).toEqual([0, 1, 2, 3]);
    // banks 0-3 seeded from the live 64K, 4-7 clear
    expect(m.banks![0]).toBe(0x22);
    expect(m.banks![4 * 0x4000]).toBe(0);
  });

  it('each config maps the right physical bank into &4000', () => {
    const m = makeCPC();
    setExtRam(m, true);
    // In each config, write "which bank is here" through the bus, then read it
    // all back — repeats (configs 0 and 1 both use bank 1) just rewrite it.
    for (let c = 0; c < 8; c++) {
      setRamConfig(m, cfg(c));
      m.bus.write(0x4000, 0x40 | RAM_CONFIGS[c][1]);
    }
    for (let c = 0; c < 8; c++) {
      setRamConfig(m, cfg(c));
      expect(m.bus.read(0x4000)).toBe(0x40 | RAM_CONFIGS[c][1]);
    }
  });

  it('writes land in the mapped bank and survive a round trip', () => {
    const m = makeCPC();
    setExtRam(m, true);

    setRamConfig(m, cfg(4)); // bank 4 at &4000
    m.bus.write(0x5000, 0xab);
    expect(m.bus.read(0x5000)).toBe(0xab);

    setRamConfig(m, cfg(0)); // bank 1 at &4000
    expect(m.bus.read(0x5000)).toBe(0x00);
    m.bus.write(0x5000, 0xcd);

    setRamConfig(m, cfg(4));
    expect(m.bus.read(0x5000)).toBe(0xab); // bank 4 kept its byte

    setRamConfig(m, cfg(0));
    expect(m.bus.read(0x5000)).toBe(0xcd); // bank 1 kept its byte
  });

  it('config 2 swaps all four slots to the upper 64K', () => {
    const m = makeCPC();
    setExtRam(m, true);
    for (let b = 0; b < 8; b++) m.banks![b * 0x4000] = 0x10 + b;
    // seed the visible slots so the writeback of 0-3 is harmless
    for (let s = 0; s < 4; s++) m.ram[s * 0x4000] = 0x10 + s;

    setRamConfig(m, cfg(2));
    expect([m.ram[0], m.ram[0x4000], m.ram[0x8000], m.ram[0xc000]]).toEqual([0x14, 0x15, 0x16, 0x17]);
    setRamConfig(m, cfg(0));
    expect([m.ram[0], m.ram[0x4000], m.ram[0x8000], m.ram[0xc000]]).toEqual([0x10, 0x11, 0x12, 0x13]);
  });

  it('getState / setState round-trips 128K and the mapping', () => {
    const m = makeCPC();
    const cpu = makeZ80(m.bus);
    setExtRam(m, true);
    setRamConfig(m, cfg(4));
    m.bus.write(0x4010, 0x7e); // into bank 4
    setRamConfig(m, cfg(2));   // now something else is visible

    const snap = getState(cpu, m);

    const m2 = makeCPC();
    const cpu2 = makeZ80(m2.bus);
    setExtRam(m2, true);
    setState(cpu2, m2, snap);

    expect(m2.ram128).toBe(true);
    expect(Array.from(m2.bankAt)).toEqual(Array.from(m.bankAt));
    setRamConfig(m2, cfg(4));
    expect(m2.bus.read(0x4010)).toBe(0x7e);
  });

  it('reset returns to config 0 with banks 0-3 visible', () => {
    const m = makeCPC();
    setExtRam(m, true);
    for (let b = 0; b < 8; b++) m.banks![b * 0x4000] = b;
    for (let s = 0; s < 4; s++) m.ram[s * 0x4000] = s;
    setRamConfig(m, cfg(2));
    expect(m.ram[0x4000]).toBe(5);

    m.reset();
    expect(m.ramConfig).toBe(0);
    expect(Array.from(m.bankAt)).toEqual([0, 1, 2, 3]);
    expect(m.ram[0x4000]).toBe(1);
  });
});
