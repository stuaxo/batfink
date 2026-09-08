// The screen. Turns machine state into pixels on the canvas, behind an
// interface a WebGL path can slot into unchanged — see plan/webgl-renderer.md.
// Today there is one implementation: the software renderer in ../cpc/video,
// reached through m.render.
import { type CPCMachine, WIDTH, HEIGHT } from '../cpc';

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

/** Pick the best renderer the browser can give us. Software-only for now. */
export function createRenderer(canvas: HTMLCanvasElement): Renderer {
  return new SoftwareRenderer(canvas);
}
