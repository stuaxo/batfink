import { describe, it, expect } from 'vitest';
import { assemble } from '../../src/asm/assembler';
import { makeZ80 } from '../../src/z80/cpu';
import { makeCPC, runFrame } from '../../src/cpc';
import { DEMO_SOURCE } from '../../src/demo';
import { profileFrame } from '../../src/debug/profiler';

function boot(src: string) {
  const r = assemble(src);
  expect(r.errors).toEqual([]);
  const m = makeCPC();
  const cpu = makeZ80(m.bus);
  m.reset();
  m.ram.fill(0);
  for (let a = r.start; a < r.end; a++) m.ram[a] = r.bytes[a];
  cpu.reset();
  cpu.PC = 'START' in r.symbols ? r.symbols['START'] : r.start;
  return { m, cpu, symbols: r.symbols };
}

describe('profileFrame', () => {
  it('measures a full frame and does not move the machine', () => {
    const { m, cpu, symbols } = boot(DEMO_SOURCE);
    for (let f = 0; f < 20; f++) runFrame(cpu, m); // reach steady state (lineCounter at 200)

    const pc = cpu.PC;
    const frames = m.frames;
    const p = profileFrame(cpu, m, symbols);

    expect(cpu.PC).toBe(pc); // snapshot/restore -> no movement
    expect(m.frames).toBe(frames);
    expect(p.total).toBeGreaterThan(70_000);
    expect(p.total).toBeLessThan(90_000);
    expect(p.scanlines).toBeCloseTo(p.total / 256, 5);
  });

  it('attributes cost to the demo routines', () => {
    const { m, cpu, symbols } = boot(DEMO_SOURCE);
    for (let f = 0; f < 20; f++) runFrame(cpu, m);
    const p = profileFrame(cpu, m, symbols);

    const named = p.routines.filter((r) => symbols[r.name] !== undefined);
    expect(named.length).toBeGreaterThan(2);
    // the main loop and interrupt handler should show up
    const names = p.routines.map((r) => r.name);
    expect(names).toContain('IRQ');
    // costs sum to the total
    const sum = p.routines.reduce((a, r) => a + r.tstates, 0);
    expect(sum).toBe(p.total);
    // sorted by cost
    for (let i = 1; i < p.routines.length; i++) {
      expect(p.routines[i - 1].tstates).toBeGreaterThanOrEqual(p.routines[i].tstates);
    }
  });

  it('a tight HALT loop spends the whole frame in one place', () => {
    const { m, cpu, symbols } = boot('      org &4000\nspin: jr spin');
    for (let f = 0; f < 3; f++) runFrame(cpu, m);
    const p = profileFrame(cpu, m, symbols);
    expect(p.routines[0].name).toBe('SPIN');
    expect(p.routines[0].fraction).toBeGreaterThan(0.9);
  });
});
