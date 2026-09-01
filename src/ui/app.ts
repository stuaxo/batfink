// Wires the DOM playground to the emulator core. Everything hardware-related
// lives in ../z80 and ../cpc; this file only touches the page.
import { assemble, type AssembleResult } from '../asm';
import { makeZ80 } from '../z80/cpu';
import { makeCPC, snapshotSNA, CPC_PALETTE, WIDTH, HEIGHT } from '../cpc';
import { Debugger } from '../debug/debugger';
import { Timeline } from '../debug/timeline';
import { DEMO_SOURCE } from '../demo';
import { EXAMPLES } from '../examples';
import { withAmsdosHeader, makeDsk, makeCdt } from '../export';
import { drawWordmark } from './wordmark';
import { attachKeyboard } from './keyboard';
import { createEditor, type EditorFactory } from './editor';
import { sourceFromHash, hashForSource } from './share';
import { listRevisions, saveRevision, getRevision, deleteRevision } from './revisions';
import { downloadBytes, downloadBlob } from './download';
import { screenshot, record, type Recorder } from './capture';

const FRAME_MS = 19.968; // 1000 / 50.08Hz
const REBUILD_MS = 300;

function need<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
}

function parseAddr(text: string): number | null {
  const s = text.trim();
  if (!s) return null;
  const m = /^(?:&|#|0x|\$)?([0-9a-f]+)$/i.exec(s);
  if (m && /[&#$]|0x/i.test(s)) return parseInt(m[1], 16) & 0xffff;
  if (/^\d+$/.test(s)) return parseInt(s, 10) & 0xffff;
  if (/^[0-9a-f]+$/i.test(s)) return parseInt(s, 16) & 0xffff;
  return null;
}

const hex4 = (n: number) => '&' + n.toString(16).toUpperCase().padStart(4, '0');

export interface AppOptions {
  createEditor?: EditorFactory;
}

export function startApp(opts: AppOptions = {}): void {
  const makeEditor = opts.createEditor ?? createEditor;

  const canvas = need<HTMLCanvasElement>('screen');
  const maybeCtx = canvas.getContext('2d');
  if (!maybeCtx) throw new Error('no 2d context');
  const ctx = maybeCtx;
  const errBox = need<HTMLUListElement>('errors');
  const okBox = need<HTMLParagraphElement>('ok');
  const statusBox = need<HTMLParagraphElement>('status');
  const inksBox = need<HTMLDivElement>('r-inks');

  const machine = makeCPC();
  const cpu = makeZ80(machine.bus);
  const debug = new Debugger(cpu, machine);
  const timeline = new Timeline(cpu, machine);
  const image = ctx.createImageData(WIDTH, HEIGHT);
  const rgba = image.data;
  let running = false;
  let codeSize = 0;
  let snapshot: Uint8Array | null = null;
  let lastBuild: AssembleResult | null = null;
  let loadedImage: Uint8Array | null = null; // the code image last written to RAM
  let loadedStart = 0;
  let loadedEnd = 0;

  const initialSource = sourceFromHash(location.hash) ?? DEMO_SOURCE;
  const editor = makeEditor({
    parent: need('editor'),
    doc: initialSource,
    onChange: scheduleBuild,
  });

  function status(text: string): void {
    statusBox.textContent = text;
  }

  function showErrors(errors: AssembleResult['errors']): void {
    errBox.innerHTML = '';
    okBox.textContent = errors.length ? '' : `Assembled ${codeSize} bytes.`;
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

  /** Assemble and report; returns the result only if it is clean. */
  function assembleOnly(): AssembleResult | null {
    const result = assemble(editor.getValue());
    lastBuild = result;
    editor.setErrors(result.errors);
    if (result.errors.length) {
      codeSize = 0;
      showErrors(result.errors);
      status(`${result.errors.length} error${result.errors.length > 1 ? 's' : ''}.`);
      return null;
    }
    editor.setSymbols(Object.keys(result.symbols));
    return result;
  }

  function afterBuild(result: AssembleResult): void {
    codeSize = result.end - result.start;
    need('r-size').textContent = `${codeSize} bytes`;
    need<HTMLInputElement>('dl-load').placeholder = hex4(result.start);
    need<HTMLInputElement>('dl-entry').placeholder = hex4(cpu.PC);
    showErrors([]);
    if ('FONT' in result.symbols) {
      const f = result.symbols['FONT'];
      drawWordmark(need<HTMLCanvasElement>('wordmark'), Array.from(machine.ram.slice(f, f + 472)));
    }
    renderDebug();
    updateTimeline();
  }

  function loadFull(result: AssembleResult): void {
    machine.reset();
    machine.ram.fill(0);
    for (let a = result.start; a < result.end; a++) machine.ram[a] = result.bytes[a];
    cpu.reset();
    cpu.PC = 'START' in result.symbols ? result.symbols['START'] : result.start;
    debug.state = 'running'; // breakpoints persist, history does not
    timeline.clear();
    loadedImage = result.bytes.slice();
    loadedStart = result.start;
    loadedEnd = result.end;
    snapshot = snapshotSNA(cpu, machine);
    afterBuild(result);
    status(`Assembled ${codeSize} bytes. Running.`);
  }

  /** Write only the bytes that changed, leaving the machine running. */
  function hotPatch(result: AssembleResult): void {
    let n = 0;
    const hi = Math.max(result.end, loadedEnd);
    for (let a = result.start; a < hi; a++) {
      const want = a < result.end ? result.bytes[a] : 0;
      if (want !== loadedImage![a]) {
        machine.ram[a] = want;
        loadedImage![a] = want;
        n++;
      }
    }
    loadedStart = result.start;
    loadedEnd = result.end;
    timeline.clear(); // snapshots hold the old code
    snapshot = snapshotSNA(cpu, machine);
    afterBuild(result);
    status(n ? `Patched ${n} byte${n === 1 ? '' : 's'}. Running.` : 'No change.');
  }

  function build(): boolean {
    const result = assembleOnly();
    if (!result) return false;
    loadFull(result);
    return true;
  }

  let rebuildTimer = 0;
  function scheduleBuild(): void {
    clearTimeout(rebuildTimer);
    rebuildTimer = window.setTimeout(() => {
      const result = assembleOnly();
      if (!result) { setRunning(false); return; }
      if (loadedImage && result.start === loadedStart) hotPatch(result);
      else { loadFull(result); setRunning(true); }
    }, REBUILD_MS);
  }

  function loadSource(source: string): void {
    editor.setValue(source);
    if (build()) { setRunning(true); paint(); } else setRunning(false);
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
    if (!running || debug.isPaused()) { last = now; return; }
    if (!last) last = now;
    acc += now - last;
    last = now;
    if (acc > 120) acc = 120;
    let frames = 0;
    while (acc >= FRAME_MS) { acc -= FRAME_MS; frames++; }
    if (frames) {
      debug.runFrames(frames);
      timeline.record();
      paint();
      updateTimeline();
    }
  }

  const scrub = need<HTMLInputElement>('tl-scrub');
  function updateTimeline(): void {
    scrub.max = String(timeline.latest);
    if (!timeline.reviewing) scrub.value = String(timeline.latest);
    need('tl-pos').textContent = `${scrub.value} / ${timeline.latest}`;
    need('tl-resume').hidden = !timeline.reviewing;
  }

  function setRunning(on: boolean): void {
    running = on;
    if (on) debug.state = 'running';
    else debug.pause();
    need('pause').textContent = on && !debug.isPaused() ? 'Pause' : 'Resume';
    renderDebug();
  }

  debug.onStop = () => {
    running = false;
    need('pause').textContent = 'Resume';
    paint();
    renderDebug();
  };

  const flagStr = (f: { s: boolean; z: boolean; h: boolean; pv: boolean; n: boolean; c: boolean }): string =>
    ([['S', f.s], ['Z', f.z], ['H', f.h], ['P', f.pv], ['N', f.n], ['C', f.c]] as const)
      .map(([label, on]) => (on ? label : label.toLowerCase())).join(' ');

  function renderDebug(): void {
    const panel = need('dbg');
    panel.hidden = !debug.isPaused();
    if (!debug.isPaused()) return;
    const r = debug.registers();
    const w = (n: number) => n.toString(16).toUpperCase().padStart(4, '0');
    need('dbg-regs').textContent =
      `AF ${w(r.af)}  BC ${w(r.bc)}  DE ${w(r.de)}  HL ${w(r.hl)}\n` +
      `PC ${w(r.pc)}  SP ${w(r.sp)}  IX ${w(r.ix)}  IY ${w(r.iy)}\n` +
      `I ${r.i.toString(16).toUpperCase().padStart(2, '0')}  R ${r.r.toString(16).toUpperCase().padStart(2, '0')}  ` +
      `IM ${r.im}  IFF ${r.iff1 ? 1 : 0}${r.iff2 ? 1 : 0}   [ ${flagStr(r.flags)} ]`;
    const code = need('dbg-code');
    code.innerHTML = '';
    for (const x of debug.disassembleFrom(Math.max(0, r.pc - 4), 14)) {
      const line = document.createElement('div');
      line.className = 'dbg-line';
      line.dataset.addr = String(x.addr);
      if (x.addr === r.pc) line.classList.add('at');
      if (debug.breakpoints.has(x.addr)) line.classList.add('bp');
      line.textContent = `${w(x.addr)}  ${x.text}`;
      code.appendChild(line);
    }

    const base = (parseAddr(need<HTMLInputElement>('dbg-addr').value) ?? (r.pc & 0xfff0)) & 0xffff;
    const mem = debug.readMemory(base, 128);
    const lines: string[] = [];
    for (let row = 0; row < 8; row++) {
      const slice = mem.subarray(row * 16, row * 16 + 16);
      const hexpart = [...slice].map((b) => b.toString(16).padStart(2, '0')).join(' ');
      const asc = [...slice].map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : '.')).join('');
      lines.push(`${w((base + row * 16) & 0xffff)}  ${hexpart}  ${asc}`);
    }
    need('dbg-mem').textContent = lines.join('\n');
  }

  need('dbg-code').addEventListener('click', (e) => {
    const line = (e.target as HTMLElement).closest<HTMLElement>('.dbg-line');
    if (!line?.dataset.addr) return;
    debug.toggleBreakpoint(Number(line.dataset.addr));
    renderDebug();
  });
  need('dbg-addr').addEventListener('input', renderDebug);
  need('dbg-runto').addEventListener('click', () => {
    const a = parseAddr(need<HTMLInputElement>('dbg-addr').value);
    if (a !== null) debug.runToCursor(a);
  });

  let seekQueued = false;
  scrub.addEventListener('input', () => {
    if (seekQueued) return;
    seekQueued = true;
    requestAnimationFrame(() => {
      seekQueued = false;
      running = false;
      debug.state = 'paused';
      timeline.seek(Number(scrub.value));
      need('pause').textContent = 'Resume';
      paint();
      renderDebug();
      updateTimeline();
    });
  });
  need('tl-live').addEventListener('click', () => {
    timeline.goLive();
    setRunning(true);
    paint();
    updateTimeline();
  });
  need('tl-resume').addEventListener('click', () => {
    timeline.resumeHere();
    setRunning(true);
    updateTimeline();
  });

  // --- download menu ------------------------------------------------
  function assembledBytes(): Uint8Array | null {
    if (!lastBuild || lastBuild.errors.length) return null;
    return new Uint8Array(lastBuild.bytes.subarray(lastBuild.start, lastBuild.end));
  }

  function download(): void {
    const code = assembledBytes();
    if (!code || !lastBuild) { status('Nothing assembled to download.'); return; }
    const name = (need<HTMLInputElement>('dl-name').value.trim() || 'DEMO').toUpperCase().slice(0, 8);
    const load = parseAddr(need<HTMLInputElement>('dl-load').value) ?? lastBuild.start;
    const entry = parseAddr(need<HTMLInputElement>('dl-entry').value)
      ?? ('START' in lastBuild.symbols ? lastBuild.symbols['START'] : lastBuild.start);
    const meta = { filename: name + '.bin', loadAddr: load, entryAddr: entry };
    const fmt = need<HTMLSelectElement>('dl-format').value;
    const note = need('dl-note');
    note.textContent = '';

    if (fmt === 'sna') {
      if (!snapshot) { status('No snapshot.'); return; }
      downloadBytes(name + '.sna', snapshot);
    } else if (fmt === 'bin') {
      const withHeader = need<HTMLInputElement>('dl-header').checked;
      downloadBytes(name + '.bin', withHeader ? withAmsdosHeader(code, meta) : code);
    } else if (fmt === 'dsk') {
      downloadBytes(name + '.dsk', makeDsk(code, meta));
      note.textContent = `Mount it, then: RUN"${name}"`;
    } else if (fmt === 'cdt') {
      downloadBytes(name + '.cdt', makeCdt(code, meta));
      note.textContent = 'Load with RUN""';
    }
    status(`Downloaded ${name}.${fmt}`);
  }

  need<HTMLSelectElement>('dl-format').addEventListener('change', (e) => {
    const fmt = (e.target as HTMLSelectElement).value;
    need('dl-header').parentElement!.hidden = fmt !== 'bin';
  });

  // --- examples and revisions -------------------------------------
  const examplesSel = need<HTMLSelectElement>('examples');
  for (const ex of EXAMPLES) {
    const o = document.createElement('option');
    o.value = ex.id;
    o.textContent = ex.title;
    examplesSel.appendChild(o);
  }
  examplesSel.addEventListener('change', () => {
    const ex = EXAMPLES.find((x) => x.id === examplesSel.value);
    examplesSel.value = '';
    if (ex) { loadSource(ex.source); status(`Loaded example: ${ex.title}`); }
  });

  const revsSel = need<HTMLSelectElement>('revisions');
  function refreshRevisions(select = ''): void {
    revsSel.innerHTML = '<option value="">—</option>';
    for (const r of listRevisions()) {
      const o = document.createElement('option');
      o.value = r.name;
      o.textContent = r.name;
      revsSel.appendChild(o);
    }
    revsSel.value = select;
  }
  refreshRevisions();
  revsSel.addEventListener('change', () => {
    const r = getRevision(revsSel.value);
    if (r) { loadSource(r.source); status(`Loaded revision: ${r.name}`); }
  });
  need('rev-save').addEventListener('click', () => {
    const name = prompt('Name this revision')?.trim();
    if (!name) return;
    saveRevision(name, editor.getValue());
    refreshRevisions(name);
    status(`Saved revision: ${name}`);
  });
  need('rev-delete').addEventListener('click', () => {
    const name = revsSel.value;
    if (!name) return;
    deleteRevision(name);
    refreshRevisions();
    status(`Deleted revision: ${name}`);
  });

  // --- share, screenshot, record ---------------------------------
  need('share').addEventListener('click', async () => {
    history.replaceState(null, '', hashForSource(editor.getValue()));
    try {
      await navigator.clipboard.writeText(location.href);
      status('Share link copied to the clipboard.');
    } catch {
      status('Share link is in the address bar.');
    }
  });

  need('shot').addEventListener('click', async () => {
    const name = (need<HTMLInputElement>('dl-name').value.trim() || 'DEMO').toUpperCase().slice(0, 8);
    downloadBlob(name + '.png', await screenshot(canvas));
  });

  let recorder: Recorder | null = null;
  need('rec').addEventListener('click', async () => {
    const btn = need('rec');
    if (recorder) {
      const blob = await recorder.stop();
      recorder = null;
      btn.textContent = 'Record';
      const name = (need<HTMLInputElement>('dl-name').value.trim() || 'DEMO').toUpperCase().slice(0, 8);
      downloadBlob(name + '.webm', blob);
      status('Saved recording.');
      return;
    }
    recorder = record(canvas);
    if (!recorder) { status('Recording is not supported in this browser.'); return; }
    btn.textContent = 'Stop recording';
    status('Recording…');
  });

  // --- buttons ---------------------------------------------------
  need('assemble').addEventListener('click', () => {
    if (build()) { setRunning(true); paint(); } else setRunning(false);
  });
  need('pause').addEventListener('click', () => setRunning(debug.isPaused()));
  need('reset').addEventListener('click', () => { build(); setRunning(true); paint(); });
  need('restore').addEventListener('click', () => loadSource(DEMO_SOURCE));
  need('dl-go').addEventListener('click', download);
  need('dbg-step').addEventListener('click', () => debug.step());
  need('dbg-over').addEventListener('click', () => debug.stepOver());

  attachKeyboard({
    isEditing: () => editor.hasFocus(),
    onKey: (line, bit, down) => {
      if (timeline.reviewing) return; // ignore live keys while scrubbing history
      machine.setKey(line, bit, down);
      timeline.recordKey(line, bit, down);
    },
  });

  need('dl-header').parentElement!.hidden = true;
  build();
  setRunning(true);
  updateTimeline();
  requestAnimationFrame(tick);
}
