import { describe, it, expect } from 'vitest';
import { makeZ80 } from '../../src/z80/cpu';
import type { Bus } from '../../src/z80/bus';

/** A bare 64K RAM bus with recorded port I/O, enough to exercise the core. */
function bareBus() {
  const ram = new Uint8Array(0x10000);
  const outs: Array<[number, number]> = [];
  const ports = new Map<number, number>();
  const bus: Bus = {
    read: (a) => ram[a],
    write: (a, v) => { ram[a] = v & 0xff; },
    in: (p) => ports.get(p & 0xffff) ?? 0xff,
    out: (p, v) => { outs.push([p & 0xffff, v & 0xff]); },
  };
  return { ram, bus, outs, ports };
}

function run(ram: Uint8Array, cpu: ReturnType<typeof makeZ80>, bytes: number[], org = 0) {
  ram.set(bytes, org);
  cpu.reset();
  cpu.PC = org;
  for (let i = 0; i < bytes.length + 4 && cpu.PC < org + bytes.length; i++) cpu.step();
}

describe('Z80 core', () => {
  it('LD then INC', () => {
    const { ram, bus } = bareBus();
    const cpu = makeZ80(bus);
    // LD A,&41 ; INC A
    run(ram, cpu, [0x3e, 0x41, 0x3c]);
    expect(cpu.R[7]).toBe(0x42);
  });

  it('8-bit ADD sets carry and zero', () => {
    const { ram, bus } = bareBus();
    const cpu = makeZ80(bus);
    // LD A,&FF ; ADD A,1
    run(ram, cpu, [0x3e, 0xff, 0xc6, 0x01]);
    expect(cpu.R[7]).toBe(0x00);
    expect(cpu.F & 0x40).toBeTruthy(); // ZF
    expect(cpu.F & 0x01).toBeTruthy(); // CF
  });

  it('LDIR copies a block', () => {
    const { ram, bus } = bareBus();
    const cpu = makeZ80(bus);
    ram.set([1, 2, 3, 4], 0x8000);
    // LD HL,&8000 ; LD DE,&9000 ; LD BC,4 ; LDIR
    run(ram, cpu, [0x21, 0x00, 0x80, 0x11, 0x00, 0x90, 0x01, 0x04, 0x00, 0xed, 0xb0]);
    expect(Array.from(ram.slice(0x9000, 0x9004))).toEqual([1, 2, 3, 4]);
    expect(cpu.getBC()).toBe(0);
  });

  it('OUT (C),r reaches the bus', () => {
    const { ram, bus, outs } = bareBus();
    const cpu = makeZ80(bus);
    // LD BC,&7F10 ; LD A,&54 ; OUT (C),A
    run(ram, cpu, [0x01, 0x10, 0x7f, 0x3e, 0x54, 0xed, 0x79]);
    expect(outs).toContainEqual([0x7f10, 0x54]);
  });

  it('rounds every instruction up to a multiple of 4 T-states', () => {
    const { ram, bus } = bareBus();
    const cpu = makeZ80(bus);
    run(ram, cpu, [0x00]); // NOP is 4
    expect(cpu.tstates % 4).toBe(0);
  });

  it('LD A,R counts both opcode fetches', () => {
    const { ram, bus } = bareBus();
    const cpu = makeZ80(bus);
    ram.set([0xed, 0x5f], 0); // LD A,R
    cpu.reset();
    cpu.Rr = 0x10;
    cpu.step();
    expect(cpu.R[7]).toBe(0x12); // +1 for ED, +1 for 5F
  });

  it('INI derives H/C and P from the transferred byte', () => {
    const { ram, bus, ports } = bareBus();
    const cpu = makeZ80(bus);
    ports.set(0x01ff, 0xff);
    // LD BC,&01FF ; LD HL,&9000 ; INI
    run(ram, cpu, [0x01, 0xff, 0x01, 0x21, 0x00, 0x90, 0xed, 0xa2]);
    expect(ram[0x9000]).toBe(0xff);
    expect(cpu.F & 0x02).toBeTruthy(); // NF: bit 7 of the input
    // k = 0xff + ((0xff + 1) & 0xff) = 0xff -> no carry
    expect(cpu.F & 0x11).toBe(0); // HF | CF clear
  });

  it('BIT n,(IX+d) takes YF/XF from the address high byte', () => {
    const { ram, bus } = bareBus();
    const cpu = makeZ80(bus);
    // LD IX,&2000 ; BIT 0,(IX+&20)  -> address &2020, high byte &20
    run(ram, cpu, [0xdd, 0x21, 0x00, 0x20, 0xdd, 0xcb, 0x20, 0x46]);
    expect(cpu.F & 0x20).toBeTruthy(); // YF from (0x2020 >> 8) = 0x20
    expect(cpu.F & 0x08).toBe(0); // XF clear
  });

  it('interrupt in IM1 pushes PC and jumps to &0038', () => {
    const { ram, bus } = bareBus();
    const cpu = makeZ80(bus);
    run(ram, cpu, [0xfb]); // EI
    cpu.step(); // one more so IFF1 is settled
    const sp = cpu.SP;
    cpu.interrupt();
    expect(cpu.PC).toBe(0x38);
    expect(cpu.SP).toBe((sp - 2) & 0xffff);
  });
});
