// The real FDC (src/cpc/fdc.ts) behind AMSDOS: mount a .dsk we built ourselves
// and check `CAT` reads the directory back. The Tier-C disc check without MAME.
import { describe, it, expect } from 'vitest';
import { Disc } from '../../../src/cpc';
import { makeDsk } from '../../../src/export';
import { announce } from '../tools';
import { bootFirmware, readScreen, typeText, run, haveRoms } from './cpc-firmware';

describe.skipIf(!announce('fdc-amsdos', haveRoms, 'ROMs missing'))('AMSDOS + FDC', () => {
  it('CAT lists a file on a mounted disc', () => {
    const payload = new Uint8Array(3000).fill(0x2a);
    const image = makeDsk(payload, { filename: 'HELLO.BIN', loadAddr: 0x8000, entryAddr: 0x8000 });

    const fw = bootFirmware();
    fw.m.fdc.drives[0] = new Disc(image);

    typeText(fw, 'CAT\r');
    run(fw, 400);

    const screen = readScreen(fw).toUpperCase();
    expect(screen).toContain('HELLO   .BIN'); // the catalogued filename
    expect(screen).toMatch(/\bDRIVE A: USER  0\b/);
    expect(screen).toMatch(/\d+K FREE/);
    expect(screen).not.toContain('READ FAIL');
    expect(screen).not.toContain('RETRY, IGNORE OR CANCEL');
  }, 60_000);

  it('RUN" loads and executes a binary off the disc', () => {
    // org &8000: ld a,0 : call &BC0E (SCR SET MODE) : jr $  — takes over like a demo
    const prog = new Uint8Array([0x3e, 0x00, 0xcd, 0x0e, 0xbc, 0x18, 0xfe]);
    const image = makeDsk(prog, { filename: 'GO.BIN', loadAddr: 0x8000, entryAddr: 0x8000 });

    const fw = bootFirmware();
    expect(fw.m.mode).toBe(1); // firmware default
    fw.m.fdc.drives[0] = new Disc(image);

    typeText(fw, 'RUN"GO\r');
    run(fw, 400);

    expect(fw.m.mode).toBe(0); // the program loaded off disc and ran
    expect(readScreen(fw).toUpperCase()).not.toContain('FAIL');
  }, 60_000);
});
