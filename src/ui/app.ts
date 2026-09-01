// Wires the DOM playground to the emulator core. Everything hardware-related
// lives in ../z80 and ../cpc; this file only touches the page.
import { assemble, type AssembleError } from '../asm';
import { makeZ80 } from '../z80/cpu';
import { makeCPC, runFrame, snapshotSNA, CPC_PALETTE, WIDTH, HEIGHT } from '../cpc';
import { DEMO_SOURCE } from '../demo';
import { drawWordmark } from './wordmark';
import { attachKeyboard } from './keyboard';

const FRAME_MS = 19.968; // 1000 / 50.08Hz

function need<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
}

export function startApp(): void {
  const srcBox = need<HTMLTextAreaElement>('src');
  const canvas = need<HTMLCanvasElement>('screen');
  const maybeCtx = canvas.getContext('2d');
  if (!maybeCtx) throw new Error('no 2d context');
  const ctx = maybeCtx;
  const errBox = need<HTMLUListElement>('errors');
  const okBox = need<HTMLParagraphElement>('ok');
  const inksBox = need<HTMLDivElement>('r-inks');
  srcBox.value = DEMO_SOURCE;

  const machine = makeCPC();
  const cpu = makeZ80(machine.bus);
  const image = ctx.createImageData(WIDTH, HEIGHT);
  const rgba = image.data;
  let running = false;
  let codeSize = 0;
  let snapshot: Uint8Array | null = null;

  function showErrors(errors: AssembleError[]): void {
    errBox.innerHTML = '';
    okBox.textContent = '';
    if (!errors.length) {
      okBox.textContent = `Assembled ${codeSize} bytes. Running.`;
      return;
    }
    for (const e of errors.slice(0, 12)) {
      const li = document.createElement('li');
      li.textContent = `line ${e.line}: ${e.message}`;
      errBox.appendChild(li);
    }
    if (errors.length > 12) {
      const li = document.createElement('li');
      li.textContent = `and ${errors.length - 12} more`;
      errBox.appendChild(li);
    }
  }

  function build(): boolean {
    const result = assemble(srcBox.value);
    if (result.errors.length) { codeSize = 0; showErrors(result.errors); return false; }
    codeSize = result.end - result.start;
    machine.reset();
    machine.ram.fill(0);
    for (let a = result.start; a < result.end; a++) machine.ram[a] = result.bytes[a];
    cpu.reset();
    cpu.PC = 'START' in result.symbols ? result.symbols['START'] : result.start;
    snapshot = snapshotSNA(cpu, machine); // captured at the entry point
    need('r-size').textContent = `${codeSize} bytes`;
    showErrors([]);
    if (!('FONT' in result.symbols)) return true;
    const f = result.symbols['FONT'];
    drawWordmark(need<HTMLCanvasElement>('wordmark'), Array.from(machine.ram.slice(f, f + 472)));
    return true;
  }

  function paint(): void {
    machine.render(rgba);
    ctx.putImageData(image, 0, 0);
    need('r-frame').textContent = String(machine.frames);
    need('r-pc').textContent = '&' + cpu.PC.toString(16).toUpperCase().padStart(4, '0');
    need('r-mode').textContent = String(machine.mode);
    inksBox.innerHTML = '';
    const shown = machine.mode === 0 ? 16 : machine.mode === 1 ? 4 : 2;
    for (let p = 0; p < shown; p++) {
      const c = CPC_PALETTE[machine.pens[p] & 0x1f];
      const sp = document.createElement('span');
      sp.style.background = `rgb(${c[0]},${c[1]},${c[2]})`;
      inksBox.appendChild(sp);
    }
  }

  let last = 0;
  let acc = 0;
  function tick(now: number): void {
    requestAnimationFrame(tick);
    if (!running) { last = now; return; }
    if (!last) last = now;
    acc += now - last;
    last = now;
    if (acc > 120) acc = 120; // never try to catch up more than six frames
    let drawn = false;
    while (acc >= FRAME_MS) { acc -= FRAME_MS; runFrame(cpu, machine); drawn = true; }
    if (drawn) paint();
  }

  function setRunning(on: boolean): void {
    running = on;
    need('pause').textContent = on ? 'Pause' : 'Resume';
  }

  need('assemble').addEventListener('click', () => {
    if (build()) { setRunning(true); paint(); }
    else setRunning(false);
  });
  need('pause').addEventListener('click', () => setRunning(!running));
  need('export').addEventListener('click', () => {
    if (!snapshot) return;
    const url = URL.createObjectURL(new Blob([snapshot as BlobPart], { type: 'application/octet-stream' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'raster.sna';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  need('reset').addEventListener('click', () => { build(); setRunning(true); paint(); });
  need('restore').addEventListener('click', () => {
    srcBox.value = DEMO_SOURCE;
    build();
    setRunning(true);
    paint();
  });

  attachKeyboard(machine, srcBox);

  build();
  setRunning(true);
  requestAnimationFrame(tick);
}
