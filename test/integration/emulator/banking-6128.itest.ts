// 128K banking under the real 6128 firmware: a machine-code routine (run from
// bank 2, which no config we use remaps) switches bank 1 / bank 4 into &4000
// and proves each keeps its own bytes.
import { describe, it, expect } from 'vitest';
import { assemble } from '../../../src/asm';
import { announce } from '../tools';
import { bootFirmware, typeText, run, haveRoms } from './cpc-firmware';

const ROUTINE = `
org &8000
  ld bc,&7fc4
  out (c),c
  ld a,&5a
  ld (&4000),a
  ld bc,&7fc0
  out (c),c
  ld a,&a5
  ld (&4000),a
  ld a,(&4000)
  ld (&9000),a
  ld bc,&7fc4
  out (c),c
  ld a,(&4000)
  ld (&9001),a
  ld bc,&7fc0
  out (c),c
  ret
`;

describe.skipIf(!announce('banking-6128', haveRoms, 'ROMs missing'))('6128 128K banking', () => {
  it('bank 1 and bank 4 hold independent bytes at &4000', () => {
    const asm = assemble(ROUTINE);
    expect(asm.errors).toEqual([]);

    const fw = bootFirmware(200, 'cpc6128');
    for (let a = asm.start; a < asm.end; a++) fw.m.ram[a] = asm.bytes[a];

    typeText(fw, 'CALL &8000\r');
    run(fw, 40);

    expect(fw.m.ram[0x9000]).toBe(0xa5); // bank 1 kept its write
    expect(fw.m.ram[0x9001]).toBe(0x5a); // bank 4 kept its earlier write
  }, 60_000);
});
