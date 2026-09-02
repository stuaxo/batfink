// Shared helpers for the firmware integration tests: boot the real ROMs, read
// the text screen back, and type at the BASIC prompt through the key matrix.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { makeZ80, type Z80 } from '../../../src/z80/cpu';
import { makeCPC, type CPCMachine, setExtRam } from '../../../src/cpc';
import { installFirmware } from '../../../src/cpc/roms';
import { runFrame } from '../../../src/cpc/frame';

const romsDir = fileURLToPath(new URL('../../../src/cpc/roms/', import.meta.url));
export const romPath = romsDir + 'cpc464.rom';
const amsdosPath = romsDir + 'amsdos.rom';

export const haveRoms = existsSync(romPath);

export type Kind = 'cpc464' | 'cpc6128';

export interface Firmware {
  m: CPCMachine;
  cpu: Z80;
  lowerRom: Uint8Array;
}

/** Boot to the BASIC `Ready` prompt (~200 frames). */
export function bootFirmware(frames = 200, kind: Kind = 'cpc464'): Firmware {
  const rom = new Uint8Array(readFileSync(romsDir + kind + '.rom'));
  const amsdos = existsSync(amsdosPath) ? new Uint8Array(readFileSync(amsdosPath)) : undefined;
  const m = makeCPC();
  const cpu = makeZ80(m.bus);
  m.reset();
  setExtRam(m, kind === 'cpc6128');
  installFirmware(m, rom, { amsdos });
  cpu.reset();
  cpu.PC = 0x0000;
  for (let f = 0; f < frames; f++) runFrame(cpu, m);
  return { m, cpu, lowerRom: rom.subarray(0, 0x4000) };
}

/** Recover the 40x25 text screen (mode 1, base &C000) by matching each 8x8 cell
 *  against the firmware font in the lower ROM (&3800, one 8-byte glyph per code). */
export function readScreen({ m, lowerRom }: Firmware): string {
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
        for (const b of [m.ram[addr], m.ram[addr + 1]]) {
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

// ASCII -> [matrix line, bit, needs Shift]. CapsLock is on at boot, so letters
// are unshifted. Covers what the BASIC test programs need.
const KEY: Record<string, [number, number, boolean]> = {
  ' ': [5, 7, false], '\r': [2, 2, false],
  '0': [4, 0, false], '1': [8, 0, false], '2': [8, 1, false], '3': [7, 1, false],
  '4': [7, 0, false], '5': [6, 1, false], '6': [6, 0, false], '7': [5, 1, false],
  '8': [5, 0, false], '9': [4, 1, false],
  '"': [8, 1, true], '!': [8, 0, true], '#': [7, 1, true],
  '(': [5, 0, true], ')': [4, 1, true],
  ';': [3, 4, false], '+': [3, 4, true], ':': [3, 5, false], '*': [3, 5, true],
  ',': [4, 7, false], '<': [4, 7, true], '.': [3, 7, false], '>': [3, 7, true],
  '/': [3, 6, false], '?': [3, 6, true], '-': [3, 1, false], '=': [3, 1, true],
};
for (const [ch, pos] of Object.entries({
  A: [8, 5], B: [6, 6], C: [7, 6], D: [7, 5], E: [7, 2], F: [6, 5], G: [6, 4],
  H: [5, 4], I: [4, 3], J: [5, 5], K: [4, 5], L: [4, 4], M: [4, 6], N: [5, 6],
  O: [4, 2], P: [3, 3], Q: [8, 3], R: [6, 2], S: [7, 4], T: [6, 3], U: [5, 2],
  V: [6, 7], W: [7, 3], X: [7, 7], Y: [5, 3], Z: [8, 7],
} as Record<string, [number, number]>)) {
  KEY[ch] = [pos[0], pos[1], false];
}

const SHIFT: [number, number] = [2, 5];

/** Type a string at the prompt, one key at a time, letting the KM scan see each
 *  press. `\r` is Enter. Unknown characters are skipped. */
export function typeText({ cpu, m }: Firmware, text: string, holdFrames = 3, gapFrames = 3): void {
  for (const ch of text.toUpperCase()) {
    const k = KEY[ch];
    if (!k) continue;
    const [line, bit, shift] = k;
    if (shift) m.setKey(SHIFT[0], SHIFT[1], true);
    m.setKey(line, bit, true);
    for (let f = 0; f < holdFrames; f++) runFrame(cpu, m);
    m.setKey(line, bit, false);
    if (shift) m.setKey(SHIFT[0], SHIFT[1], false);
    for (let f = 0; f < gapFrames; f++) runFrame(cpu, m);
  }
}

export function run(fw: Firmware, extraFrames = 60): void {
  for (let f = 0; f < extraFrames; f++) runFrame(fw.cpu, fw.m);
}
