// The 6128 firmware boots on the same model as the 464 — no RAM banking needed
// for the base 64K. This guards that "Firmware (6128)" keeps working.
import { describe, it, expect } from 'vitest';
import { announce } from '../tools';
import { bootFirmware, readScreen, typeText, run, haveRoms } from './cpc-firmware';

describe.skipIf(!announce('boot-6128', haveRoms, 'ROMs missing'))('CPC 6128 firmware', () => {
  it('boots to the BASIC 1.1 Ready prompt', () => {
    const fw = bootFirmware(200, 'cpc6128');
    const screen = readScreen(fw);
    expect(screen).toContain('Amstrad 128K Microcomputer');
    expect(screen).toContain('BASIC 1.1');
    expect(screen).toContain('Ready');
    expect(fw.cpu.IFF1).toBeTruthy();
    expect(fw.m.mode).toBe(1);
  }, 60_000);

  it('runs a BASIC 1.1 program', () => {
    const fw = bootFirmware(200, 'cpc6128');
    typeText(fw, '10 PRINT "ON A 6128"\r');
    typeText(fw, 'RUN\r');
    run(fw, 60);
    expect(readScreen(fw).toLowerCase()).toContain('on a 6128');
  }, 60_000);
});
