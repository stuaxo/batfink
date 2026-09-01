// Boots firmware + AMSDOS behind a stub FDC (sane MSR, canned results) and
// records the µPD765 command sequence AMSDOS issues for CAT. This is the source
// of the "what AMSDOS does" section in plan/fdc.md; keep it green so a change
// that stops AMSDOS reaching the FDC is caught.
import { describe, it, expect } from 'vitest';
import { announce } from '../tools';
import { bootFirmware, typeText, run, readScreen, haveRoms } from './cpc-firmware';

const PCOUNT: Record<number, number> = {}; // filled below (cmd -> param byte count)
for (const [c, n] of Object.entries({
  0x03: 2, 0x04: 1, 0x07: 1, 0x08: 0, 0x0f: 2, // specify, sense drive, recalibrate, sense int, seek
  0x0a: 1, 0x4a: 1,                              // read id
  0x06: 8, 0x46: 8, 0x66: 8, 0x26: 8,            // read data
  0x05: 8, 0x45: 8,                              // write data
  0x0d: 5, 0x4d: 5,                              // format
  0x11: 8, 0x51: 8, 0x91: 8, 0xd1: 8,            // scan
})) PCOUNT[Number(c)] = n;

const NAME: Record<number, string> = {
  0x03: 'SPECIFY', 0x04: 'SENSE-DRIVE', 0x07: 'RECALIBRATE', 0x08: 'SENSE-INT',
  0x0f: 'SEEK', 0x0a: 'READ-ID', 0x4a: 'READ-ID', 0x06: 'READ', 0x46: 'READ',
  0x66: 'READ(SK)', 0x26: 'READ', 0x05: 'WRITE', 0x45: 'WRITE', 0x0d: 'FORMAT',
  0x4d: 'FORMAT', 0x11: 'SCAN', 0x51: 'SCAN',
};

describe.skipIf(!announce('fdc-trace', haveRoms, 'ROMs missing'))('AMSDOS FDC command trace', () => {
  it('records the command sequence AMSDOS issues for CAT', () => {
    const fw = bootFirmware(1);
    const { m } = fw;
    const orig = { in: m.bus.in, out: m.bus.out };
    const isFdd = (p: number) => ((p & 0x0400) === 0) && ((p & 0x0080) === 0);

    // Stub FDC: command -> params -> (execution) -> result.
    let st: 'idle' | 'cmd' | 'exec' | 'result' = 'idle';
    let need = 0;
    const params: number[] = [];
    let cmd = 0;
    let result: number[] = [];
    let track = 0;
    const log: string[] = [];
    let phase = 'boot';

    const finishCommand = () => {
      const base = cmd & 0x1f;
      if (base === 0x08) { result = [0x20 | 0x00, track]; st = 'result'; } // sense int: ST0 seek-end, PCN
      else if (base === 0x03) { st = 'idle'; }                            // specify: no result
      else if (base === 0x07 || base === 0x0f) { result = []; st = 'idle'; track = base === 0x0f ? params[1] : 0; } // recal/seek: no result, raises int
      else if (base === 0x04) { result = [0x28 | (track === 0 ? 0x10 : 0)]; st = 'result'; } // sense drive: ST3
      else if (base === 0x0a) { result = [0x00, 0x00, 0x00, track, 0, 0xc1, 2]; st = 'result'; } // read id
      else if (base === 0x06) { result = [0x40, 0x00, 0x00, params[1], params[2], params[3], params[4]]; st = 'result'; } // read: abnormal end
      else { result = [0x40, 0x00, 0x00, 0, 0, 0, 0]; st = 'result'; }
      const line = `  [${phase}] ${NAME[base] ?? '?' + base.toString(16)} cmd=${cmd.toString(16)} params=[${params.map((x) => x.toString(16)).join(' ')}] -> result=[${result.map((x) => x.toString(16)).join(' ')}]`;
      if (line !== log[log.length - 1]) log.push(line); // collapse the SENSE-INT poll spam
    };

    m.bus.out = (p: number, v: number) => {
      if (isFdd(p) && (p & 0x0100) && (p & 1)) { // FDC data register write
        if (st === 'idle') {
          cmd = v; params.length = 0; need = PCOUNT[v & 0x1f] ?? PCOUNT[v] ?? 0;
          st = need ? 'cmd' : 'idle';
          if (!need) finishCommand();
        } else if (st === 'cmd') {
          params.push(v);
          if (params.length >= need) finishCommand();
        }
        return;
      }
      orig.out.call(m.bus, p, v);
    };
    m.bus.in = (p: number) => {
      if (isFdd(p) && (p & 0x0100)) {
        if ((p & 1) === 0) { // MSR
          if (st === 'idle') return 0x80;
          if (st === 'cmd') return 0x90;            // RQM|CB, accept
          if (st === 'exec') return 0xf0;
          return 0xd0;                              // RQM|DIO|CB, result ready
        }
        // data register read (result phase)
        if (st === 'result') {
          const b = result.shift() ?? 0;
          if (result.length === 0) st = 'idle';
          return b;
        }
        return 0xff;
      }
      return orig.in.call(m.bus, p);
    };

    for (let f = 0; f < 220; f++) run(fw, 1);
    phase = 'CAT'; typeText(fw, 'CAT\r'); run(fw, 300);

    const seen = log.map((l) => l.match(/\] (\S+)/)?.[1]);
    console.info('\n=== AMSDOS command sequence ===\n' + log.slice(0, 12).join('\n') +
      `\n\n--- screen ---\n${readScreen(fw)}\n`);

    // AMSDOS drives the FDC: at minimum it specifies, recalibrates, senses the
    // interrupt, reads an ID and reads a sector.
    for (const cmd of ['SPECIFY', 'RECALIBRATE', 'SENSE-INT', 'READ-ID', 'READ']) {
      expect(seen).toContain(cmd);
    }
  }, 60_000);
});
