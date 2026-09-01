// Frame-budget profiler: where does the beam-racing time go? Runs one frame with
// per-instruction T-state accounting and attributes the cost to the nearest
// preceding label.
import type { Z80 } from '../z80/cpu';
import { type CPCMachine, runUntil, getState, setState, CYCLES_PER_LINE, LINES_PER_FRAME } from '../cpc';

const FRAME_TSTATES = CYCLES_PER_LINE * LINES_PER_FRAME; // 79872

export interface RoutineCost {
  name: string;
  addr: number;
  tstates: number;
  scanlines: number;
  /** fraction of the 312-line frame budget */
  fraction: number;
}

export interface ProfileResult {
  total: number;
  scanlines: number;
  budget: number; // FRAME_TSTATES
  routines: RoutineCost[];
  /** T-states per exact address, for a finer view */
  byAddr: Map<number, number>;
}

/** Measure one frame without disturbing the machine (snapshot / restore). */
export function profileFrame(cpu: Z80, m: CPCMachine, symbols: Record<string, number>): ProfileResult {
  const saved = getState(cpu, m);
  const byAddr = new Map<number, number>();
  let total = 0;
  runUntil(cpu, m, {
    frame: true,
    onStep: (pc, dt) => {
      byAddr.set(pc, (byAddr.get(pc) ?? 0) + dt);
      total += dt;
    },
  });
  setState(cpu, m, saved);

  return {
    total,
    scanlines: total / CYCLES_PER_LINE,
    budget: FRAME_TSTATES,
    byAddr,
    routines: attribute(byAddr, symbols),
  };
}

function attribute(byAddr: Map<number, number>, symbols: Record<string, number>): RoutineCost[] {
  const marks = Object.entries(symbols)
    .map(([name, addr]) => ({ name, addr }))
    .sort((a, b) => a.addr - b.addr);

  const costs = new Map<string, RoutineCost>();
  const key = (a: number) => {
    // nearest preceding label
    let lo = 0;
    let hi = marks.length - 1;
    let idx = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (marks[mid].addr <= a) { idx = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return idx >= 0 ? marks[idx] : { name: `&${a.toString(16).toUpperCase().padStart(4, '0')}`, addr: a };
  };

  for (const [addr, dt] of byAddr) {
    const m = key(addr);
    const existing = costs.get(m.name);
    if (existing) existing.tstates += dt;
    else costs.set(m.name, { name: m.name, addr: m.addr, tstates: dt, scanlines: 0, fraction: 0 });
  }

  return [...costs.values()]
    .map((r) => ({ ...r, scanlines: r.tstates / CYCLES_PER_LINE, fraction: r.tstates / FRAME_TSTATES }))
    .sort((a, b) => b.tstates - a.tstates);
}
