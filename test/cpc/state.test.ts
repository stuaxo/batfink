import { describe, it, expect } from 'vitest';
import { assemble } from '../../src/asm/assembler';
import { makeZ80 } from '../../src/z80/cpu';
import { makeCPC, runFrame, runUntil, getState, setState, WIDTH, HEIGHT } from '../../src/cpc';
import { DEMO_SOURCE } from '../../src/demo';

function boot() {
  const r = assemble(DEMO_SOURCE);
  const m = makeCPC();
  const cpu = makeZ80(m.bus);
  m.reset();
  m.ram.fill(0);
  for (let a = r.start; a < r.end; a++) m.ram[a] = r.bytes[a];
  cpu.reset();
  cpu.PC = r.symbols['START'];
  return { m, cpu };
}

const paint = (m: ReturnType<typeof makeCPC>) => {
  const rgba = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
  m.render(rgba);
  return Buffer.from(rgba);
};

describe('getState / setState', () => {
  it('round-trips a running machine exactly', () => {
    const { m, cpu } = boot();
    for (let f = 0; f < 20; f++) runFrame(cpu, m);

    const snap = getState(cpu, m);
    const at20 = paint(m);
    const pc20 = cpu.PC;

    for (let f = 0; f < 15; f++) runFrame(cpu, m);
    expect(paint(m).equals(at20)).toBe(false); // it moved on

    setState(cpu, m, snap);
    expect(cpu.PC).toBe(pc20);
    expect(paint(m).equals(at20)).toBe(true);

    // and it keeps running deterministically from the restored point
    const a = boot();
    for (let f = 0; f < 35; f++) runFrame(a.cpu, a.m);
    for (let f = 0; f < 15; f++) runFrame(cpu, m);
    expect(paint(m).equals(paint(a.m))).toBe(true);
  });

  it('returns independent copies', () => {
    const { m, cpu } = boot();
    runFrame(cpu, m);
    const snap = getState(cpu, m);
    snap.ram[0x4000] ^= 0xff;
    snap.cpu.pc = 0;
    expect(m.ram[0x4000]).not.toBe(snap.ram[0x4000]);
    expect(cpu.PC).not.toBe(0);
  });

  it('setState writes into the arrays the CPU captured, not new ones', () => {
    const { m, cpu } = boot();
    const ram = m.ram;
    const R = cpu.R;
    for (let f = 0; f < 5; f++) runFrame(cpu, m);
    setState(cpu, m, getState(cpu, m));
    expect(m.ram).toBe(ram);
    expect(cpu.R).toBe(R);
  });
});

describe('runUntil', () => {
  it('stops after maxSteps', () => {
    const { m, cpu } = boot();
    const reason = runUntil(cpu, m, { maxSteps: 100 });
    expect(reason).toBe('steps');
  });

  it('stops at a breakpoint before executing it', () => {
    const { m, cpu } = boot();
    runFrame(cpu, m); // let the demo settle into its loop
    const target = cpu.PC;
    // step off it, then run back to it
    runUntil(cpu, m, { maxSteps: 1 });
    const reason = runUntil(cpu, m, { breakpoints: new Set([target]), maxSteps: 500_000 });
    expect(reason).toBe('breakpoint');
    expect(cpu.PC).toBe(target);
  });

  it('runFrame still advances the frame counter and paints a picture', () => {
    const { m, cpu } = boot();
    for (let f = 0; f < 30; f++) runFrame(cpu, m);
    expect(m.frames).toBe(30);
    const rgba = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
    m.render(rgba);
    let lit = 0;
    for (let i = 0; i < rgba.length; i += 4) if (rgba[i] || rgba[i + 1] || rgba[i + 2]) lit++;
    expect(lit).toBeGreaterThan(1000);
  });
});
