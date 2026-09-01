// Boots the real CPC 464 firmware with no disc and checks it reaches the BASIC
// `Ready` prompt and takes keyboard input. See plan/rom-boot-findings.md for
// what this spike established.
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { makeZ80, type Z80 } from '../../../src/z80/cpu';
import { makeCPC, type CPCMachine } from '../../../src/cpc';
import { installFirmware } from '../../../src/cpc/roms';
import { runFrame } from '../../../src/cpc/frame';
import { announce } from '../tools';

const romPath = fileURLToPath(new URL('../../../src/cpc/roms/cpc464.rom', import.meta.url));
const amsdosPath = fileURLToPath(new URL('../../../src/cpc/roms/amsdos.rom', import.meta.url));

// Recover the 40x25 text screen (mode 1, base &C000) by matching each 8x8 cell
// against the firmware font in the lower ROM (&3800, one 8-byte glyph per code).
function readScreen(ram: Uint8Array, lowerRom: Uint8Array): string {
  const glyphs = new Map<string, number>();
  for (let ch = 32; ch < 127; ch++) {
    const rows = Array.from({ length: 8 }, (_, r) => lowerRom[0x3800 + ch * 8 + r]);
    glyphs.set(rows.join(','), ch);
  }
  const lines: string[] = [];
  for (let cy = 0; cy < 25; cy++) {
    let line = '';
    for (let cx = 0; cx < 40; cx++) {
      const rows: number[] = [];
      for (let ly = 0; ly < 8; ly++) {
        const addr = 0xc000 + ly * 0x800 + cy * 80 + cx * 2;
        let bits = 0;
        for (const b of [ram[addr], ram[addr + 1]]) {
          for (let p = 0; p < 4; p++) bits = (bits << 1) | (((b >> (7 - p)) & 1) | ((b >> (3 - p)) & 1));
        }
        rows.push(bits);
      }
      const ch = glyphs.get(rows.join(','));
      line += ch === undefined ? ' ' : String.fromCharCode(ch);
    }
    lines.push(line.replace(/\s+$/, ''));
  }
  return lines.join('\n').replace(/\n+$/, '');
}

function bootFirmware() {
  const rom = new Uint8Array(readFileSync(romPath));
  const amsdos = existsSync(amsdosPath) ? new Uint8Array(readFileSync(amsdosPath)) : undefined;
  const m = makeCPC();
  const cpu = makeZ80(m.bus);
  m.reset();
  installFirmware(m, rom, { amsdos });
  cpu.reset();
  cpu.PC = 0x0000;
  return { m, cpu, lowerRom: rom.subarray(0, 0x4000) };
}

function hold(cpu: Z80, m: CPCMachine, line: number, bit: number, downFrames = 6, upFrames = 6): void {
  m.setKey(line, bit, true);
  for (let f = 0; f < downFrames; f++) runFrame(cpu, m);
  m.setKey(line, bit, false);
  for (let f = 0; f < upFrames; f++) runFrame(cpu, m);
}

describe.skipIf(!announce('firmware-boot', existsSync(romPath), 'src/cpc/roms/cpc464.rom missing'))(
  'CPC 464 firmware boot',
  () => {
    it('reaches the BASIC Ready prompt', () => {
      const { m, cpu, lowerRom } = bootFirmware();
      for (let f = 0; f < 200; f++) runFrame(cpu, m);

      const screen = readScreen(m.ram, lowerRom);
      expect(screen).toContain('Amstrad 64K Microcomputer');
      expect(screen).toContain('BASIC 1.0');
      expect(screen).toContain('Ready');

      expect(cpu.IFF1).toBeTruthy(); // interrupts running
      expect(m.mode).toBe(1); // firmware selected the text mode

      // Settled: the OS is idling in a small loop, not still initialising.
      const pcs = new Set<number>();
      for (let i = 0; i < 2000; i++) { pcs.add(cpu.PC); cpu.step(); }
      expect(pcs.size).toBeLessThan(80);
    }, 60_000);

    it('takes keyboard input at the prompt', () => {
      const { m, cpu, lowerRom } = bootFirmware();
      for (let f = 0; f < 200; f++) runFrame(cpu, m);

      for (let i = 0; i < 3; i++) hold(cpu, m, 8, 5); // KeyA
      hold(cpu, m, 2, 2); // Enter

      const screen = readScreen(m.ram, lowerRom);
      expect(screen).toContain('aaa');
      // BASIC rejects "aaa" as a line: it should say so and re-prompt.
      expect(screen).toMatch(/Syntax error/i);
    }, 60_000);
  },
);
