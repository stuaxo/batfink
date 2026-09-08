// A read-only description of one frame for a renderer to consume. The software
// renderer (./video) reads it directly; a WebGL renderer uploads it as
// textures. Nothing here is copied — `ram` and the register arrays are live
// references and the renderer must not write them — but the shape names exactly
// what a renderer is allowed to see, so the two implementations can't drift.
// The palette model widens here when per-microsecond splits land
// (plan/webgl-renderer.md Stage 3).
import type { CPCMachine } from './machine';

export interface FrameView {
  /** 64K screen source. Live reference — do not write. */
  ram: Uint8Array;
  /** Gate Array screen mode, 0-2. */
  mode: number;
  /** CRTC registers as they stand at the end of the frame. */
  crtc: Uint8Array;
  /** Per-scanline palette snapshot: LINES_PER_FRAME * PENS_PER_LINE bytes,
   *  pens 0-15 then the border at index 16. Each line's opening colours. */
  linePens: Uint8Array;
  /** Mid-frame pen writes as (line, cycle-in-line, pen, value) quads, in time
   *  order — for colour changes within a scanline. */
  paletteWrites: Int32Array;
  paletteWriteCount: number;
}

export function frameView(m: CPCMachine): FrameView {
  return {
    ram: m.ram,
    mode: m.mode,
    crtc: m.crtc,
    linePens: m.linePens,
    paletteWrites: m.paletteWrites,
    paletteWriteCount: m.paletteWriteCount,
  };
}
