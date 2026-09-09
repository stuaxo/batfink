import { describe, it, expect } from 'vitest';
import { assemble } from '../../../src/asm/assembler';
import { makeZ80 } from '../../../src/z80/cpu';
import { makeCPC, runFrame, renderView, frameView, WIDTH, HEIGHT, ASIC, ASIC_UNLOCK } from '../../../src/cpc';
import { renderViewGL } from '../../../src/ui/gl/pixel';
import { EXAMPLES } from '../../../src/examples';
import { DEMO_SOURCE } from '../../../src/demo';

function run(source: string, frames: number) {
  const r = assemble(source);
  expect(r.errors).toEqual([]);
  const m = makeCPC();
  const cpu = makeZ80(m.bus);
  m.reset();
  m.ram.fill(0);
  for (let a = r.start; a < r.end; a++) m.ram[a] = r.bytes[a];
  cpu.reset();
  cpu.PC = r.symbols['START'] ?? r.start;
  for (let f = 0; f < frames; f++) runFrame(cpu, m);
  return m;
}

const firstDiff = (a: Uint8ClampedArray, b: Uint8ClampedArray) => {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return i;
  return -1;
};

describe('renderViewGL matches the software renderer', () => {
  const cases = [{ id: 'demo', source: DEMO_SOURCE }, ...EXAMPLES.map((e) => ({ id: e.id, source: e.source }))];

  for (const c of cases) {
    it(c.id, () => {
      const m = run(c.source, 60);
      m.paletteWriteCount = 0; // GL path is per-scanline; drop the mid-line refinement

      const soft = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
      const gl = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
      renderView(frameView(m), soft);
      renderViewGL(frameView(m), gl);

      const d = firstDiff(soft, gl);
      if (d >= 0) {
        const px = (d / 4) | 0;
        throw new Error(`differ at pixel ${px} (x=${px % WIDTH}, y=${(px / WIDTH) | 0}): soft ${soft[d]} vs gl ${gl[d]}`);
      }
      expect(d).toBe(-1);
    });
  }

  it('matches on the Plus 12-bit palette path', () => {
    const r = assemble(EXAMPLES.find((e) => e.id === 'mode1')!.source);
    const m = makeCPC('plus6128');
    const cpu = makeZ80(m.bus);
    m.reset();
    m.ram.fill(0);
    for (let a = r.start; a < r.end; a++) m.ram[a] = r.bytes[a];
    cpu.reset();
    cpu.PC = r.symbols['START'] ?? r.start;

    // unlock the ASIC and write a 12-bit palette straight to its registers
    for (const b of ASIC_UNLOCK) m.bus.out(0xbc00, b);
    m.bus.out(0xdf00, 0xb8);
    for (let e = 0; e < 17; e++) {
      m.bus.write(0x4000 + ASIC.PALETTE + e * 2, ((e * 5) & 0x0f) | (((e * 3) & 0x0f) << 4));
      m.bus.write(0x4000 + ASIC.PALETTE + e * 2 + 1, (e * 7) & 0x0f);
    }
    m.bus.out(0xdf00, 0x00); // page the registers back out so the program runs

    for (let f = 0; f < 40; f++) runFrame(cpu, m);
    m.paletteWriteCount = 0;

    const soft = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
    const gl = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
    renderView(frameView(m), soft);
    renderViewGL(frameView(m), gl);
    expect(firstDiff(soft, gl)).toBe(-1);
    // and it is actually exercising 12-bit colour, not the 27-table
    expect(frameView(m).linePal12).not.toBeNull();
  });

  it('ignores mid-line pen writes (that is the software renderer\'s job)', () => {
    const m = run(DEMO_SOURCE, 60);
    expect(m.paletteWriteCount).toBeGreaterThan(0);
    const withWrites = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
    renderViewGL(frameView(m), withWrites);
    m.paletteWriteCount = 0;
    const without = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
    renderViewGL(frameView(m), without);
    expect(firstDiff(withWrites, without)).toBe(-1);
  });
});
