// Static T-state cost of an instruction, as this emulator charges it (every
// instruction rounded up to a multiple of four, the Gate Array's rule). Used
// for the editor gutter. `min` and `max` differ only for conditional or
// block-repeating instructions.
import { makeZ80 } from '../z80/cpu';
import type { Bus } from '../z80/bus';

export interface Cost {
  min: number;
  max: number;
}

const JR_CC = new Set([0x20, 0x28, 0x30, 0x38]);
const CALL_CC = new Set([0xc4, 0xcc, 0xd4, 0xdc, 0xe4, 0xec, 0xf4, 0xfc]);
const RET_CC = new Set([0xc0, 0xc8, 0xd0, 0xd8, 0xe0, 0xe8, 0xf0, 0xf8]);
const ED_REPEAT = new Set([0xb0, 0xb8, 0xb1, 0xb9, 0xb2, 0xba, 0xb3, 0xbb]);

function stepOnce(bytes: number[], opts: { f?: number; b?: number; c?: number } = {}): number {
  const ram = new Uint8Array(0x10000);
  ram.set(bytes.slice(0, 4), 0x100);
  const bus: Bus = {
    read: (a) => ram[a & 0xffff],
    write: (a, v) => { ram[a & 0xffff] = v & 0xff; },
    in: () => 0xff,
    out: () => {},
  };
  const cpu = makeZ80(bus);
  cpu.reset();
  cpu.PC = 0x100;
  cpu.SP = 0xf000;
  cpu.F = opts.f ?? 0;
  cpu.R[0] = opts.b ?? 1; // B
  cpu.R[1] = opts.c ?? 0; // C
  return cpu.step();
}

const cache = new Map<string, Cost>();

export function instructionCost(bytes: number[]): Cost {
  if (bytes.length === 0) return { min: 0, max: 0 };
  const key = bytes.slice(0, 4).join(',');
  const hit = cache.get(key);
  if (hit) return hit;
  const cost = compute(bytes);
  cache.set(key, cost);
  return cost;
}

function compute(bytes: number[]): Cost {
  const first = bytes[0];
  const pair = (a: number, z: number): Cost => ({ min: Math.min(a, z), max: Math.max(a, z) });

  if (JR_CC.has(first) || CALL_CC.has(first) || RET_CC.has(first)) {
    return pair(stepOnce(bytes, { f: 0x00 }), stepOnce(bytes, { f: 0xff }));
  }
  if (first === 0x10) { // djnz: B 1 -> 0 (not taken) vs 2 -> 1 (taken)
    return pair(stepOnce(bytes, { b: 1 }), stepOnce(bytes, { b: 2 }));
  }
  if (first === 0xed && ED_REPEAT.has(bytes[1])) { // BC 1 -> done vs 2 -> repeat
    return pair(stepOnce(bytes, { b: 0, c: 1 }), stepOnce(bytes, { b: 0, c: 2 }));
  }
  const t = stepOnce(bytes);
  return { min: t, max: t };
}

export function formatCost(c: Cost): string {
  return c.min === c.max ? String(c.min) : `${c.max}/${c.min}`;
}
