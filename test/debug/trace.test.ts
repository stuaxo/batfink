import { describe, it, expect } from 'vitest';
import { assemble } from '../../src/asm/assembler';
import { makeZ80 } from '../../src/z80/cpu';
import { makeCPC } from '../../src/cpc';
import { Debugger } from '../../src/debug/debugger';

const PROG = `
      org &4000
start:  ld a,1
        inc a
        inc a
        ld b,a
here:   jr here
`;

function boot() {
  const r = assemble(PROG);
  expect(r.errors).toEqual([]);
  const m = makeCPC();
  const cpu = makeZ80(m.bus);
  m.reset();
  m.ram.fill(0);
  for (let a = r.start; a < r.end; a++) m.ram[a] = r.bytes[a];
  cpu.reset();
  cpu.PC = r.symbols['START'];
  return { cpu, m, dbg: new Debugger(cpu, m), sym: r.symbols };
}

describe('Trace', () => {
  it('records nothing while disabled', () => {
    const { dbg } = boot();
    dbg.step();
    dbg.step();
    expect(dbg.trace.length).toBe(0);
  });

  it('records executed instructions once enabled', () => {
    const { dbg, sym } = boot();
    dbg.trace.enabled = true;
    dbg.step(); // ld a,1
    dbg.step(); // inc a
    dbg.step(); // inc a

    const lines = dbg.traceLines(10); // most recent first
    expect(lines).toHaveLength(3);
    expect(lines[0].pc).toBe(sym['START'] + 3); // the second inc a
    expect(lines[0].a).toBe(3);
    expect(lines[2].pc).toBe(sym['START']); // ld a,1
    expect(lines[2].a).toBe(1);
    expect(lines[0].text.replace(/\s+/g, ' ')).toBe('inc a');
  });

  it('is a ring buffer', () => {
    const { cpu, m } = boot();
    const dbg = new Debugger(cpu, m);
    dbg.trace.enabled = true;
    // the jr $ loop runs forever; one frame is thousands of instructions
    dbg.runFrames(1);
    expect(dbg.trace.length).toBe(1024); // capped
    const recent = dbg.trace.recent(5);
    expect(recent).toHaveLength(5);
  });

  it('clear() empties it', () => {
    const { dbg } = boot();
    dbg.trace.enabled = true;
    dbg.step();
    dbg.trace.clear();
    expect(dbg.trace.length).toBe(0);
  });
});
