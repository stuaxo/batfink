// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import indexHtml from '../../index.html?raw';
import { startApp, type AppOptions } from '../../src/ui/app';
import type { EditorHandle } from '../../src/ui/editor';

// A textarea stands in for CodeMirror: happy-dom has no layout, and this keeps
// the test about the app wiring, not the editor.
function fakeEditor(): NonNullable<AppOptions['createEditor']> {
  return (opts): EditorHandle => {
    const ta = document.createElement('textarea');
    ta.id = 'src';
    ta.value = opts.doc;
    ta.addEventListener('input', () => opts.onChange());
    opts.parent.appendChild(ta);
    return {
      getValue: () => ta.value,
      setValue: (s) => { ta.value = s; },
      setErrors: () => {},
      setSymbols: () => {},
      hasFocus: () => document.activeElement === ta,
      focus: () => ta.focus(),
    };
  };
}

function stubCanvas() {
  const ctx = {
    fillStyle: '',
    fillRect: vi.fn(),
    putImageData: vi.fn(),
    createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
}

const boot = () => startApp({ createEditor: fakeEditor() });

describe('playground wiring', () => {
  beforeEach(() => {
    const body = indexHtml.replace(/[\s\S]*<body>/, '').replace(/<\/body>[\s\S]*/, '').replace(/<script[\s\S]*?<\/script>/g, '');
    document.body.innerHTML = body;
    stubCanvas();
  });

  it('boots without throwing and loads the demo listing', () => {
    expect(boot).not.toThrow();
    const src = document.getElementById('src') as HTMLTextAreaElement;
    expect(src.value).toContain('org &4000');
  });

  it('assembles the demo on boot and reports byte count', () => {
    boot();
    expect(document.getElementById('ok')!.textContent).toMatch(/Assembled \d+ bytes/);
    expect(document.getElementById('errors')!.children.length).toBe(0);
    expect(document.getElementById('r-size')!.textContent).toMatch(/\d+ bytes/);
  });

  it('surfaces assembler errors in the list', () => {
    boot();
    const src = document.getElementById('src') as HTMLTextAreaElement;
    src.value = '  frobnicate\n';
    document.getElementById('assemble')!.dispatchEvent(new Event('click'));
    const items = document.getElementById('errors')!.children;
    expect(items.length).toBeGreaterThan(0);
    expect(items[0].textContent).toMatch(/line 1:/);
  });

  it('the pause button toggles its label', () => {
    boot();
    const pause = document.getElementById('pause') as HTMLButtonElement;
    expect(pause.textContent).toBe('Pause');
    pause.dispatchEvent(new Event('click'));
    expect(pause.textContent).toBe('Resume');
    pause.dispatchEvent(new Event('click'));
    expect(pause.textContent).toBe('Pause');
  });

  it('populates the examples menu and can load one', () => {
    boot();
    const sel = document.getElementById('examples') as HTMLSelectElement;
    expect(sel.options.length).toBeGreaterThan(3);
    sel.value = 'mode1';
    sel.dispatchEvent(new Event('change'));
    const src = document.getElementById('src') as HTMLTextAreaElement;
    expect(src.value).toContain('Mode 1');
    expect(document.getElementById('status')!.textContent).toMatch(/Mode 1/);
  });

  it('saves and lists a revision', () => {
    boot();
    vi.spyOn(window, 'prompt').mockReturnValue('draft-1');
    document.getElementById('rev-save')!.dispatchEvent(new Event('click'));
    const sel = document.getElementById('revisions') as HTMLSelectElement;
    expect([...sel.options].some((o) => o.value === 'draft-1')).toBe(true);
  });

  it('Step pauses and shows the debugger panel with registers and code', () => {
    boot();
    const panel = document.getElementById('dbg') as HTMLDivElement;
    expect(panel.hidden).toBe(true);
    document.getElementById('dbg-step')!.dispatchEvent(new Event('click'));
    expect(panel.hidden).toBe(false);
    expect(document.getElementById('pause')!.textContent).toBe('Resume');
    expect(document.getElementById('dbg-regs')!.textContent).toMatch(/PC [0-9A-F]{4}/);
    expect(document.getElementById('dbg-code')!.querySelectorAll('.dbg-line').length).toBeGreaterThan(0);
  });

  it('Step / Resume / Pause cycle is coherent', () => {
    boot();
    const pause = document.getElementById('pause')!;
    const step = document.getElementById('dbg-step') as HTMLButtonElement;
    const panel = document.getElementById('dbg') as HTMLDivElement;

    expect(pause.textContent).toBe('Pause');
    expect(step.disabled).toBe(true); // can't step while running

    step.dispatchEvent(new Event('click')); // -> paused
    expect(pause.textContent).toBe('Resume');
    expect(step.disabled).toBe(false);
    const pc1 = document.getElementById('dbg-regs')!.textContent;

    step.dispatchEvent(new Event('click')); // step again
    expect(document.getElementById('dbg-regs')!.textContent).not.toBe(pc1);

    pause.dispatchEvent(new Event('click')); // Resume -> running
    expect(pause.textContent).toBe('Pause');
    expect(panel.hidden).toBe(true);
    expect(step.disabled).toBe(true);

    pause.dispatchEvent(new Event('click')); // Pause -> paused
    expect(pause.textContent).toBe('Resume');
    expect(panel.hidden).toBe(false);
  });

  it('hot-patches a code edit instead of rebuilding', () => {
    vi.useFakeTimers();
    try {
      boot();
      const src = document.getElementById('src') as HTMLTextAreaElement;
      expect(src.value).toContain('&8D');
      src.value = src.value.replace('&8D', '&8C');
      src.dispatchEvent(new Event('input'));
      vi.advanceTimersByTime(400);
      const s = document.getElementById('status')!.textContent ?? '';
      expect(s).toMatch(/Patched \d+ byte/);
      expect(s).not.toMatch(/Running/); // patching doesn't change run state
    } finally {
      vi.useRealTimers();
    }
  });

  it('has a memory-as-graphics view that opens without error', () => {
    boot();
    const det = document.querySelector('details.gfxview') as HTMLDetailsElement;
    expect(det).not.toBeNull();
    expect(document.getElementById('gfx-mode')).not.toBeNull();
    det.open = true;
    expect(() => det.dispatchEvent(new Event('toggle'))).not.toThrow();
    (document.getElementById('gfx-addr') as HTMLInputElement).value = '&C000';
    expect(() => document.getElementById('gfx-addr')!.dispatchEvent(new Event('input'))).not.toThrow();
  });

  it('wires the timeline controls without error', () => {
    boot();
    expect(document.getElementById('tl-scrub')).not.toBeNull();
    expect((document.getElementById('tl-resume') as HTMLElement).hidden).toBe(true);
    // Live is a no-op with no history, but must not throw
    expect(() => document.getElementById('tl-live')!.dispatchEvent(new Event('click'))).not.toThrow();
    expect(document.getElementById('tl-pos')!.textContent).toMatch(/\d+ \/ \d+/);
  });

  it('the debugger shows a hex dump that follows a typed address', () => {
    boot();
    document.getElementById('dbg-step')!.dispatchEvent(new Event('click'));
    const addr = document.getElementById('dbg-addr') as HTMLInputElement;
    addr.value = '&4000';
    addr.dispatchEvent(new Event('input'));
    expect(document.getElementById('dbg-mem')!.textContent).toMatch(/^4000 /);
  });

  it('clicking a disassembly line toggles a breakpoint marker', () => {
    boot();
    document.getElementById('dbg-step')!.dispatchEvent(new Event('click'));
    const line = document.querySelector('#dbg-code .dbg-line') as HTMLElement;
    expect(line.classList.contains('bp')).toBe(false);
    line.dispatchEvent(new Event('click', { bubbles: true }));
    expect(document.querySelector(`#dbg-code .dbg-line[data-addr="${line.dataset.addr}"]`)!.classList.contains('bp')).toBe(true);
  });

  it('shows a RUN" hint when the disc format is chosen', () => {
    boot();
    const fmt = document.getElementById('dl-format') as HTMLSelectElement;
    fmt.value = 'dsk';
    fmt.dispatchEvent(new Event('change'));
    (document.getElementById('dl-name') as HTMLInputElement).value = 'HELLO';
    document.getElementById('dl-go')!.dispatchEvent(new Event('click'));
    expect(document.getElementById('dl-note')!.textContent).toContain('RUN"HELLO"');
  });
});
