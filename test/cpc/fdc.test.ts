import { describe, it, expect } from 'vitest';
import { Fdc, Disc } from '../../src/cpc';
import { makeDsk } from '../../src/export';

// A DATA-format .dsk holding a small file, for the drive model to chew on.
function sampleDisc(): { image: Uint8Array; disc: Disc } {
  const payload = new Uint8Array(2000);
  for (let i = 0; i < payload.length; i++) payload[i] = (i * 7) & 0xff;
  const image = makeDsk(payload, { filename: 'PROG.BIN', loadAddr: 0x4000, entryAddr: 0x4000 });
  return { image, disc: new Disc(image) };
}

// --- driving the controller the way AMSDOS does: poll the MSR --------------

function send(fdc: Fdc, ...bytes: number[]): void {
  for (const b of bytes) {
    expect(fdc.readMsr() & 0x80).toBe(0x80); // RQM
    expect(fdc.readMsr() & 0x40).toBe(0);    // DIO: CPU -> FDC
    fdc.writeData(b);
  }
}

function result(fdc: Fdc): number[] {
  const out: number[] = [];
  while (fdc.readMsr() === 0xd0) out.push(fdc.readData());
  return out;
}

function execRead(fdc: Fdc): number[] {
  const out: number[] = [];
  while (fdc.readMsr() === 0xf0) out.push(fdc.readData());
  return out;
}

function execWrite(fdc: Fdc, data: Uint8Array): void {
  for (const b of data) {
    expect(fdc.readMsr()).toBe(0xb0); // RQM | EXM | CB, DIO = 0
    fdc.writeData(b);
  }
}

function mount(): Fdc {
  const fdc = new Fdc();
  fdc.drives[0] = sampleDisc().disc;
  fdc.setMotor(true);
  return fdc;
}

describe('Disc (.dsk reader)', () => {
  it('parses the standard image and lists a track', () => {
    const { disc } = sampleDisc();
    expect(disc.tracks).toBe(40);
    const t0 = disc.sectorList(0);
    expect(t0.map((s) => s.r)).toEqual([0xc1, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9]);
    expect(t0[0].n).toBe(2);
    expect(t0[0].size).toBe(512);
  });

  it('reads a sector and round-trips a write', () => {
    const { disc } = sampleDisc();
    const before = disc.read(5, 0xc3)!;
    expect(before.length).toBe(512);
    const patch = new Uint8Array(512).fill(0x99);
    expect(disc.write(5, 0xc3, patch)).toBe(true);
    expect(Array.from(disc.read(5, 0xc3)!)).toEqual(Array.from(patch));
    expect(disc.write(5, 0xff, patch)).toBe(false); // no such sector
  });

  it('rejects a non-dsk blob', () => {
    expect(() => new Disc(new Uint8Array(200))).toThrow(/not a .dsk/);
  });
});

describe('Fdc', () => {
  it('SPECIFY / RECALIBRATE / SENSE INTERRUPT STATUS', () => {
    const fdc = mount();
    expect(fdc.readMsr()).toBe(0x80);
    send(fdc, 0x03, 0xa1, 0x03); // SPECIFY — no result
    expect(fdc.readMsr()).toBe(0x80);

    send(fdc, 0x07, 0x00); // RECALIBRATE drive 0
    send(fdc, 0x08);       // SENSE INTERRUPT STATUS
    expect(result(fdc)).toEqual([0x20, 0x00]); // ST0 seek-end, PCN 0

    // a second SENSE INT with nothing pending -> invalid
    send(fdc, 0x08);
    expect(result(fdc)).toEqual([0x80]);
  });

  it('SEEK moves the head; READ ID reports the new cylinder', () => {
    const fdc = mount();
    send(fdc, 0x0f, 0x00, 0x05); // SEEK to cylinder 5
    send(fdc, 0x08);
    expect(result(fdc)).toEqual([0x20, 0x05]);

    send(fdc, 0x4a, 0x00); // READ ID (MFM)
    const [st0, st1, st2, c, h, r, n] = result(fdc);
    expect([st0, st1, st2]).toEqual([0, 0, 0]);
    expect(c).toBe(5);
    expect(h).toBe(0);
    expect(r).toBeGreaterThanOrEqual(0xc1);
    expect(n).toBe(2);
  });

  it('READ DATA returns the sector bytes then a clean result', () => {
    const fdc = mount();
    const expected = sampleDisc().disc.read(0, 0xc5)!; // first data sector of PROG.BIN

    send(fdc, 0x66, 0x00, 0x00, 0x00, 0xc5, 0x02, 0xc5, 0x2a, 0xff); // READ DATA MFM|SK
    const data = execRead(fdc);
    expect(data.length).toBe(512);
    expect(data).toEqual(Array.from(expected));

    const [st0, st1, st2, , , r] = result(fdc);
    expect([st0, st1, st2]).toEqual([0, 0, 0]);
    expect(r).toBe(0xc6); // next sector id
    expect(fdc.readMsr()).toBe(0x80);
  });

  it('READ DATA across R..EOT concatenates sectors', () => {
    const fdc = mount();
    send(fdc, 0x66, 0x00, 0x00, 0x00, 0xc1, 0x02, 0xc3, 0x2a, 0xff); // &C1..&C3
    expect(execRead(fdc).length).toBe(512 * 3);
    expect(result(fdc)[0]).toBe(0);
  });

  it('READ DATA on a missing sector ends abnormally with No Data', () => {
    const fdc = mount();
    send(fdc, 0x66, 0x00, 0x00, 0x00, 0xf0, 0x02, 0xf0, 0x2a, 0xff);
    const [st0, st1] = result(fdc);
    expect(st0 & 0xc0).toBe(0x40); // IC = abnormal
    expect(st1 & 0x04).toBe(0x04); // ND
  });

  it('with no disc or motor off, reads fail', () => {
    const fdc = new Fdc();
    fdc.drives[0] = sampleDisc().disc; // but motor off
    send(fdc, 0x4a, 0x00);
    expect(result(fdc)[0] & 0x40).toBe(0x40);
  });

  it('WRITE DATA round-trips through the disc image', () => {
    const fdc = mount();
    const block = new Uint8Array(512);
    for (let i = 0; i < 512; i++) block[i] = (i ^ 0x5a) & 0xff;

    send(fdc, 0x45, 0x00, 0x03, 0x00, 0xc4, 0x02, 0xc4, 0x2a, 0xff); // WRITE DATA to trk 3 sec &C4
    execWrite(fdc, block);
    expect(result(fdc)[0]).toBe(0);

    send(fdc, 0x66, 0x00, 0x03, 0x00, 0xc4, 0x02, 0xc4, 0x2a, 0xff);
    expect(execRead(fdc)).toEqual(Array.from(block));
  });

  it('an unknown command returns an invalid-command status', () => {
    const fdc = mount();
    fdc.writeData(0x1d);
    expect(result(fdc)).toEqual([0x80]);
  });

  it('MSR walks through the phases of a read', () => {
    const fdc = mount();
    expect(fdc.readMsr()).toBe(0x80); // idle
    fdc.writeData(0x66);
    expect(fdc.readMsr()).toBe(0x90); // taking params
    for (const b of [0x00, 0x00, 0x00, 0xc1, 0x02, 0xc1, 0x2a, 0xff]) fdc.writeData(b);
    expect(fdc.readMsr()).toBe(0xf0); // execution, FDC -> CPU
    while (fdc.readMsr() === 0xf0) fdc.readData();
    expect(fdc.readMsr()).toBe(0xd0); // result
    while (fdc.readMsr() === 0xd0) fdc.readData();
    expect(fdc.readMsr()).toBe(0x80); // idle again
  });

  it('snapshot / restore preserves an in-flight result', () => {
    const fdc = mount();
    send(fdc, 0x07, 0x00);
    send(fdc, 0x08);
    const s = fdc.getState();
    const other = new Fdc();
    other.setState(s);
    expect(other.readMsr()).toBe(0xd0);
    expect(result(other)).toEqual([0x20, 0x00]);
  });
});
