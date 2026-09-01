// .CDT tape image (TZX container). One firmware-format file: a header record and
// a data record per 2K block, each an "0x11" turbo data block. Timings, CRC and
// record layout follow 2cdt (Kevin Thacker); playback is not verified in-repo.
import { hasAmsdosHeader, amsdosName, type AmsdosMeta } from './amsdos';

const CHUNK = 256;
const BLOCK = 2048;
const SYNC_HEADER = 0x2c;
const SYNC_DATA = 0x16;
const PILOT_PULSES = 4096;
const PAUSE_HEADER_MS = 10;
const PAUSE_DATA_MS = 2500;

const TZX_T_STATES = 3500000;
const CPC_T_STATES = 19968 * 50 * 4;

/** CRC-16/CCITT (poly 0x1021, init 0xFFFF), one byte. */
function crcByte(crc: number, byte: number): number {
  let aux = (crc ^ (byte << 8)) & 0xffff;
  for (let i = 0; i < 8; i++) {
    aux = aux & 0x8000 ? ((aux << 1) ^ 0x1021) & 0xffff : (aux << 1) & 0xffff;
  }
  return aux;
}

/** ZERO and ONE bit pulse lengths in TZX T-states for a given baud rate. */
function pulseLengths(baud: number): { zero: number; one: number } {
  const conv = Math.floor((TZX_T_STATES << 8) / (CPC_T_STATES >> 8)) >> 8;
  const zero = ((Math.floor(333333 / baud) << 2) * conv) >> 8;
  return { zero, one: zero << 1 };
}

/** One TZX 0x11 block wrapping a tape record: sync byte, 256-byte CRC'd chunks, trailer. */
function turboBlock(sync: number, data: Uint8Array, pauseMs: number, baud: number): number[] {
  const chunks = Math.max(1, Math.ceil(data.length / CHUNK));
  const body: number[] = [sync];
  for (let c = 0; c < chunks; c++) {
    let crc = 0xffff;
    for (let i = 0; i < CHUNK; i++) {
      const b = data[c * CHUNK + i] ?? 0;
      body.push(b);
      crc = crcByte(crc, b);
    }
    body.push((crc >> 8) ^ 0xff, crc ^ 0xff);
  }
  for (let i = 0; i < 8; i++) body.push(0xff); // trailer

  const { zero, one } = pulseLengths(baud);
  const w = (v: number) => [v & 0xff, (v >> 8) & 0xff];
  const header = [
    ...w(one), ...w(zero), ...w(zero), ...w(zero), ...w(one),
    ...w(PILOT_PULSES),
    8, // used bits in last byte
    ...w(pauseMs),
    body.length & 0xff, (body.length >> 8) & 0xff, (body.length >> 16) & 0xff,
  ];
  return [0x11, ...header, ...body];
}

export interface CdtMeta extends AmsdosMeta {
  /** 1000-2000; the firmware default is 2000. */
  baud?: number;
}

/** A .CDT holding `data` as `meta.filename`. `data` may carry an AMSDOS header. */
export function makeCdt(data: Uint8Array, meta: CdtMeta): Uint8Array {
  const baud = meta.baud ?? 2000;
  let payload = data;
  let type = meta.type ?? 2;
  let load = meta.loadAddr;
  let entry = meta.entryAddr ?? meta.loadAddr;
  if (hasAmsdosHeader(data)) {
    type = data[18];
    load = data[21] | (data[22] << 8);
    entry = data[26] | (data[27] << 8);
    payload = data.subarray(128);
  }

  const { name, ext } = amsdosName(meta.filename);
  const tapeName = new Uint8Array(16);
  tapeName.set(name.subarray(0, 8), 0);
  tapeName.set(ext.subarray(0, 3), 8);

  const bytes: number[] = [0x5a, 0x58, 0x54, 0x61, 0x70, 0x65, 0x21, 0x1a, 1, 20]; // "ZXTape!\x1a" 1.20
  const numBlocks = Math.max(1, Math.ceil(payload.length / BLOCK));
  let location = load;
  for (let b = 0; b < numBlocks; b++) {
    const slice = payload.subarray(b * BLOCK, (b + 1) * BLOCK);
    const rec = new Uint8Array(64);
    rec.set(tapeName, 0);
    rec[16] = b + 1;
    rec[17] = b === numBlocks - 1 ? 0xff : 0; // last block
    rec[18] = type;
    rec[19] = slice.length & 0xff; rec[20] = (slice.length >> 8) & 0xff;
    rec[21] = location & 0xff; rec[22] = (location >> 8) & 0xff;
    rec[23] = b === 0 ? 0xff : 0; // first block
    rec[24] = payload.length & 0xff; rec[25] = (payload.length >> 8) & 0xff;
    rec[26] = entry & 0xff; rec[27] = (entry >> 8) & 0xff;

    bytes.push(...turboBlock(SYNC_HEADER, rec, PAUSE_HEADER_MS, baud));
    bytes.push(...turboBlock(SYNC_DATA, slice, PAUSE_DATA_MS, baud));
    location += slice.length;
  }
  return new Uint8Array(bytes);
}
