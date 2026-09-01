import { describe, it, expect } from 'vitest';
import { assemble } from '../../src/asm/assembler';
import { makeZ80 } from '../../src/z80/cpu';
import { makeCPC, runFrame, WIDTH, HEIGHT, LINES_PER_FRAME, PENS_PER_LINE } from '../../src/cpc';
import { DEMO_SOURCE } from '../../src/demo';

// The demo spends its first ~15 frames clearing 16K of screen RAM with LDIR
// before the main loop gets going, so the integration checks run it a while.
const WARMUP_FRAMES = 30;

function bootDemo() {
  const result = assemble(DEMO_SOURCE);
  expect(result.errors).toEqual([]);
  const m = makeCPC();
  const cpu = makeZ80(m.bus);
  m.reset();
  m.ram.fill(0);
  for (let a = result.start; a < result.end; a++) m.ram[a] = result.bytes[a];
  cpu.reset();
  cpu.PC = result.symbols['START'];
  return { result, m, cpu };
}

describe('demo integration', () => {
  it('the bundled demo assembles cleanly', () => {
    const { result } = bootDemo();
    expect(result.symbols['START']).toBeDefined();
    expect(result.symbols['FONT']).toBeDefined();
  });

  it('runs frames and paints a non-empty picture', () => {
    const { m, cpu } = bootDemo();
    for (let f = 0; f < WARMUP_FRAMES; f++) runFrame(cpu, m);
    expect(m.frames).toBe(WARMUP_FRAMES);

    const rgba = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
    m.render(rgba);
    let lit = 0;
    for (let i = 0; i < rgba.length; i += 4) {
      if (rgba[i] || rgba[i + 1] || rgba[i + 2]) lit++;
    }
    expect(lit).toBeGreaterThan(1000);
  });

  it('paints raster bars: ink 0 changes down the frame', () => {
    const { m, cpu } = bootDemo();
    for (let f = 0; f < WARMUP_FRAMES; f++) runFrame(cpu, m);

    const ink0 = new Set<number>();
    for (let line = 0; line < LINES_PER_FRAME; line++) ink0.add(m.linePens[line * PENS_PER_LINE]);
    // The interrupt handler rewrites ink 0 several times per frame.
    expect(ink0.size).toBeGreaterThan(3);
  });

  it('keeps interrupts enabled once the main loop is running', () => {
    const { m, cpu } = bootDemo();
    for (let f = 0; f < WARMUP_FRAMES; f++) runFrame(cpu, m);
    expect(cpu.IFF1).toBeTruthy();
  });
});
