// Drives BASIC 1.0 through the key matrix and checks the common paths a
// playground user hits: PRINT, entering and RUNning a program, INK/BORDER,
// SOUND, and CALLing assembled code. See plan/rom-boot-findings.md.
import { describe, it, expect } from 'vitest';
import { announce } from '../tools';
import { bootFirmware, readScreen, typeText, run, haveRoms } from './cpc-firmware';

describe.skipIf(!announce('basic-shakedown', haveRoms, 'src/cpc/roms/cpc464.rom missing'))(
  'BASIC 1.0 shakedown',
  () => {
    it('PRINT echoes a string and evaluates an expression', () => {
      const fw = bootFirmware();
      typeText(fw, 'PRINT "HELLO WORLD"\r');
      run(fw);
      typeText(fw, 'PRINT 2+2\r');
      run(fw);
      const screen = readScreen(fw);
      expect(screen.toLowerCase()).toContain('hello world');
      expect(screen).toMatch(/\n\s*4\s*\n/); // 4 on its own line
      expect(screen.toLowerCase()).not.toContain('syntax error');
    });

    it('runs an entered program with a GOTO loop', () => {
      const fw = bootFirmware();
      typeText(fw, '10 PRINT "HI";\r');
      typeText(fw, '20 GOTO 10\r');
      typeText(fw, 'RUN\r');
      run(fw, 120);
      const screen = readScreen(fw).toLowerCase();
      expect((screen.match(/hi/g) ?? []).length).toBeGreaterThan(100);
    });

    it('INK and BORDER change the palette', () => {
      const fw = bootFirmware();
      const before = Array.from(fw.m.pens);
      typeText(fw, 'BORDER 26\r');
      typeText(fw, 'INK 0,26\r');
      run(fw);
      expect(readScreen(fw).toLowerCase()).not.toContain('syntax error');
      expect(fw.m.pens[16]).not.toBe(before[16]); // border
      expect(fw.m.pens[0]).not.toBe(before[0]);   // pen 0
    });

    it('SOUND programs the PSG through the firmware', () => {
      const fw = bootFirmware();
      const writes: Array<[number, number]> = [];
      fw.m.psgWrite = (r, v) => writes.push([r, v]);
      typeText(fw, 'SOUND 1,200,100,7\r');
      run(fw, 30);
      const reg = (n: number) => writes.filter(([r]) => r === n).map(([, v]) => v);
      expect(reg(0)).toContain(200);                       // tone period low
      expect(reg(8).some((v) => v > 0)).toBe(true);        // channel A volume
      expect(reg(7).some((v) => (v & 0x01) === 0)).toBe(true); // mixer enables tone A
    });

    it('CALLs assembled code poked into RAM', () => {
      const fw = bootFirmware();
      // org &8000: ld a,&AA : ld (&8050),a : ret
      fw.m.ram.set([0x3e, 0xaa, 0x32, 0x50, 0x80, 0xc9], 0x8000);
      typeText(fw, 'CALL &8000\r');
      run(fw);
      expect(fw.m.ram[0x8050]).toBe(0xaa);
      expect(readScreen(fw).toLowerCase()).not.toContain('syntax error');
    });
  },
);
