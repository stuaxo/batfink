// Standard "MV - CPCEMU" .DSK image, AMSDOS DATA format: 40 tracks, one side,
// 9 x 512-byte sectors (IDs &C1-&C9), 0x1300 bytes per track. Writes one file
// into the CP/M directory and the data blocks from block 2 on.
import { withAmsdosHeader, hasAmsdosHeader, amsdosName, type AmsdosMeta } from './amsdos';

const TRACKS = 40;
const SECTORS = 9;
const SECTOR_SIZE = 512;
const TRACK_SIZE = 256 + SECTORS * SECTOR_SIZE; // 0x1300
const IMAGE_SIZE = 256 + TRACKS * TRACK_SIZE; // 194,816
const BLOCK_SIZE = 1024;
const DIR_BLOCKS = 2; // blocks 0-1: 64 directory entries
const FILLER = 0xe5;

const ascii = (s: string, into: Uint8Array, at: number) => {
  for (let i = 0; i < s.length; i++) into[at + i] = s.charCodeAt(i) & 0xff;
};

/** Byte offset in the image of 512-byte logical sector `lsn` (0-based, whole disc). */
function sectorOffset(lsn: number): number {
  const track = Math.floor(lsn / SECTORS);
  const inTrack = lsn % SECTORS;
  return 256 + track * TRACK_SIZE + 256 + inTrack * SECTOR_SIZE;
}

/** A .DSK holding `data` as `meta.filename`. An AMSDOS header is added if absent. */
export function makeDsk(data: Uint8Array, meta: AmsdosMeta): Uint8Array {
  const file = hasAmsdosHeader(data) ? data : withAmsdosHeader(data, meta);

  const img = new Uint8Array(IMAGE_SIZE).fill(FILLER);
  img.fill(0, 0, 256); // Disc Information Block is zero-padded

  // Disc Information Block
  ascii('MV - CPCEMU Disk-File\r\nDisk-Info\r\n', img, 0);
  img.fill(0x20, 0x22, 0x30);
  ascii('batfink', img, 0x22);
  img[0x30] = TRACKS;
  img[0x31] = 1;
  img[0x32] = TRACK_SIZE & 0xff;
  img[0x33] = (TRACK_SIZE >> 8) & 0xff;

  // Track Information Blocks
  for (let t = 0; t < TRACKS; t++) {
    const tib = 256 + t * TRACK_SIZE;
    img.fill(0, tib, tib + 256);
    ascii('Track-Info\r\n', img, tib);
    img[tib + 0x10] = t;
    img[tib + 0x11] = 0;
    img[tib + 0x14] = 2; // sector size code: 128 << 2 = 512
    img[tib + 0x15] = SECTORS;
    img[tib + 0x16] = 0x4e; // GAP#3
    img[tib + 0x17] = FILLER;
    for (let s = 0; s < SECTORS; s++) {
      const sil = tib + 0x18 + s * 8;
      img[sil + 0] = t;
      img[sil + 1] = 0;
      img[sil + 2] = 0xc1 + s;
      img[sil + 3] = 2;
      img[sil + 6] = SECTOR_SIZE & 0xff;
      img[sil + 7] = (SECTOR_SIZE >> 8) & 0xff;
    }
  }

  // Data blocks, from block 2 on
  const numBlocks = Math.ceil(file.length / BLOCK_SIZE);
  const blocks: number[] = [];
  for (let i = 0; i < numBlocks; i++) blocks.push(DIR_BLOCKS + i);
  if (DIR_BLOCKS + numBlocks > 180) throw new Error('file too big for a DATA disc');

  for (let i = 0; i < numBlocks; i++) {
    const block = blocks[i];
    const src = file.subarray(i * BLOCK_SIZE, (i + 1) * BLOCK_SIZE);
    for (let half = 0; half < 2; half++) {
      const off = sectorOffset(block * 2 + half);
      img.set(src.subarray(half * SECTOR_SIZE, half * SECTOR_SIZE + SECTOR_SIZE), off);
    }
  }

  // Directory: one entry per 16-block extent
  const { name, ext } = amsdosName(meta.filename);
  const totalRecords = Math.ceil(file.length / 128);
  const numExtents = Math.max(1, Math.ceil(numBlocks / 16));
  const dirStart = sectorOffset(0); // block 0 -> logical sector 0
  for (let e = 0; e < numExtents; e++) {
    const entry = dirStart + e * 32;
    img[entry] = 0; // user 0
    img.set(name, entry + 1);
    img.set(ext, entry + 9);
    img[entry + 12] = e & 0x1f;
    img[entry + 13] = 0;
    img[entry + 14] = (e >> 5) & 0x3f;
    img[entry + 15] = Math.min(128, totalRecords - e * 128);
    const al = blocks.slice(e * 16, e * 16 + 16);
    for (let i = 0; i < 16; i++) img[entry + 16 + i] = al[i] ?? 0;
  }

  return img;
}

export const DSK_IMAGE_SIZE = IMAGE_SIZE;
