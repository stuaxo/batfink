import { describe, it, expect } from 'vitest';
import { makeZ80 } from '../../src/z80/cpu';
import { makeCPC, getState, setState, ASIC, ASIC_UNLOCK, hwTo12 } from '../../src/cpc';

const unlock = (m: ReturnType<typeof makeCPC>, seq: readonly number[] = ASIC_UNLOCK) => {
  for (const b of seq) m.bus.out(0xbc00, b);
};

describe('ASIC', () => {
  it('exists on the Plus family only', () => {
    expect(makeCPC('cpc464').asic).toBeNull();
    expect(makeCPC('cpc6128').asic).toBeNull();
    expect(makeCPC('plus464').asic).not.toBeNull();
    expect(makeCPC('plus6128').asic).not.toBeNull();
    expect(makeCPC('gx4000').asic).not.toBeNull();
  });

  it('unlocks after the full &BCxx sequence', () => {
    const m = makeCPC('gx4000');
    expect(m.asic!.unlocked).toBe(false);
    unlock(m);
    expect(m.asic!.unlocked).toBe(true);
  });

  it('a wrong byte restarts the match', () => {
    const m = makeCPC('gx4000');
    unlock(m, ASIC_UNLOCK.slice(0, 8));
    m.bus.out(0xbc00, 0x99);        // breaks the run
    unlock(m);                       // a clean run from the top
    expect(m.asic!.unlocked).toBe(true);
  });

  it('absorbs extra leading &FF bytes', () => {
    const m = makeCPC('gx4000');
    unlock(m, [0xff, 0xff, 0xff, ...ASIC_UNLOCK]);
    expect(m.asic!.unlocked).toBe(true);
  });

  it('pages the register block over &4000-&7FFF on &DFxx = &B8-&BF', () => {
    const m = makeCPC('gx4000');
    m.ram[0x4000] = 0x11;

    m.bus.out(0xdf00, 0xb8);          // no effect while locked
    expect(m.asic!.pageIn).toBe(false);
    expect(m.bus.read(0x4000)).toBe(0x11);

    unlock(m);
    m.bus.out(0xdf00, 0xb8);
    expect(m.asic!.pageIn).toBe(true);
    m.bus.write(0x4000 + ASIC.PRI, 42);
    expect(m.asic!.regs[ASIC.PRI]).toBe(42);
    expect(m.bus.read(0x4000 + ASIC.PRI)).toBe(42);
    expect(m.ram[0x4000]).toBe(0x11); // RAM untouched underneath

    m.bus.out(0xdf00, 0x00);
    expect(m.asic!.pageIn).toBe(false);
    expect(m.bus.read(0x4000)).toBe(0x11); // RAM shows through again
  });

  it('a reset re-locks it and clears the register page', () => {
    const m = makeCPC('plus6128');
    unlock(m);
    m.bus.out(0xdf00, 0xb8);
    m.bus.write(0x4000 + ASIC.PALETTE, 0x0f);
    m.reset();
    expect(m.asic!.unlocked).toBe(false);
    expect(m.asic!.pageIn).toBe(false);
    expect(m.asic!.regs[ASIC.PALETTE]).toBe(0);
  });

  it('a direct palette-register write updates pal12', () => {
    const m = makeCPC('gx4000');
    unlock(m);
    m.bus.out(0xdf00, 0xb8);
    // entry 3: GGGGRRRR = 0xA5 (G=10, R=5), ----BBBB = 0x0C (B=12)
    m.bus.write(0x4000 + ASIC.PALETTE + 6, 0xa5);
    m.bus.write(0x4000 + ASIC.PALETTE + 7, 0x0c);
    expect(m.asic!.pal12[3]).toBe((5 << 8) | (10 << 4) | 12);
  });

  it('a Gate Array ink write feeds the ASIC palette on a Plus', () => {
    const m = makeCPC('plus6128');
    m.bus.out(0x7f00, 0x00);       // select pen 0
    m.bus.out(0x7f00, 0x40 | 26);  // ink 26 = bright yellow
    expect(m.asic!.pal12[0]).toBe(hwTo12(26));
    // pen 0 still tracked classically too
    expect(m.pens[0]).toBe(26);
  });

  it('round-trips through getState / setState', () => {
    const m = makeCPC('gx4000');
    const cpu = makeZ80(m.bus);
    unlock(m);
    m.bus.out(0xdf00, 0xb8);
    m.bus.write(0x4000 + ASIC.SSCR, 0x37);

    const snap = getState(cpu, m);
    expect(snap.asic?.unlocked).toBe(true);

    m.asic!.reset();
    setState(cpu, m, snap);
    expect(m.asic!.unlocked).toBe(true);
    expect(m.asic!.pageIn).toBe(true);
    expect(m.asic!.regs[ASIC.SSCR]).toBe(0x37);
  });
});
