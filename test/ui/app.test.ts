// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import indexHtml from '../../index.html?raw';
import { startApp } from '../../src/ui/app';

// happy-dom has no canvas raster backend, so stub just the 2d context calls the
// app makes. This still exercises all the DOM wiring, the assemble->run path and
// the button handlers.
function stubCanvas() {
  const ctx = {
    fillStyle: '',
    fillRect: vi.fn(),
    putImageData: vi.fn(),
    createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
}

describe('playground wiring', () => {
  beforeEach(() => {
    const body = indexHtml.replace(/[\s\S]*<body>/, '').replace(/<\/body>[\s\S]*/, '').replace(/<script[\s\S]*?<\/script>/g, '');
    document.body.innerHTML = body;
    stubCanvas();
  });

  it('boots without throwing and loads the demo listing', () => {
    expect(() => startApp()).not.toThrow();
    const src = document.getElementById('src') as HTMLTextAreaElement;
    expect(src.value).toContain('org &4000');
    expect(src.value.length).toBeGreaterThan(1000);
  });

  it('assembles the demo and reports byte count, not errors', () => {
    startApp();
    document.getElementById('assemble')!.dispatchEvent(new Event('click'));
    expect(document.getElementById('ok')!.textContent).toMatch(/Assembled \d+ bytes/);
    expect(document.getElementById('errors')!.children.length).toBe(0);
    expect(document.getElementById('r-size')!.textContent).toMatch(/\d+ bytes/);
  });

  it('surfaces assembler errors in the list', () => {
    startApp();
    const src = document.getElementById('src') as HTMLTextAreaElement;
    src.value = '  frobnicate\n';
    document.getElementById('assemble')!.dispatchEvent(new Event('click'));
    const items = document.getElementById('errors')!.children;
    expect(items.length).toBeGreaterThan(0);
    expect(items[0].textContent).toMatch(/line 1:/);
  });

  it('the pause button toggles its label', () => {
    startApp();
    const pause = document.getElementById('pause') as HTMLButtonElement;
    expect(pause.textContent).toBe('Pause');
    pause.dispatchEvent(new Event('click'));
    expect(pause.textContent).toBe('Resume');
    pause.dispatchEvent(new Event('click'));
    expect(pause.textContent).toBe('Pause');
  });
});
