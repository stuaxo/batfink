// Amstrad CPC 464 hardware model (RAM-only: firmware ROMs are not emulated).
// This file owns the machine state and its lifecycle; the I/O decode lives in
// ./ports and the pixel output in ./video.
import type { Bus } from '../z80/bus';
import type { AudioSink } from './audio';
import { keyByName } from './keyboard';
import { LINES_PER_FRAME, PENS_PER_LINE, CRTC_DEFAULTS } from './constants';
import { makeBus } from './ports';
import { renderFrame } from './video';
import { type RomSet, emptyRomSet, updateRomPaging } from './rom';
import { setRamConfig } from './banking';
import { Fdc } from './fdc';
import type { Tape } from './tape';

/** Hardware colour 20 in CPC_PALETTE is black; the machine powers up all-black. */
const BLACK = 20;

export interface CPCMachine {
  ram: Uint8Array;
  /** pens 0-15, plus the border at index 16. Values are 0x00-0x1F. */
  pens: Uint8Array;
  crtc: Uint8Array;
  /** key matrix, one byte per line; a low bit means "pressed". */
  keys: Uint8Array;
  /** per-scanline palette snapshot (LINES_PER_FRAME * PENS_PER_LINE bytes). */
  linePens: Uint8Array;
  mode: number;
  penSelect: number;
  crtcSelect: number;
  kbdLine: number;
  vsync: boolean;
  gaConfig: number;
  ramConfig: number;
  romSelect: number;
  /** 8 x 16K RAM banks; non-null only with the second 64K on (6128). */
  banks: Uint8Array | null;
  /** physical bank (0-7) mirrored in each 16K slot of `ram`. */
  bankAt: Int8Array;
  /** true on a 6128 with 128K — RAM-config writes then re-page `ram`. */
  ram128: boolean;
  /** ROM images. Fixed hardware, not machine state; empty until a ROM PR. */
  roms: RomSet;
  /** ROM currently visible at &0000-&3FFF, or null for RAM. Derived from
   *  gaConfig/romSelect by updateRomPaging; never snapshotted. */
  romLow: Uint8Array | null;
  /** ROM currently visible at &C000-&FFFF, or null for RAM. */
  romHigh: Uint8Array | null;
  /** Floppy controller (DDI-1). Idle and inert until a disc program pokes it. */
  fdc: Fdc;
  /** Mounted cassette, or null. Feeds PPI port B bit 7 while its motor is on. */
  tape: Tape | null;
  ppiA: number;
  ppiB: number;
  ppiC: number;
  ppiControl: number;
  psgSelect: number;
  psg: Uint8Array;
  frameCycles: number;
  lineCounter: number;
  interruptCounter: number;
  frames: number;
  /** set by runFrame when the raster passes RENDER_LINE. */
  frameReady: boolean;
  bus: Bus;
  /** Optional hook, called after every RAM write. Null in run mode. */
  onWrite: ((addr: number, value: number) => void) | null;
  /** Optional hook, called after every PSG register write. Null when silent. */
  psgWrite: ((reg: number, value: number) => void) | null;
  /** Sound output sink. Null when sound is off. */
  audio: AudioSink | null;
  setKey(line: number, bit: number, down: boolean): void;
  keyByName(name: string): [number, number] | null;
  /** Reset everything except RAM to power-on state. */
  reset(): void;
  /** Render the current frame into an RGBA buffer, borders included. */
  render(rgba: Uint8ClampedArray): void;
}

export function makeCPC(): CPCMachine {
  const m = {
    ram: new Uint8Array(0x10000),
    pens: new Uint8Array(PENS_PER_LINE),
    crtc: new Uint8Array(32),
    keys: new Uint8Array(10),
    // Palette snapshot per scanline, so mid-frame ink changes (raster bars)
    // actually show up in the rendered picture.
    linePens: new Uint8Array(LINES_PER_FRAME * PENS_PER_LINE),
    psg: new Uint8Array(16),
    mode: 1,
    penSelect: 0,
    crtcSelect: 0,
    kbdLine: 0,
    vsync: false,
    gaConfig: 0x8d,
    ramConfig: 0,
    romSelect: 0,
    ppiA: 0,
    ppiB: 0,
    ppiC: 0,
    ppiControl: 0x82,
    psgSelect: 0,
    frameCycles: 0,
    lineCounter: 0,
    interruptCounter: 0,
    frames: 0,
    frameReady: false,
    onWrite: null,
    psgWrite: null,
    audio: null,
    roms: emptyRomSet(),
    romLow: null,
    romHigh: null,
    banks: null,
    bankAt: Int8Array.from([0, 1, 2, 3]),
    ram128: false,
    fdc: new Fdc(),
    tape: null,
  } as CPCMachine;

  m.bus = makeBus(m);
  m.keyByName = keyByName;
  m.setKey = (line, bit, down) => {
    if (down) m.keys[line] &= ~(1 << bit);
    else m.keys[line] |= (1 << bit);
  };
  m.render = (rgba) => renderFrame(m, rgba);
  m.reset = () => {
    m.mode = 1; m.penSelect = 0; m.crtcSelect = 0; m.kbdLine = 0;
    m.vsync = false; m.frameReady = false;
    m.frameCycles = 0; m.lineCounter = 0; m.interruptCounter = 0; m.frames = 0;
    m.gaConfig = 0x8d; m.romSelect = 0;
    setRamConfig(m, 0); // config 0: banks 0-3 visible (no-op without 128K)
    m.ppiA = 0; m.ppiB = 0; m.ppiC = 0; m.ppiControl = 0x82;
    m.psgSelect = 0; m.psg.fill(0);
    m.fdc.reset();
    if (m.tape) m.tape.motorOn = false;
    updateRomPaging(m);
    m.pens.fill(BLACK);
    m.linePens.fill(BLACK);
    m.keys.fill(0xff);
    m.crtc.set(CRTC_DEFAULTS);
  };

  m.reset();
  return m;
}
