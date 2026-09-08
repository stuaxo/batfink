// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRenderer } from '../../src/ui/renderer';
import { makeCPC } from '../../src/cpc';

afterEach(() => vi.restoreAllMocks());

function stubCtx() {
  const ctx = {
    createImageData: (w: number, h: number) => ({
      data: new Uint8ClampedArray(w * h * 4), width: w, height: h,
    }),
    putImageData: vi.fn(),
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
    .mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
  return ctx;
}

describe('createRenderer', () => {
  it('draws the machine frame to the canvas', () => {
    const ctx = stubCtx();
    const r = createRenderer(document.createElement('canvas'));
    const m = makeCPC();
    m.reset();
    r.draw(m);
    expect(ctx.putImageData).toHaveBeenCalled();
  });

  it('throws without a 2d context', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    expect(() => createRenderer(document.createElement('canvas'))).toThrow(/2d context/);
  });
});
