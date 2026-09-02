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
      setTiming: () => {},
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

// Serve the real committed ROM images to the app's fetch(). `?url` asset paths
// contain the file's basename, so match on that.
async function stubRomFetch() {
  const { readFileSync } = await import('node:fs');
  const dir = process.cwd() + '/src/cpc/roms/';
  vi.stubGlobal('fetch', async (u: string) => {
    const name = /amsdos/.test(u) ? 'amsdos.rom' : /6128/.test(u) ? 'cpc6128.rom' : 'cpc464.rom';
    return { ok: true, arrayBuffer: async () => new Uint8Array(readFileSync(dir + name)).buffer };
  });
}

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

  it('hovering the screen shows the byte address; clicking sends it to the memory view', () => {
    boot();
    const canvas = document.getElementById('screen') as HTMLCanvasElement;
    const info = document.getElementById('screen-info')!;
    const move = new MouseEvent('mousemove');
    Object.defineProperty(move, 'offsetX', { value: 48 });
    Object.defineProperty(move, 'offsetY', { value: 48 });
    canvas.dispatchEvent(move);
    expect(info.textContent).toMatch(/&[0-9A-F]{4} = [0-9A-F]{2} · mode/);

    const click = new MouseEvent('click');
    Object.defineProperty(click, 'offsetX', { value: 48 });
    Object.defineProperty(click, 'offsetY', { value: 48 });
    canvas.dispatchEvent(click);
    expect((document.getElementById('dbg-addr') as HTMLInputElement).value).toMatch(/^&C0/);
  });

  it('the instruction trace records when enabled and shows on pause', () => {
    boot();
    const toggle = document.getElementById('trace-on') as HTMLInputElement;
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change'));
    // step a few instructions
    for (let i = 0; i < 4; i++) document.getElementById('dbg-step')!.dispatchEvent(new Event('click'));
    const out = document.getElementById('trace-out')!;
    expect(out.hidden).toBe(false);
    expect(out.textContent).toMatch(/[0-9A-F]{4} {2}\S.*A=[0-9a-f]{2}/);
  });

  it('the sound button reports gracefully when audio is unavailable', async () => {
    boot();
    const btn = document.getElementById('sound')!;
    expect(btn.textContent).toBe('Sound off');
    btn.dispatchEvent(new Event('click'));
    await Promise.resolve();
    await Promise.resolve();
    expect(document.getElementById('status')!.textContent).toMatch(/[Aa]udio is not available/);
    expect(btn.textContent).toBe('Sound off');
  });

  it('the frame-budget profiler produces a breakdown', () => {
    boot();
    document.getElementById('prof-measure')!.dispatchEvent(new Event('click'));
    const out = document.getElementById('prof-out')!;
    expect(out.querySelector('.prof-total')!.textContent).toMatch(/of 312 scanlines/);
    expect(out.querySelectorAll('.prof-row').length).toBeGreaterThan(1);
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

  it('the Machine switch boots the firmware and returns to bare metal', async () => {
    await stubRomFetch();
    vi.stubGlobal('requestAnimationFrame', () => 0); // freeze the tick loop
    try {
      boot();
      const sel = document.getElementById('machine') as HTMLSelectElement;
      const status = () => document.getElementById('status')!.textContent ?? '';
      const regs = () => document.getElementById('dbg-regs')!.textContent ?? '';

      sel.value = 'cpc464';
      sel.dispatchEvent(new Event('change'));
      await vi.waitFor(() => expect(status()).toMatch(/Firmware booting.*CALL &[0-9A-F]{4} from BASIC/));
      document.getElementById('dbg-step')!.dispatchEvent(new Event('click'));
      expect(regs()).toMatch(/PC 000[0-9A-F]/); // executing from the reset vector, not the listing

      sel.value = 'bare';
      sel.dispatchEvent(new Event('change'));
      await vi.waitFor(() => expect(status()).toMatch(/Assembled \d+ bytes\. Running\./));
      document.getElementById('dbg-step')!.dispatchEvent(new Event('click'));
      expect(regs()).toMatch(/PC 4[0-9A-F]{3}/); // back to the assembled listing at &4000
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('offers a 6128 machine that boots too', async () => {
    await stubRomFetch();
    vi.stubGlobal('requestAnimationFrame', () => 0);
    try {
      boot();
      const sel = document.getElementById('machine') as HTMLSelectElement;
      expect([...sel.options].map((o) => o.value)).toEqual(['bare', 'cpc464', 'cpc6128']);
      const status = () => document.getElementById('status')!.textContent ?? '';

      sel.value = 'cpc6128';
      sel.dispatchEvent(new Event('change'));
      await vi.waitFor(() => expect(status()).toMatch(/Firmware booting/));
      document.getElementById('dbg-step')!.dispatchEvent(new Event('click'));
      expect(document.getElementById('dbg-regs')!.textContent).toMatch(/PC 000[0-9A-F]/);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('the disc controls appear in firmware mode and mount the program', async () => {
    await stubRomFetch();
    vi.stubGlobal('requestAnimationFrame', () => 0);
    try {
      boot();
      const disc = document.getElementById('disc') as HTMLElement;
      const discStatus = document.getElementById('disc-status')!;
      expect(disc.hidden).toBe(true); // bare metal: no drive

      const sel = document.getElementById('machine') as HTMLSelectElement;
      sel.value = 'cpc464';
      sel.dispatchEvent(new Event('change'));
      await vi.waitFor(() => expect(disc.hidden).toBe(false));

      (document.getElementById('dl-name') as HTMLInputElement).value = 'GAME';
      document.getElementById('disc-mount-prog')!.dispatchEvent(new Event('click'));
      expect(discStatus.textContent).toBe('GAME.DSK — RUN"GAME');

      document.getElementById('disc-eject')!.dispatchEvent(new Event('click'));
      expect(discStatus.textContent).toBe('no disc');

      sel.value = 'bare';
      sel.dispatchEvent(new Event('change'));
      expect(disc.hidden).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
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
