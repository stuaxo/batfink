// SingleStepTests z80/v1 — per-opcode cases with a full before/after CPU + RAM
// state. Runs a deterministic sample (first N per file) against our core.
//
// Fetch the fixtures first: `npm run fetch:fixtures` (curated subset) or
// `SST_OPCODES=all npm run fetch:fixtures` (every opcode). Set SST_CASES=1000
// for the full run; SST_WRITE_BASELINE=1 to regenerate the ratchet.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeZ80 } from '../../../src/z80/cpu';
import type { Bus } from '../../../src/z80/bus';
import { SST_DIR, haveSst, announce } from '../tools';

const CASES = Number(process.env.SST_CASES ?? 200);
const BASELINE = fileURLToPath(new URL('./baselines/single-step.json', import.meta.url));
const WRITE = process.env.SST_WRITE_BASELINE === '1';
const UNDOC = 0xd7; // ~(YF | XF): the documented flag bits

interface State {
  pc: number; sp: number; a: number; b: number; c: number; d: number; e: number;
  f: number; h: number; l: number; i: number; r: number; ix: number; iy: number;
  af_: number; bc_: number; de_: number; hl_: number;
  iff1: number; iff2: number; im: number;
  ram: [number, number][];
}
type Cycle = [number, number | null, string];
interface Case { name: string; initial: State; final: State; cycles: Cycle[] }

interface Tally { cases: number; regPass: number; ramPass: number; fExactPass: number; fMaskPass: number; rPass: number }

/** The byte an IN reads is recorded in the IORQ+RD bus cycle. */
function inputByte(cycles: Cycle[]): number {
  for (let j = 0; j < cycles.length - 1; j++) {
    const pins = cycles[j][2];
    if (pins.includes('r') && pins.includes('i') && cycles[j + 1][1] != null) {
      return cycles[j + 1][1]! & 0xff;
    }
  }
  return 0xff;
}

function runCase(tc: Case, basePage: boolean): { reg: boolean; ram: boolean; fExact: boolean; fMask: boolean; r: boolean } {
  const ram = new Uint8Array(0x10000);
  const inByte = inputByte(tc.cycles);
  const bus: Bus = {
    read: (x) => ram[x & 0xffff],
    write: (x, v) => { ram[x & 0xffff] = v & 0xff; },
    in: () => inByte,
    out: () => {},
  };
  const cpu = makeZ80(bus);
  cpu.reset();
  const s = tc.initial;
  cpu.PC = s.pc; cpu.SP = s.sp;
  cpu.R[7] = s.a; cpu.R[0] = s.b; cpu.R[1] = s.c; cpu.R[2] = s.d; cpu.R[3] = s.e;
  cpu.R[4] = s.h; cpu.R[5] = s.l; cpu.F = s.f;
  cpu.IX = s.ix; cpu.IY = s.iy; cpu.I = s.i; cpu.Rr = s.r;
  cpu.IFF1 = s.iff1; cpu.IFF2 = s.iff2; cpu.IM = s.im;
  cpu.Rs[7] = s.af_ >> 8; cpu.Fs = s.af_ & 0xff;
  cpu.Rs[0] = s.bc_ >> 8; cpu.Rs[1] = s.bc_ & 0xff;
  cpu.Rs[2] = s.de_ >> 8; cpu.Rs[3] = s.de_ & 0xff;
  cpu.Rs[4] = s.hl_ >> 8; cpu.Rs[5] = s.hl_ & 0xff;
  for (const [addr, val] of s.ram) ram[addr & 0xffff] = val;

  cpu.step();

  const f = tc.final;
  const reg =
    cpu.R[7] === f.a && cpu.R[0] === f.b && cpu.R[1] === f.c && cpu.R[2] === f.d &&
    cpu.R[3] === f.e && cpu.R[4] === f.h && cpu.R[5] === f.l &&
    cpu.PC === f.pc && cpu.SP === f.sp && cpu.IX === f.ix && cpu.IY === f.iy &&
    cpu.I === f.i && cpu.IFF1 === f.iff1 && cpu.IFF2 === f.iff2 && cpu.IM === f.im;
  const ramOk = f.ram.every(([addr, val]) => ram[addr & 0xffff] === val);
  return {
    reg,
    ram: ramOk,
    fExact: cpu.F === f.f,
    fMask: (cpu.F & UNDOC) === (f.f & UNDOC),
    r: basePage ? (cpu.Rr & 0xff) === f.r : true,
  };
}

const files = haveSst()
  ? readdirSync(SST_DIR).filter((n) => n.endsWith('.json')).sort()
  : [];

describe.skipIf(!announce('conformance/single-step', haveSst(), 'run `npm run fetch:fixtures`'))(
  'SingleStepTests z80/v1',
  () => {
    const baseline: Record<string, Tally> =
      existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : {};
    const fresh: Record<string, Tally> = {};

    for (const file of files) {
      const opcode = file.replace(/\.json$/, '');
      const basePage = /^[0-9a-f]{2}$/.test(opcode);

      it(opcode, () => {
        const cases = (JSON.parse(readFileSync(join(SST_DIR, file), 'utf8')) as Case[]).slice(0, CASES);
        const t: Tally = { cases: cases.length, regPass: 0, ramPass: 0, fExactPass: 0, fMaskPass: 0, rPass: 0 };
        const misses: string[] = [];
        for (const tc of cases) {
          const r = runCase(tc, basePage);
          if (r.reg) t.regPass++; else misses.push(`${tc.name}: reg`);
          if (r.ram) t.ramPass++;
          if (r.fExact) t.fExactPass++;
          if (r.fMask) t.fMaskPass++; else misses.push(`${tc.name}: F ${hex(tc.final.f)} vs masked`);
          if (r.r) t.rPass++;
        }
        fresh[opcode] = t;

        if (WRITE) return;

        const base = baseline[opcode];
        expect(base, `no baseline for ${opcode} — run with SST_WRITE_BASELINE=1`).toBeDefined();
        // Registers, RAM and documented flags must not regress against the baseline.
        for (const k of ['regPass', 'ramPass', 'fMaskPass', 'rPass'] as const) {
          expect(t[k], `${opcode} ${k} regressed (${misses.slice(0, 3).join('; ')})`).toBeGreaterThanOrEqual(
            Math.min(base[k], t.cases),
          );
        }
        expect(t.fExactPass, `${opcode} exact-F regressed`).toBeGreaterThanOrEqual(Math.min(base.fExactPass, t.cases));
        if (t.cases === base.cases && (t.fExactPass > base.fExactPass || t.fMaskPass > base.fMaskPass)) {
          console.info(`[sst] ${opcode} improved — regenerate the baseline`);
        }
      });
    }

    // Baselined gaps in the core, surfaced by this suite:
    //  - `ed 5f` (LD A,R): R is bumped once per step(), not once per opcode
    //    fetch, so after a prefixed opcode A is low by one.
    //  - `ed a2`/`ed a3` (INI/OUTI and their D/R variants): flags are derived
    //    from B only; the real Z80 also folds in the transferred byte.
    it.skip('known core gaps: LD A,R off-by-one; INI/OUTI flags', () => {});

    it('writes the baseline when asked', () => {
      if (!WRITE) return;
      const sorted = Object.fromEntries(Object.entries(fresh).sort());
      writeFileSync(BASELINE, JSON.stringify(sorted, null, 1) + '\n');
      console.info(`[sst] wrote ${Object.keys(sorted).length} entries to ${BASELINE}`);
    });
  },
);

function hex(n: number): string {
  return '0x' + n.toString(16).padStart(2, '0');
}
