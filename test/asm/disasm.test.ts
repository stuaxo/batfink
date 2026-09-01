import { describe, it, expect } from 'vitest';
import { assemble } from '../../src/asm/assembler';
import { disassemble } from '../../src/asm/disasm';

const dis = (bytes: number[], addr = 0x8000) => disassemble((a) => bytes[a - addr] ?? 0, addr);

describe('disassemble', () => {
  const cases: Array<[number[], string, number]> = [
    [[0x00], 'nop', 1],
    [[0x3e, 0x41], 'ld a,&41', 2],
    [[0x21, 0x34, 0x12], 'ld hl,&1234', 3],
    [[0x7e], 'ld a,(hl)', 1],
    [[0x36, 0xff], 'ld (hl),&FF', 2],
    [[0x87], 'add a,a', 1],
    [[0xc6, 0x10], 'add a,&10', 2],
    [[0xcb, 0x00], 'rlc b', 2],
    [[0xcb, 0x7e], 'bit 7,(hl)', 2],
    [[0xed, 0xb0], 'ldir', 2],
    [[0xed, 0x52], 'sbc hl,de', 2],
    [[0xed, 0x43, 0x00, 0xc0], 'ld (&C000),bc', 4],
    [[0xdd, 0x7e, 0x05], 'ld a,(ix+&05)', 3],
    [[0xfd, 0xcb, 0xff, 0x7e], 'bit 7,(iy-&01)', 4],
    [[0xdd, 0x21, 0x00, 0x40], 'ld ix,&4000', 4],
    [[0xdd, 0xe5], 'push ix', 2],
    [[0xc3, 0x00, 0x40], 'jp &4000', 3],
    [[0x18, 0xfe], 'jr &8000', 2],
    [[0x10, 0x00], 'djnz &8002', 2],
    [[0xc7], 'rst &00', 1],
    [[0xff], 'rst &38', 1],
    [[0xc9], 'ret', 1],
    [[0xd3, 0x7f], 'out (&7F),a', 2],
    [[0x08], "ex af,af'", 1],
  ];

  for (const [bytes, text, len] of cases) {
    it(`${bytes.map((b) => b.toString(16).padStart(2, '0')).join(' ')} -> ${text}`, () => {
      const d = dis(bytes);
      expect(d.text.replace(/\s+/g, ' ').trim()).toBe(text);
      expect(d.length).toBe(len);
      expect(d.bytes).toEqual(bytes);
    });
  }

  it('marks calls and returns for step-over', () => {
    expect(dis([0xcd, 0, 0]).isCall).toBe(true);
    expect(dis([0xc7]).isCall).toBe(true); // rst
    expect(dis([0xc9]).isReturn).toBe(true);
    expect(dis([0xed, 0x4d]).isReturn).toBe(true); // reti
    expect(dis([0x00]).isCall).toBe(false);
  });

  it('resolves branch targets', () => {
    expect(dis([0xc3, 0x00, 0x40]).target).toBe(0x4000);
    expect(dis([0x18, 0x0e], 0x8000).target).toBe(0x8010);
  });

  it('round-trips through the assembler for a code block', () => {
    const src = `
      org &8000
      di
      ld sp,&bff0
      ld bc,&7f00
      ld a,&8d
      out (c),a
      ld hl,&c000
      ld de,&c001
      ld bc,&3fff
      ld (hl),0
      ldir
      ei
    loop:
      call &9000
      jr loop`;
    const asm = assemble(src);
    expect(asm.errors).toEqual([]);

    let addr = asm.start;
    while (addr < asm.end) {
      const d = disassemble((a) => asm.bytes[a], addr);
      const re = assemble(`org &${addr.toString(16)}\n ${d.text}`);
      expect(re.errors, `${d.text}`).toEqual([]);
      expect(Array.from(re.bytes.slice(addr, addr + d.length)), d.text).toEqual(d.bytes);
      addr += d.length;
    }
  });
});
