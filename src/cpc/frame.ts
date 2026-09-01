import type { Z80 } from '../z80/cpu';
import type { CPCMachine } from './machine';
import {
  CYCLES_PER_LINE, LINES_PER_FRAME, PENS_PER_LINE, INTERRUPT_LINES,
  VSYNC_START, VSYNC_LINES, RENDER_LINE,
} from './constants';

export type StopReason = 'frame' | 'breakpoint' | 'steps' | 'timeout';

export interface RunCondition {
  /** Stop when the raster reaches the end of the displayed area (RENDER_LINE). */
  frame?: boolean;
  /** Stop *before* executing an instruction whose PC is in this set. */
  breakpoints?: ReadonlySet<number>;
  /** Stop after this many instructions. */
  maxSteps?: number;
  /** Called after each instruction with its start PC and (rounded) T-states. */
  onStep?: (pc: number, tstates: number) => void;
}

const GUARD = 400_000;

// Advance the raster/interrupt state for one instruction's worth of T-states.
function advance(cpu: Z80, m: CPCMachine, cycles: number): void {
  m.frameCycles += cycles;
  while (m.frameCycles >= CYCLES_PER_LINE) {
    m.frameCycles -= CYCLES_PER_LINE;
    m.lineCounter = (m.lineCounter + 1) % LINES_PER_FRAME;
    m.linePens.set(m.pens, m.lineCounter * PENS_PER_LINE);
    m.vsync = m.lineCounter >= VSYNC_START && m.lineCounter < VSYNC_START + VSYNC_LINES;
    m.interruptCounter++;
    if (m.lineCounter === VSYNC_START + 2) {
      // The Gate Array resynchronises its interrupt counter here, two HSYNCs
      // after the start of VSYNC. This is what ties raster effects to the frame.
      if (m.interruptCounter >= 32) cpu.interrupt();
      m.interruptCounter = 0;
    } else if (m.interruptCounter >= INTERRUPT_LINES) {
      m.interruptCounter = 0;
      cpu.interrupt();
    }
    if (m.lineCounter === RENDER_LINE) m.frameReady = true;
  }
}

/**
 * Run the machine until a stop condition is met. The single stepping primitive
 * behind both the frame loop and the debugger. Returns why it stopped.
 *
 * With a breakpoint at the current PC it returns 'breakpoint' immediately — a
 * "continue" should step once past it first.
 */
export function runUntil(cpu: Z80, m: CPCMachine, cond: RunCondition): StopReason {
  const bp = cond.breakpoints;
  const onStep = cond.onStep;
  const maxSteps = cond.maxSteps ?? Infinity;
  if (cond.frame) m.frameReady = false;

  let steps = 0;
  let guard = 0;
  for (;;) {
    if (bp && bp.size && bp.has(cpu.PC)) return 'breakpoint';
    if (steps >= maxSteps) return 'steps';

    const pc = cpu.PC;
    const before = cpu.tstates;
    cpu.step();
    steps++;
    const dt = cpu.tstates - before;
    if (onStep) onStep(pc, dt);
    advance(cpu, m, dt);

    if (cond.frame && m.frameReady) return 'frame';
    if (++guard >= GUARD) return 'timeout';
  }
}

// Runs the machine until the raster reaches the end of the displayed area, so a
// rendered frame always shows a complete, untorn picture.
export function runFrame(cpu: Z80, m: CPCMachine): void {
  runUntil(cpu, m, { frame: true });
  m.frames++;
}
