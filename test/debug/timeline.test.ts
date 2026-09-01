import { describe, it, expect } from 'vitest';
import { assemble } from '../../src/asm/assembler';
import { makeZ80 } from '../../src/z80/cpu';
import { makeCPC, runFrame, WIDTH, HEIGHT } from '../../src/cpc';
import { Timeline } from '../../src/debug/timeline';
import { EXAMPLES } from '../../src/examples';

const scroller = EXAMPLES.find((e) => e.id === 'scroller')!.source; // visibly changes each frame

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
  return { m, cpu };
}

const paint = (m: ReturnType<typeof makeCPC>) => {
  const b = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
  m.render(b);
  return Buffer.from(b);
};

/** Drive the machine like the app: run a frame, then let the timeline record. */
function runLive(m: ReturnType<typeof makeCPC>, cpu: ReturnType<typeof makeZ80>, tl: Timeline, frames: number) {
  for (let i = 0; i < frames; i++) {
    runFrame(cpu, m);
    tl.record();
  }
}

describe('Timeline', () => {
  it('seeks back to an exact past frame', () => {
    const { m, cpu } = boot(scroller);
    const tl = new Timeline(cpu, m, { interval: 5 });
    runLive(m, cpu, tl, 40);

    const frame40 = paint(m);
    // capture what frame 18 looked like, the honest way
    const ref = boot(scroller);
    for (let i = 0; i < 18; i++) runFrame(ref.cpu, ref.m);
    const frame18 = paint(ref.m);

    tl.seek(18);
    expect(m.frames).toBe(18);
    expect(paint(m).equals(frame18)).toBe(true);
    expect(paint(m).equals(frame40)).toBe(false);

    tl.goLive();
    expect(m.frames).toBe(40);
    expect(paint(m).equals(frame40)).toBe(true);
  });

  it('clamps to the recorded window', () => {
    const { m, cpu } = boot(scroller);
    const tl = new Timeline(cpu, m, { interval: 5 });
    runLive(m, cpu, tl, 20);
    tl.seek(999);
    expect(m.frames).toBe(20);
    tl.seek(-5);
    expect(m.frames).toBe(tl.earliest);
  });

  it('resumeHere keeps the past point and drops the future', () => {
    const { m, cpu } = boot(scroller);
    const tl = new Timeline(cpu, m, { interval: 5 });
    runLive(m, cpu, tl, 30);

    tl.seek(12);
    tl.resumeHere();
    expect(tl.reviewing).toBe(false);
    expect(m.frames).toBe(12);
    expect(tl.latest).toBe(12);

    runLive(m, cpu, tl, 5);
    expect(m.frames).toBe(17);
    tl.seek(20); // future is gone -> clamps to new head
    expect(m.frames).toBe(17);
  });

  it('replays recorded key input', () => {
    const { m, cpu } = boot(EXAMPLES.find((e) => e.id === 'keyboard')!.source);
    const tl = new Timeline(cpu, m, { interval: 3 });
    const right = m.keyByName('ArrowRight')!;

    runLive(m, cpu, tl, 5);
    m.setKey(right[0], right[1], true);
    tl.recordKey(right[0], right[1], true);
    runLive(m, cpu, tl, 20);
    m.setKey(right[0], right[1], false);
    tl.recordKey(right[0], right[1], false);
    runLive(m, cpu, tl, 10);
    const moved = paint(m);

    tl.seek(8); // after the key went down
    const early = paint(m);
    tl.seek(34);
    expect(paint(m).equals(moved)).toBe(true); // key replay reproduced the motion
    expect(paint(m).equals(early)).toBe(false);
  });
});
