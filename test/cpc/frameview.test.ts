import { describe, it, expect } from 'vitest';
import { assemble } from '../../src/asm/assembler';
import { makeZ80 } from '../../src/z80/cpu';
import { makeCPC, runFrame, frameView, renderView, WIDTH, HEIGHT } from '../../src/cpc';
import { DEMO_SOURCE } from '../../src/demo';

function bootDemo() {
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

describe('frameView', () => {
  it('exposes the machine arrays by reference', () => {
    const m = makeCPC();
    const v = frameView(m);
    expect(v.ram).toBe(m.ram);
    expect(v.crtc).toBe(m.crtc);
    expect(v.linePens).toBe(m.linePens);
    expect(v.mode).toBe(m.mode);
  });

  it('renderView(frameView(m)) matches m.render', () => {
    const { m, cpu } = bootDemo();
    for (let f = 0; f < 25; f++) runFrame(cpu, m);

    const a = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
    const b = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
    m.render(a);
    renderView(frameView(m), b);
    expect(Buffer.from(b).equals(Buffer.from(a))).toBe(true);
  });
});
