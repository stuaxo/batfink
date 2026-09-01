# Plan

## Goal

Make the loop the product: type code, it runs, you send someone a link. Then
make it a place you can *understand* what the machine is doing — debug, trace,
step back, watch memory live.

## Where we are

Phase 1 is done and deployed.

- Modular TypeScript, Vite, Vitest. DOM-free emulator, assembler and export cores.
- Assembler: labels, `ORG` `EQU` `DB` `DW` `DS` `ALIGN` `END`, full base set,
  `CB`, `ED` (incl. `IND`/`INDR`), `IX`/`IY`. Bases `&FF` `#FF` `0xFF` `nnH` `%1010`.
- CodeMirror editor: Z80 highlighting, error underlines, symbol completion.
  Assembles and runs on idle.
- Share by URL hash. Named revisions in `localStorage`. Examples gallery.
- Downloads: `.sna`, `.bin` (± AMSDOS header), `.dsk`, `.cdt`. PNG + WebM capture.
- Renderer: canvas 2D, palette snapshotted per scanline.
- No sound. No firmware ROMs. Deployed to GitHub Pages and Cloudflare Workers.

### Verification

`npm run test:integration` (opt-in, see `test/integration/README.md`) checks the
CPU against SingleStepTests and the Cringle exercisers, and the assembler
against rasm/pasmo. Documented behaviour is clean: `zexdoc` passes 100%, and
every SingleStepTests opcode passes on registers, memory and documented flags.
Remaining gaps are undocumented `YF`/`XF` bits on SCF/CCF, `BIT n,(HL)`,
`CPI`/`CPD` and `LDIR` — they need a MEMPTR/Q model and are baselined.

`.dsk` and `.cdt` are built to spec and structurally tested but not yet
round-tripped through a real emulator (the Tier C MAME check is designed, not
built). Firmware ROMs (Phase 3) would let us test them in-app instead.

## The seams

Small changes to the core that every Phase 2 feature needs. Each costs nothing
when unused so the demo still runs at 50fps on a phone.

1. ✅ **`getState()` / `setState()`** (`src/cpc/state.ts`) — a machine snapshot
   as a plain object. `snapshotSNA` stays as the interchange format.
2. ✅ **`runUntil(cpu, m, condition) → StopReason`** — the stepping primitive
   behind the frame loop and the debugger. `runFrame` is a wrapper.
3. ⏳ **Shape the CPU as a class** (not `{…} as unknown as Z80`) + the half-day
   interpreter win (locals for hot fields, direct `Uint8Array` path). ~2×
   throughput, no new toolchain. Deferred — its own PR.
4. ✅ **Bus write observer** (`m.onWrite`) — null in run mode; watchpoints and
   dirty-region tracking.
5. ✅ **Disassembler** (`src/asm/disasm.ts`) — round-trips the whole opcode set.
6. ✅ **Keyboard input log** — via the `onKey` callback in `keyboard.ts`, feeding
   `Timeline`.

## Phase 2 — better than a text box

- ✅ **Debugger** (`src/debug/debugger.ts`) — breakpoints, step / step-over,
  run-to-address, register + flag view, live disassembly, memory hex.
- ✅ **Time-travel** (`src/debug/timeline.ts`) — snapshot ring + input log;
  scrub back, `Live`, `Resume here`.
- **Live memory views** — generalise `renderFrame` to
  `(mem, cpuState, params) → pixels | text`; register several: CPC screen, hex,
  tile/sprite grid at any address, font, PSG registers. Editing writes back
  through `m.onWrite`.
- **Hot-swap code** — reassemble, diff against the last `bytes`/`used`, patch
  changed bytes at a frame boundary. No reset. Length changes pad/truncate
  within the instruction's footprint or refuse.
- **Frame-budget profiler** — attribute T-states per routine, show each as a bar
  against the 312 scanlines. The most CPC-specific thing we can build.
- **T-state counts in the editor gutter**, with a selection total. (disassembler
  + the assembler listing we already have)
- **Screen-address helper** — click a pixel, get the address and byte layout.
- **Trace** — a ring buffer of the last N instructions (PC + register delta),
  dumped on a breakpoint.

## Phase 3 — fidelity

- **Sound** — AY-3-8912 through WebAudio. The biggest gap; CPC demos are half
  music.
- **Firmware ROMs** (Amstrad permit redistribution). Unlocks BASIC and AMSDOS,
  and mounting an exported `.dsk`/`.cdt` to `RUN"` it in-app — closes the
  "not verified on hardware" gap. Needs FDC 765 emulation.
- **Per-microsecond palette changes** for mid-line colour splits. Needs a finer
  renderer than the per-scanline snapshot.
- **Fuller CRTC** — R0–R9 effects, split screens, overscan.

## Phase 4 — content tools

- Sprite/tile editor with the 27-colour hardware palette, exporting `db` blocks.
- Font editor. Palette picker showing firmware and hardware numbers side by side.
- Arkos Tracker player integration.

## Assembler track (independent)

Macros, `REPT`/`IRP`, local labels, conditional assembly, `INCLUDE`. Align the
syntax with rasm or Maxam — porting existing CPC source matters more than a
nicer dialect. The differential tests guard against regressions.

## Architecture decisions

- **Core stays JavaScript.** It runs 40× faster than the machine it emulates;
  the project's value is transparent, hookable tooling, which is JS's strength
  and WASM's friction. If replay or batch analysis later proves too slow, add a
  WASM fast-core *behind* the `getState`/`runUntil` interface — never a rewrite.
- Keep the "export standalone HTML" build so single-file sharing works.
- Move the core into a worker when profiling/tracing load justifies it;
  `SharedArrayBuffer` for RAM lets UI-thread views read memory synchronously.
- Move the renderer to WebGL once per-microsecond palette changes land — that's
  a tight numeric loop with no host hooks, unlike the CPU.

## Deferred

- Tier C integration test — load `.sna`/`.dsk`/`.cdt` into headless MAME
  `cpc6128`, assert the program took over the screen. Designed in
  `.claude/plans/`; not built.
- Renderer cross-check (MAME output vs ours).

## Settled

- Editor: CodeMirror 6, legacy `z80` stream mode.
- Hash compression: `lz-string`.
- Capture: WebM via `MediaRecorder`. No GIF.
- Disc: DATA format only. SYSTEM-format autoboot (`RUN"DISC"`) needs a CP/M boot
  sector and FDC 765 — a Phase 3 job.
- Conformance testing: SingleStepTests is the gate; zexdoc/zexall are opt-in.
