// A minimal µPD765A floppy controller — enough for AMSDOS to read (and write)
// a standard `.dsk` image. No weak sectors, copy protection or real timing; the
// CPC's FDC INT/DRQ lines are not wired, so this is pure MSR polling. See
// plan/fdc.md for the command reference and the traced AMSDOS sequence.

const N_SECTOR = (n: number) => 128 << (n & 7);

// --- .dsk image reader ------------------------------------------------------

interface SectorInfo {
  c: number; h: number; r: number; n: number;
  offset: number; size: number;
}

/** A standard ("MV - CPCEMU") or Extended `.dsk` image, indexed by track. */
export class Disc {
  readonly image: Uint8Array;
  readonly tracks: number;
  readonly sides: number;
  writeProtected = false;
  private readonly trackAt: SectorInfo[][] = [];

  constructor(image: Uint8Array) {
    this.image = image;
    const tag = String.fromCharCode(...image.subarray(0, 8));
    const extended = tag.startsWith('EXTENDED');
    if (!extended && !tag.startsWith('MV - CPC')) {
      throw new Error('not a .dsk image');
    }
    this.tracks = image[0x30];
    this.sides = image[0x31] || 1;

    // Track offsets: fixed size for standard, a per-track table at 0x34 for
    // Extended (each byte is the track length in 256-byte units).
    const stdSize = image[0x32] | (image[0x33] << 8);
    const count = this.tracks * this.sides;
    let offset = 256;
    for (let i = 0; i < count; i++) {
      const len = extended ? image[0x34 + i] * 256 : stdSize;
      if (len === 0) { this.trackAt.push([]); continue; }
      this.trackAt.push(this.parseTrack(offset));
      offset += len;
    }
  }

  private parseTrack(tib: number): SectorInfo[] {
    const image = this.image;
    if (String.fromCharCode(...image.subarray(tib, tib + 10)) !== 'Track-Info') return [];
    const sectors = image[tib + 0x15];
    const list: SectorInfo[] = [];
    let dataAt = tib + 256;
    for (let s = 0; s < sectors; s++) {
      const sil = tib + 0x18 + s * 8;
      const n = image[sil + 3];
      const declared = image[sil + 6] | (image[sil + 7] << 8); // Extended: real size
      const size = declared || N_SECTOR(n);
      list.push({ c: image[sil], h: image[sil + 1], r: image[sil + 2], n, offset: dataAt, size });
      dataAt += size;
    }
    return list;
  }

  sectorList(track: number): ReadonlyArray<Readonly<SectorInfo>> {
    return this.trackAt[track] ?? [];
  }

  read(track: number, sectorId: number): Uint8Array | null {
    const s = this.sectorList(track).find((x) => x.r === sectorId);
    return s ? this.image.subarray(s.offset, s.offset + s.size) : null;
  }

  write(track: number, sectorId: number, data: Uint8Array): boolean {
    const s = this.sectorList(track).find((x) => x.r === sectorId);
    if (!s) return false;
    this.image.set(data.subarray(0, s.size), s.offset);
    return true;
  }
}

// --- the controller -------------------------------------------------------

// Main Status Register, by phase.
const MSR_IDLE = 0x80;        // RQM
const MSR_RECV = 0x90;        // RQM | CB          — taking a command / params
const MSR_EXEC_READ = 0xf0;   // RQM | DIO | EXM | CB
const MSR_EXEC_WRITE = 0xb0;  // RQM | EXM | CB
const MSR_RESULT = 0xd0;      // RQM | DIO | CB

const PARAM_COUNT: Record<number, number> = {
  0x03: 2, 0x04: 1, 0x05: 8, 0x06: 8, 0x07: 1, 0x08: 0,
  0x0a: 1, 0x0d: 5, 0x0f: 2, 0x11: 8,
};

type Phase = 'idle' | 'recv' | 'exec-read' | 'exec-write' | 'result';

export interface FdcState {
  phase: Phase;
  cmd: number;
  params: number[];
  result: number[];
  buffer: number[];
  bufPos: number;
  writeTargets: Array<[number, number]>;
  pendingResult: number[];
  formatFill: number;
  motorOn: boolean;
  pcn: number;
  drive: number;
  intPending: boolean;
  idIndex: number;
}

export class Fdc {
  drives: (Disc | null)[] = [null, null];
  private phase: Phase = 'idle';
  private cmd = 0;
  private params: number[] = [];
  private need = 0;
  private result: number[] = [];
  private buffer: Uint8Array = new Uint8Array(0);
  private bufPos = 0;
  private writeTargets: Array<[track: number, sectorId: number]> = [];
  private pendingResult: number[] = []; // the 7 result bytes, once the data moves
  private formatFill = 0xe5;
  private motorOn = false;
  private pcn = 0;      // present cylinder (drive 0; single-drive model)
  private drive = 0;    // unit of the command in progress
  private intPending = false;
  private idIndex = 0;

  reset(): void {
    this.phase = 'idle';
    this.params = [];
    this.result = [];
    this.buffer = new Uint8Array(0);
    this.bufPos = 0;
    this.writeTargets = [];
    this.pendingResult = [];
    this.motorOn = false;
    this.pcn = 0;
    this.drive = 0;
    this.intPending = false;
    this.idIndex = 0;
  }

  setMotor(on: boolean): void { this.motorOn = on; }

  readMsr(): number {
    switch (this.phase) {
      case 'idle': return MSR_IDLE;
      case 'recv': return MSR_RECV;
      case 'exec-read': return MSR_EXEC_READ;
      case 'exec-write': return MSR_EXEC_WRITE;
      case 'result': return MSR_RESULT;
    }
  }

  readData(): number {
    if (this.phase === 'result') {
      const b = this.result.shift() ?? 0;
      if (this.result.length === 0) this.phase = 'idle';
      return b;
    }
    if (this.phase === 'exec-read') {
      const b = this.buffer[this.bufPos++] ?? 0;
      if (this.bufPos >= this.buffer.length) this.finishRead();
      return b;
    }
    return 0xff;
  }

  writeData(v: number): void {
    if (this.phase === 'idle') {
      this.cmd = v;
      this.params = [];
      this.need = PARAM_COUNT[v & 0x1f] ?? -1;
      if (this.need < 0) { this.result = [0x80]; this.phase = 'result'; return; } // invalid
      this.phase = this.need === 0 ? 'idle' : 'recv';
      if (this.need === 0) this.execute();
      return;
    }
    if (this.phase === 'recv') {
      this.params.push(v);
      if (this.params.length >= this.need) this.execute();
      return;
    }
    if (this.phase === 'exec-write') {
      this.buffer[this.bufPos++] = v & 0xff;
      if (this.bufPos >= this.buffer.length) {
        if ((this.cmd & 0x1f) === 0x0d) this.finishFormat();
        else this.finishWrite();
      }
    }
  }

  // --- command dispatch ---------------------------------------------------

  private execute(): void {
    const base = this.cmd & 0x1f;
    const p = this.params;
    switch (base) {
      case 0x03: // SPECIFY — timing parameters, ignored
        this.phase = 'idle';
        return;
      case 0x07: // RECALIBRATE
        this.drive = p[0] & 3;
        this.pcn = 0;
        this.intPending = true;
        this.phase = 'idle';
        return;
      case 0x0f: // SEEK
        this.drive = p[0] & 3;
        this.pcn = p[1];
        this.intPending = true;
        this.phase = 'idle';
        return;
      case 0x08: // SENSE INTERRUPT STATUS
        this.result = this.intPending ? [0x20 | this.drive, this.pcn] : [0x80];
        this.intPending = false;
        this.phase = 'result';
        return;
      case 0x04: { // SENSE DRIVE STATUS
        const us = p[0] & 3;
        const hd = (p[0] >> 2) & 1;
        const disc = this.drives[us];
        let st3 = us | (hd << 2) | 0x20; // RY
        if (this.pcn === 0) st3 |= 0x10; // T0
        if (disc?.writeProtected) st3 |= 0x40; // WP
        this.result = [st3];
        this.phase = 'result';
        return;
      }
      case 0x0a: { // READ ID
        const us = p[0] & 3;
        const hd = (p[0] >> 2) & 1;
        const list = this.usableDisc(us)?.sectorList(this.pcn);
        if (!list || list.length === 0) {
          this.result = [0x40 | us | (hd << 2), 0x01, 0, this.pcn, hd, 1, 2]; // MA
        } else {
          const s = list[this.idIndex++ % list.length];
          this.result = [us | (hd << 2), 0, 0, s.c, s.h, s.r, s.n];
        }
        this.phase = 'result';
        return;
      }
      case 0x06: this.startRead(); return;   // READ DATA
      case 0x05: this.startWrite(); return;  // WRITE DATA
      case 0x0d: this.startFormat(); return; // FORMAT TRACK
      default:
        this.result = [0x80];
        this.phase = 'result';
    }
  }

  private usableDisc(us: number): Disc | null {
    return this.motorOn ? this.drives[us] ?? null : null;
  }

  private readParams() {
    const p = this.params;
    return {
      us: p[0] & 3, hd: (p[0] >> 2) & 1,
      c: p[1], h: p[2], r: p[3], n: p[4], eot: p[5],
    };
  }

  private startRead(): void {
    const { us, hd, r, n, eot } = this.readParams();
    this.drive = us;
    const disc = this.usableDisc(us);
    if (!disc) { this.abnormal(us, hd, 0x04); return; } // ND

    const chunks: Uint8Array[] = [];
    let last = r;
    for (let id = r; id <= (eot || r); id++) {
      const data = disc.read(this.pcn, id);
      if (!data) { if (id === r) { this.abnormal(us, hd, 0x04); return; } break; }
      chunks.push(data);
      last = id;
    }
    this.buffer = concat(chunks);
    this.bufPos = 0;
    this.pendingResult = [us | (hd << 2), 0, 0, this.pcn, hd, last + 1, n];
    this.phase = 'exec-read';
  }

  private finishRead(): void {
    this.result = this.pendingResult;
    this.phase = 'result';
  }

  private startWrite(): void {
    const { us, hd, r, n, eot } = this.readParams();
    this.drive = us;
    const disc = this.usableDisc(us);
    if (!disc) { this.abnormal(us, hd, 0x04); return; }
    if (disc.writeProtected) { this.abnormal(us, hd, 0x02); return; } // NW

    const list = disc.sectorList(this.pcn);
    let total = 0;
    this.writeTargets = [];
    for (let id = r; id <= (eot || r); id++) {
      const s = list.find((x) => x.r === id);
      if (!s) break;
      total += s.size;
      this.writeTargets.push([this.pcn, id]);
    }
    if (total === 0) { this.abnormal(us, hd, 0x04); return; }
    this.buffer = new Uint8Array(total);
    this.bufPos = 0;
    this.pendingResult = [us | (hd << 2), 0, 0, this.pcn, hd, r + this.writeTargets.length, n];
    this.phase = 'exec-write';
  }

  private finishWrite(): void {
    const disc = this.drives[this.drive] ?? null;
    let at = 0;
    for (const [track, id] of this.writeTargets) {
      const s = disc?.sectorList(track).find((x) => x.r === id);
      if (s && disc) { disc.write(track, id, this.buffer.subarray(at, at + s.size)); at += s.size; }
    }
    this.result = this.pendingResult;
    this.phase = 'result';
  }

  private startFormat(): void {
    // params: [unit, N, SC, GPL, D]. Execution phase then sends C,H,R,N per
    // sector. We only need to accept the bytes and fill existing sectors.
    const us = this.params[0] & 3;
    const hd = (this.params[0] >> 2) & 1;
    const sc = this.params[2];
    this.drive = us;
    this.buffer = new Uint8Array(sc * 4);
    this.bufPos = 0;
    this.formatFill = this.params[4];
    this.pendingResult = [us | (hd << 2), 0, 0, this.pcn, hd, 1, this.params[1]];
    this.phase = 'exec-write';
    this.writeTargets = [];
  }

  private finishFormat(): void {
    const disc = this.drives[this.drive] ?? null;
    for (let i = 0; i + 3 < this.buffer.length; i += 4) {
      const id = this.buffer[i + 2];
      const s = disc?.sectorList(this.pcn).find((x) => x.r === id);
      if (s && disc) disc.write(this.pcn, id, new Uint8Array(s.size).fill(this.formatFill));
    }
    this.result = this.pendingResult;
    this.phase = 'result';
  }

  private abnormal(us: number, hd: number, st1: number): void {
    this.result = [0x40 | us | (hd << 2), st1, 0, this.pcn, hd, this.params[3] ?? 1, this.params[4] ?? 2];
    this.phase = 'result';
  }

  // --- snapshot ---------------------------------------------------------

  getState(): FdcState {
    return {
      phase: this.phase, cmd: this.cmd, params: [...this.params],
      result: [...this.result], buffer: Array.from(this.buffer), bufPos: this.bufPos,
      writeTargets: this.writeTargets.map(([a, b]) => [a, b] as [number, number]),
      pendingResult: [...this.pendingResult], formatFill: this.formatFill,
      motorOn: this.motorOn, pcn: this.pcn, drive: this.drive,
      intPending: this.intPending, idIndex: this.idIndex,
    };
  }

  setState(s: FdcState): void {
    this.phase = s.phase; this.cmd = s.cmd;
    this.params = [...s.params]; this.need = PARAM_COUNT[s.cmd & 0x1f] ?? 0;
    this.result = [...s.result];
    this.buffer = Uint8Array.from(s.buffer); this.bufPos = s.bufPos;
    this.writeTargets = s.writeTargets.map(([a, b]) => [a, b] as [number, number]);
    this.pendingResult = [...s.pendingResult]; this.formatFill = s.formatFill;
    this.motorOn = s.motorOn; this.pcn = s.pcn; this.drive = s.drive;
    this.intPending = s.intPending; this.idIndex = s.idIndex;
  }
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}
