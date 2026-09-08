// The screen. Turns machine state into pixels on the canvas, behind an
// interface with two implementations: the software renderer in ../cpc/video
// (the reference, always correct) and a WebGL2 fragment-shader path (./gl,
// faster). createRenderer prefers WebGL and falls back on any failure.
import { type CPCMachine, WIDTH, HEIGHT } from '../cpc';
import { WebGLRenderer } from './gl/webgl-renderer';

export interface Renderer {
  /** Draw the machine's current frame to the canvas. */
  draw(m: CPCMachine): void;
  /** Release any context / GPU resources. */
  dispose(): void;
}

class SoftwareRenderer implements Renderer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly image: ImageData;

  constructor(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    this.ctx = ctx;
    this.image = ctx.createImageData(WIDTH, HEIGHT);
  }

  draw(m: CPCMachine): void {
    m.render(this.image.data);
    this.ctx.putImageData(this.image, 0, 0);
  }

  dispose(): void {}
}

/** WebGL2 if the browser and the shader self-check allow it, software
 *  otherwise. `?renderer=software` in the URL forces the reference path.
 *
 *  The probe runs on a throwaway canvas: a canvas that has handed out a
 *  webgl2 context can never give a 2d one, so the page canvas must stay
 *  untouched until we know WebGL works. */
export function createRenderer(canvas: HTMLCanvasElement): Renderer {
  if (new URLSearchParams(location.search).get('renderer') !== 'software') {
    try {
      const probe = new WebGLRenderer(document.createElement('canvas'));
      probe.dispose();
      return new WebGLRenderer(canvas, { selfCheck: false });
    } catch (e) {
      const msg = (e as Error).message;
      if (msg !== 'no webgl2') console.warn('WebGL renderer failed, using software:', msg);
    }
  }
  return new SoftwareRenderer(canvas);
}
