import { describe, it, expect } from 'vitest';
import { EXAMPLES } from '../../src/examples';
import { assemble } from '../../src/asm/assembler';
import { makeZ80 } from '../../src/z80/cpu';
import { makeCPC, runFrame, WIDTH, HEIGHT } from '../../src/cpc';

function boot(source: string) {
  const r = assemble(source);
  expect(r.errors).toEqual([]);
  const m = makeCPC();
  const cpu = makeZ80(m.bus);
  m.reset();
  m.ram.fill(0);
  for (let a = r.start; a < r.end; a++) m.ram[a] = r.bytes[a];
  cpu.reset();
  cpu.PC = 'START' in r.symbols ? r.symbols['START'] : r.start;
  return { m, cpu };
}

function distinctColours(m: ReturnType<typeof makeCPC>): number {
  const rgba = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
  m.render(rgba);
  const seen = new Set<number>();
  for (let i = 0; i < rgba.length; i += 4) {
    seen.add((rgba[i] << 16) | (rgba[i + 1] << 8) | rgba[i + 2]);
  }
  return seen.size;
}

describe('example gallery', () => {
  for (const ex of EXAMPLES) {
    it(`${ex.id} assembles and paints something`, () => {
      const { m, cpu } = boot(ex.source);
      for (let f = 0; f < 40; f++) runFrame(cpu, m);
      expect(distinctColours(m)).toBeGreaterThan(1);
    });
  }

  it('keyboard example responds to the arrow keys', () => {
    const { m, cpu } = boot(EXAMPLES.find((e) => e.id === 'keyboard')!.source);
    for (let f = 0; f < 10; f++) runFrame(cpu, m);
    const before = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
    m.render(before);

    const right = m.keyByName('ArrowRight')!;
    m.setKey(right[0], right[1], true);
    for (let f = 0; f < 40; f++) runFrame(cpu, m);
    const after = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
    m.render(after);

    expect(Buffer.from(before).equals(Buffer.from(after))).toBe(false);
  });
});
