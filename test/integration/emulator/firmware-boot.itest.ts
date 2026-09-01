// Boots the real CPC 464 firmware with no disc and checks it reaches the BASIC
// `Ready` prompt and takes keyboard input. See plan/rom-boot-findings.md for
// what this spike established.
import { describe, it, expect } from 'vitest';
import { announce } from '../tools';
import { bootFirmware, readScreen, typeText, run, haveRoms } from './cpc-firmware';

describe.skipIf(!announce('firmware-boot', haveRoms, 'src/cpc/roms/cpc464.rom missing'))(
  'CPC 464 firmware boot',
  () => {
    it('reaches the BASIC Ready prompt', () => {
      const fw = bootFirmware();
      const screen = readScreen(fw);
      expect(screen).toContain('Amstrad 64K Microcomputer');
      expect(screen).toContain('BASIC 1.0');
      expect(screen).toContain('Ready');

      expect(fw.cpu.IFF1).toBeTruthy(); // interrupts running
      expect(fw.m.mode).toBe(1);        // firmware selected the text mode

      // Settled: the OS is idling in a small loop, not still initialising.
      const pcs = new Set<number>();
      for (let i = 0; i < 2000; i++) { pcs.add(fw.cpu.PC); fw.cpu.step(); }
      expect(pcs.size).toBeLessThan(80);
    }, 60_000);

    it('takes keyboard input at the prompt', () => {
      const fw = bootFirmware();
      typeText(fw, 'AAA\r');
      run(fw);
      const screen = readScreen(fw);
      expect(screen).toContain('aaa');
      expect(screen).toMatch(/Syntax error/i); // BASIC rejects the line and re-prompts
    }, 60_000);
  },
);
