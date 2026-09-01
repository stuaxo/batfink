import { describe, it, expect } from 'vitest';
import {
  withAmsdosHeader, hasAmsdosHeader, amsdosChecksum, amsdosName,
  makeDsk, DSK_IMAGE_SIZE, makeCdt,
} from '../../src/export';

const code = new Uint8Array(300).map((_, i) => i & 0xff);

describe('AMSDOS header', () => {
  it('prepends 128 bytes with a valid checksum', () => {
    const out = withAmsdosHeader(code, { filename: 'demo.bin', loadAddr: 0x4000, entryAddr: 0x4000 });
    expect(out.length).toBe(128 + code.length);
    expect(hasAmsdosHeader(out)).toBe(true);
    const stored = out[67] | (out[68] << 8);
    expect(stored).toBe(amsdosChecksum(out.subarray(0, 128)));
  });

  it('records type, load and entry address and length', () => {
    const out = withAmsdosHeader(code, { filename: 'demo.bin', loadAddr: 0x1234, entryAddr: 0x5678 });
    expect(out[18]).toBe(2);
    expect(out[21] | (out[22] << 8)).toBe(0x1234);
    expect(out[26] | (out[27] << 8)).toBe(0x5678);
    expect(out[64] | (out[65] << 8) | (out[66] << 16)).toBe(code.length);
  });

  it('splits the filename into 8 + 3, space padded and upper case', () => {
    const { name, ext } = amsdosName('raster.asm');
    expect(String.fromCharCode(...name)).toBe('RASTER  ');
    expect(String.fromCharCode(...ext)).toBe('ASM');
  });

  it('rejects a buffer with no header', () => {
    expect(hasAmsdosHeader(code)).toBe(false);
    expect(hasAmsdosHeader(new Uint8Array(128))).toBe(false);
  });
});

describe('DSK', () => {
  const dsk = makeDsk(code, { filename: 'demo.bin', loadAddr: 0x4000 });

  it('is a standard 40-track DATA image', () => {
    expect(dsk.length).toBe(DSK_IMAGE_SIZE);
    expect(String.fromCharCode(...dsk.subarray(0, 8))).toBe('MV - CPC');
    expect(dsk[0x30]).toBe(40); // tracks
    expect(dsk[0x31]).toBe(1); // sides
    expect(dsk[0x32] | (dsk[0x33] << 8)).toBe(0x1300); // track size
  });

  it('lays out track information blocks with 9 x 512 sectors &C1-&C9', () => {
    const tib = 256; // track 0
    expect(String.fromCharCode(...dsk.subarray(tib, tib + 10))).toBe('Track-Info');
    expect(dsk[tib + 0x15]).toBe(9);
    for (let s = 0; s < 9; s++) expect(dsk[tib + 0x18 + s * 8 + 2]).toBe(0xc1 + s);
  });

  it('writes a directory entry and the file data from block 2', () => {
    const dirOff = 256 + 256; // track 0, sector &C1
    expect(dsk[dirOff]).toBe(0); // user 0
    expect(String.fromCharCode(...dsk.subarray(dirOff + 1, dirOff + 9))).toBe('DEMO    ');
    expect(dsk[dirOff + 16]).toBe(2); // first block pointer
    const withHeader = withAmsdosHeader(code, { filename: 'demo.bin', loadAddr: 0x4000 });
    const total = withHeader.length;
    expect(dsk[dirOff + 15]).toBe(Math.ceil(total / 128)); // record count
    // block 2 -> logical sector 4 -> track 0, sector index 4
    const blockOff = 256 + 256 + 4 * 512;
    expect(Array.from(dsk.subarray(blockOff, blockOff + 128)))
      .toEqual(Array.from(withHeader.subarray(0, 128)));
  });

  it('does not double up an existing AMSDOS header', () => {
    const pre = withAmsdosHeader(code, { filename: 'demo.bin', loadAddr: 0x4000 });
    const a = makeDsk(pre, { filename: 'demo.bin', loadAddr: 0x4000 });
    const b = makeDsk(code, { filename: 'demo.bin', loadAddr: 0x4000 });
    expect(Array.from(a)).toEqual(Array.from(b));
  });
});

describe('CDT', () => {
  const cdt = makeCdt(code, { filename: 'demo.bin', loadAddr: 0x4000, entryAddr: 0x4000 });

  it('starts with a TZX signature', () => {
    expect(String.fromCharCode(...cdt.subarray(0, 7))).toBe('ZXTape!');
    expect(cdt[7]).toBe(0x1a);
    expect(cdt[8]).toBe(1);
  });

  it('emits a header block then a data block, both id 0x11', () => {
    let pos = 10;
    expect(cdt[pos]).toBe(0x11);
    const len1 = cdt[pos + 16] | (cdt[pos + 17] << 8) | (cdt[pos + 18] << 16);
    // header record: sync + one 256-byte chunk + 2 CRC + 8 trailer
    expect(len1).toBe(1 + 258 + 8);
    pos += 1 + 18 + len1;
    expect(cdt[pos]).toBe(0x11);
    const len2 = cdt[pos + 16] | (cdt[pos + 17] << 8) | (cdt[pos + 18] << 16);
    // data record: 300 bytes -> 2 chunks
    expect(len2).toBe(1 + 258 * 2 + 8);
  });

  it('puts the filename, type and addresses in the header record', () => {
    const body = 10 + 1 + 18 + 1; // past block id, 0x11 header, sync byte
    expect(String.fromCharCode(...cdt.subarray(body, body + 4))).toBe('DEMO');
    expect(cdt[body + 18]).toBe(2); // file type
    expect(cdt[body + 21] | (cdt[body + 22] << 8)).toBe(0x4000); // load address
    expect(cdt[body + 23]).toBe(0xff); // first block
  });
});
