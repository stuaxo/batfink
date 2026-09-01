import { describe, it, expect } from 'vitest';
import { assemble } from '../../src/asm/assembler';

const bytesOf = (src: string) => {
  const r = assemble(src);
  expect(r.errors).toEqual([]);
  return Array.from(r.bytes.slice(r.start, r.end));
};

describe('assembler', () => {
  it('assembles a basic instruction stream', () => {
    expect(bytesOf('  org 0\n  ld a,&41\n  inc a\n  ret')).toEqual([0x3e, 0x41, 0x3c, 0xc9]);
  });

  it('accepts hex, binary, 0x and decimal number forms', () => {
    expect(bytesOf('  db &FF, %1010, 0x0F, 16')).toEqual([0xff, 0x0a, 0x0f, 16]);
  });

  it('resolves forward label references across the two passes', () => {
    const r = assemble('  org &4000\nstart:\n  jp target\ntarget:\n  ret');
    expect(r.errors).toEqual([]);
    expect(r.symbols['TARGET']).toBe(0x4003);
    expect(Array.from(r.bytes.slice(0x4000, 0x4003))).toEqual([0xc3, 0x03, 0x40]);
  });

  it('honours EQU and $ in expressions', () => {
    // $ is the live emit pointer, so by the time `ld de,$` is evaluated the
    // opcode byte has been emitted and $ == 0x104.
    const r = assemble('SCREEN equ &C000\n  org &100\n  ld hl,SCREEN\n  ld de,$-2');
    expect(r.errors).toEqual([]);
    expect(Array.from(r.bytes.slice(0x100, 0x106))).toEqual([0x21, 0x00, 0xc0, 0x11, 0x02, 0x01]);
  });

  it('encodes CB, ED and IX-prefixed instructions', () => {
    expect(bytesOf('  rlc b')).toEqual([0xcb, 0x00]);
    expect(bytesOf('  ldir')).toEqual([0xed, 0xb0]);
    expect(bytesOf('  ld a,(ix+5)')).toEqual([0xdd, 0x7e, 0x05]);
    expect(bytesOf('  bit 7,(iy-1)')).toEqual([0xfd, 0xcb, 0xff, 0x7e]);
  });

  it('emits strings and DS fills', () => {
    expect(bytesOf('  db "AB",0')).toEqual([0x41, 0x42, 0x00]);
    expect(bytesOf('  ds 3,&EE')).toEqual([0xee, 0xee, 0xee]);
  });

  it('reports errors with line numbers instead of throwing', () => {
    const r = assemble('  ld a,&41\n  frobnicate\n  ret');
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0].line).toBe(2);
    expect(r.errors[0].message).toMatch(/unknown instruction/i);
  });

  it('flags a byte value that does not fit', () => {
    const r = assemble('  db 999');
    expect(r.errors[0].message).toMatch(/does not fit/i);
  });
});
