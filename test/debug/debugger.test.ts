import { describe, it, expect } from 'vitest';
import { assemble } from '../../src/asm/assembler';
import { makeZ80 } from '../../src/z80/cpu';
import { makeCPC } from '../../src/cpc';
import { Debugger } from '../../src/debug/debugger';

const PROG = `
      org &4000
start:  ld a,1
        call inc2
        ld b,a
here:   jr here
inc2:   inc a
        inc a
        ret
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
  return { cpu, m, sym: r.symbols, dbg: new Debugger(cpu, m) };
}

describe('Debugger', () => {
  it('step advances one instruction', () => {
    const { cpu, dbg } = boot();
    expect(cpu.PC).toBe(0x4000);
    dbg.step();
    expect(cpu.PC).toBe(0x4002); // past LD A,1
    expect(cpu.R[7]).toBe(1);
  });

  it('step enters a call; step-over runs it to completion', () => {
    const a = boot();
    a.dbg.step(); // LD A,1
    a.dbg.step(); // CALL inc2
    expect(a.cpu.PC).toBe(a.sym['INC2']);

    const b = boot();
    b.dbg.step(); // LD A,1
    b.dbg.stepOver(); // CALL inc2 -> returns
    expect(b.cpu.PC).toBe(0x4005); // LD B,A, just after the call
    expect(b.cpu.R[7]).toBe(3); // inc'd twice
  });

  it('runFrames stops and pauses at a breakpoint', () => {
    const { dbg, cpu, sym } = boot();
    dbg.toggleBreakpoint(sym['INC2']);
    dbg.runFrames(2);
    expect(dbg.isPaused()).toBe(true);
    expect(cpu.PC).toBe(sym['INC2']);
  });

  it('resume steps past the breakpoint it stopped on', () => {
    const { dbg, cpu, sym } = boot();
    dbg.toggleBreakpoint(sym['INC2']);
    dbg.runFrames(2);
    dbg.resume();
    expect(dbg.isPaused()).toBe(false);
    expect(cpu.PC).not.toBe(sym['INC2']);
  });

  it('resume does not advance when the PC is not on a breakpoint', () => {
    const { dbg, cpu } = boot();
    dbg.step(); // LD A,1 -> PC 0x4002, no breakpoint here
    const pc = cpu.PC;
    dbg.resume();
    expect(cpu.PC).toBe(pc);
    expect(dbg.isPaused()).toBe(false);
  });

  it('toggleBreakpoint adds then removes', () => {
    const { dbg } = boot();
    expect(dbg.toggleBreakpoint(0x4002)).toBe(true);
    expect(dbg.breakpoints.has(0x4002)).toBe(true);
    expect(dbg.toggleBreakpoint(0x4002)).toBe(false);
    expect(dbg.breakpoints.has(0x4002)).toBe(false);
  });

  it('registers() reports pairs and flag bits', () => {
    const { dbg } = boot();
    dbg.step(); // LD A,1 -> A=1
    const r = dbg.registers();
    expect(r.pc).toBe(0x4002);
    expect(r.af >> 8).toBe(1);
    expect(r.flags.z).toBe(false);
  });

  it('runToCursor stops the machine at the requested address', () => {
    const { dbg, cpu } = boot();
    dbg.runToCursor(0x4005); // LD B,A
    expect(dbg.isPaused()).toBe(true);
    expect(cpu.PC).toBe(0x4005);
  });

  it('readMemory returns a wrapping copy', () => {
    const { dbg, m } = boot();
    m.ram[0x4000] = 0x11;
    const mem = dbg.readMemory(0x4000, 4);
    expect(mem[0]).toBe(0x11);
    mem[0] = 0x99;
    expect(m.ram[0x4000]).toBe(0x11); // copy, not a view
    expect(dbg.readMemory(0xffff, 2).length).toBe(2); // wraps
  });

  it('disassembleFrom decodes a run of instructions', () => {
    const { dbg } = boot();
    const rows = dbg.disassembleFrom(0x4000, 3);
    expect(rows.map((x) => x.addr)).toEqual([0x4000, 0x4002, 0x4005]);
    expect(rows[0].text.replace(/\s+/g, ' ')).toBe('ld a,&01');
    expect(rows[1].isCall).toBe(true);
  });
});
