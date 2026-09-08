// Loading firmware ROM images into a machine. DOM-free and bundler-free: the
// caller supplies the bytes (src/ui fetches them, tests read them from disk).
import type { CPCMachine } from './machine';
import { updateRomPaging } from './rom';

/** Split the 32K `cpc464.rom` into its lower (OS) and upper (BASIC) halves. */
export function splitFirmware(rom: Uint8Array): { lower: Uint8Array; upper: Uint8Array } {
  if (rom.length !== 0x8000) {
    throw new Error(`firmware ROM must be 32768 bytes, got ${rom.length}`);
  }
  return { lower: rom.subarray(0, 0x4000), upper: rom.subarray(0x4000, 0x8000) };
}

export interface FirmwareOptions {
  /** 16K AMSDOS ROM, mapped as upper ROM 7. */
  amsdos?: Uint8Array;
}

/** Install the firmware and set the machine to its power-on ROM configuration:
 *  lower and upper ROM both enabled, so a CPU reset to &0000 runs the OS. */
export function installFirmware(m: CPCMachine, rom: Uint8Array, opts: FirmwareOptions = {}): void {
  const { lower, upper } = splitFirmware(rom);
  m.cart = null; // masked firmware and a cartridge are mutually exclusive
  m.roms.lower = lower;
  m.roms.upper[0] = upper;
  if (opts.amsdos) {
    if (opts.amsdos.length !== 0x4000) {
      throw new Error(`AMSDOS ROM must be 16384 bytes, got ${opts.amsdos.length}`);
    }
    m.roms.upper[7] = opts.amsdos;
  }
  m.gaConfig = 0x00; // power-on: mode 0, both ROMs enabled
  updateRomPaging(m);
}

/** Install a Plus / GX4000 cartridge: its 16K blocks serve the ROM windows,
 *  block 0 runs from the reset vector. Clears any masked firmware ROMs. */
export function installCartridge(m: CPCMachine, pages: Uint8Array[]): void {
  m.cart = pages;
  m.roms.lower = null;
  m.roms.upper.length = 0;
  m.gaConfig = 0x00; // power-on: mode 0, both ROM windows enabled
  m.romSelect = 0;
  updateRomPaging(m);
}

/** Remove all ROMs and cartridge and return to the bare-metal configuration. */
export function removeFirmware(m: CPCMachine): void {
  m.roms.lower = null;
  m.roms.upper.length = 0;
  m.cart = null;
  m.gaConfig = 0x8d;
  updateRomPaging(m);
}
