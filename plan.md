# Plan: initial features

## Goal

Make the loop the product: type code, it runs, you send someone a link. The
emulator already works. The value is everything around it.

## Where we are

Phase 1 is done. The rest of this document is the roadmap from here.

- Modular TypeScript, Vite, Vitest. DOM-free emulator, assembler and export cores.
- Assembler: labels, `ORG` `EQU` `DB` `DW` `DS` `ALIGN` `END`, full base set,
  `CB`, `ED` block ops, `IX`/`IY`. Number bases `&FF` `#FF` `0xFF` `nnH` `%1010`.
- CodeMirror editor: Z80 highlighting, error underlines on the assembler's line
  numbers, completion for mnemonics and the program's labels.
- Assembles and runs on idle (300ms debounce). Pause, reset, restore.
- Share by URL hash (`lz-string`). Named revisions in `localStorage`.
- Examples gallery: modes 0/1/2, sprite, scroller, keyboard, the full raster demo.
- Downloads: `.sna`, `.bin` (± AMSDOS header), `.dsk`, `.cdt`. PNG screenshot,
  WebM recording.
- Renderer: canvas 2D, palette snapshotted per scanline.
- No sound. No firmware ROMs. Deployed as static assets on Cloudflare Workers.

### Verification

An opt-in suite (`npm run test:integration`, see `test/integration/README.md`)
checks the CPU core against the SingleStepTests and Cringle exercisers, and the
assembler against rasm/pasmo. `zexdoc` passes 100%; a few undocumented-flag
gaps are baselined.

`.dsk` and `.cdt` are built to spec and structurally tested, but not yet
round-tripped through a real emulator. `.cdt` timings follow 2cdt. The Tier C
MAME check that would close this is designed but not built.

## Phase 2 — better than a text box

- Debugger: breakpoints, step, step-over, registers with flag bits,
  disassembly, memory hex view.
- Frame budget profiler. Attribute T-states per routine, report
  scanlines-per-frame. Show each routine as a bar against the 312 available.
  The most CPC-specific thing we can build — the discipline is racing the beam.
- T-state counts in the editor gutter, with a selection total.
- Screen-address helper: click a pixel, get the address and byte layout.

## Phase 3 — fidelity

- Sound. AY-3-8912 through WebAudio. The biggest gap; CPC demos are half music.
- Firmware ROMs (Amstrad permit redistribution). Unlocks BASIC, AMSDOS, and
  mounting an exported `.DSK` to `RUN"` it in-app — turns export from hoped-for
  into tested in one click. Needs FDC 765 emulation.
- Per-microsecond palette changes for mid-line colour splits. Needs a finer
  renderer than the current per-scanline snapshot.
- Fuller CRTC: R0–R9 effects, split screens, overscan.

## Phase 4 — content tools

- Sprite/tile editor with the 27-colour hardware palette, exporting `db` blocks.
- Font editor. Palette picker showing firmware and hardware numbers side by side.
- Arkos Tracker player integration.

## Assembler work

The core handles the instruction set and nothing above it. For real projects it
needs macros, `REPT`/`IRP`, local labels, conditional assembly, and `INCLUDE`.
Align the syntax with rasm or Maxam — porting existing CPC source matters more
than a nicer dialect.

## Architecture

- Keep the "export standalone HTML" build so single-file sharing still works.
- Move the emulator core into a worker so the UI stays responsive during
  profiling runs.
- Move the renderer to WebGL once per-microsecond palette changes land.

## Settled in Phase 1

- Editor: CodeMirror 6, with the legacy `z80` stream mode.
- Hash compression: `lz-string` (`compressToEncodedURIComponent`).
- Capture: WebM via `MediaRecorder`. No GIF.
- Disc: DATA format only. A SYSTEM-format boot disc for `RUN"DISC"` autoboot is
  a later job (needs a CP/M boot sector and FDC 765 emulation).
