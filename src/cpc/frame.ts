import type { Z80 } from '../z80/cpu';
import type { CPCMachine } from './machine';
import {
  CYCLES_PER_LINE, LINES_PER_FRAME, PENS_PER_LINE, INTERRUPT_LINES,
  VSYNC_START, VSYNC_LINES, RENDER_LINE,
} from './constants';

// Runs the machine until the raster reaches the end of the displayed area, so a
// rendered frame always shows a complete, untorn picture.
export function runFrame(cpu: Z80, m: CPCMachine): void {
  let guard = 0;
  m.frameReady = false;
  while (!m.frameReady && ++guard < 400000) {
    const before = cpu.tstates;
    cpu.step();
    m.frameCycles += cpu.tstates - before;
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
  m.frames++;
}
