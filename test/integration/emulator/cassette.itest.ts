// A .cdt built by makeCdt, played into the real firmware's CAS IN routines.
import { describe, it, expect } from 'vitest';
import { assemble } from '../../../src/asm';
import { makeCdt } from '../../../src/export';
import { Tape, readCdt } from '../../../src/cpc';
import { runFrame } from '../../../src/cpc/frame';
import { announce } from '../tools';
import { bootFirmware, readScreen, typeText, haveRoms } from './cpc-firmware';

const PROG = `
org &8000
  ld a,0
  call &bc0e
  jr $
`;

describe.skipIf(!announce('cassette', haveRoms, 'ROMs missing'))('cassette RUN""', () => {
  it('loads and runs a program off a .cdt', () => {
    const asm = assemble(PROG);
    expect(asm.errors).toEqual([]);
    const code = new Uint8Array(asm.bytes.subarray(asm.start, asm.end));
    const cdt = makeCdt(code, { filename: 'GAME', loadAddr: 0x8000, entryAddr: 0x8000 });

    const fw = bootFirmware(200, 'cpc464', false); // tape-only 464
    fw.m.tape = new Tape(readCdt(cdt));
    expect(fw.m.mode).toBe(1);

    typeText(fw, 'RUN""\r');
    // answer "Press PLAY then any key:"
    fw.m.setKey(5, 7, true);
    for (let f = 0; f < 4; f++) runFrame(fw.cpu, fw.m);
    fw.m.setKey(5, 7, false);

    for (let f = 0; f < 900 && fw.m.mode !== 0; f++) runFrame(fw.cpu, fw.m);

    const screen = readScreen(fw).toUpperCase();
    expect(screen).not.toContain('READ ERROR');
    expect(screen).not.toContain('LOAD ERROR');
    expect(Array.from(fw.m.ram.subarray(0x8000, 0x8000 + code.length))).toEqual(Array.from(code));
    expect(fw.m.mode).toBe(0); // the loaded program set mode 0 and is running
  }, 120_000);

  it('a load error surfaces when the tape is blank', () => {
    const fw = bootFirmware(200, 'cpc464', false);
    fw.m.tape = new Tape(new Int32Array(20000).fill(2000)); // steady tone, no data
    typeText(fw, 'RUN""\r');
    fw.m.setKey(5, 7, true);
    for (let f = 0; f < 4; f++) runFrame(fw.cpu, fw.m);
    fw.m.setKey(5, 7, false);
    for (let f = 0; f < 400; f++) runFrame(fw.cpu, fw.m);
    // it must not hang or claim success — either still waiting or an error
    expect(fw.m.mode).toBe(1);
  }, 120_000);
});
