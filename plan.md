# Plan

The roadmap and status. Big features get a detailed design doc in `plan/` once
they're about to be built.

## Goal

Make the loop the product: type code, it runs, you send someone a link. Then
make it a place you can *understand* what the machine is doing — debug, trace,
step back, watch memory live.

## Where we are

Phases 1 and 2 are done and deployed. Phase 3 is nearly there: sound, the
firmware ROMs, BASIC and disc all work; cassette and the finer-grained renderer
are what's left.

- Modular TypeScript, Vite, Vitest. DOM-free emulator, assembler, export and
  debug cores.
- Assembler: labels (indented too), `ORG` `EQU` `DB` `DW` `DS` `ALIGN` `END`,
  full base set, `CB`, `ED` (incl. `IND`/`INDR`), `IX`/`IY`, disassembler.
  Bases `&FF` `#FF` `0xFF` `nnH` `%1010`.
- CodeMirror editor: Z80 highlighting, error underlines, symbol completion,
  per-line T-state gutter. Assembles and hot-patches on idle.
- Debugger, time-travel, frame-budget profiler, memory-as-graphics view,
  screen-address helper, instruction trace (see Phase 2).
- Share by URL hash. Named revisions in `localStorage`. Examples gallery.
- Downloads: `.sna`, `.bin` (± AMSDOS header), `.dsk`, `.cdt`. PNG + WebM capture.
- Renderer: canvas 2D, palette snapshotted per scanline.
- Sound: AY-3-8912, synthesised and buffered to Web Audio (Phase 3).
- Firmware: a Machine switch boots the real 464 ROMs to a BASIC `Ready` prompt;
  a minimal 765 FDC and a Disc mount control let AMSDOS `CAT` / `RUN"` a `.dsk`
  in-app (Phase 3). Cassette is still to do.
- Deployed to GitHub Pages and Cloudflare Workers.

### Verification

`npm run test:integration` (opt-in, see `test/integration/README.md`) checks the
CPU against SingleStepTests and the Cringle exercisers, and the assembler
against rasm/pasmo. Documented behaviour is clean: `zexdoc` passes 100%, and
every SingleStepTests opcode passes on registers, memory and documented flags.
Remaining gaps are undocumented `YF`/`XF` bits on SCF/CCF, `BIT n,(HL)`,
`CPI`/`CPD` and `LDIR` — they need a MEMPTR/Q model and are baselined.

`.dsk` now round-trips in-app: `test/integration/emulator/fdc-amsdos.itest.ts`
mounts one built by `makeDsk` and the real AMSDOS ROM `CAT`s and `RUN"`s it.
`.cdt` is still only structurally tested — the equivalent check needs the
firmware tape path ([`plan/cassette.md`](plan/cassette.md)). The Tier C MAME
cross-check stays designed, not built.

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

Done.

- ✅ **Debugger** (`src/debug/debugger.ts`) — breakpoints, step / step-over,
  run-to-address, register + flag view, live disassembly, memory hex. Coherent
  RUNNING / PAUSED / REVIEWING model.
- ✅ **Time-travel** (`src/debug/timeline.ts`) — snapshot ring (~1 min) + input
  log; scrub back, `Live`, `Resume here`.
- ✅ **Hot-swap code** — the debounced assemble patches only changed bytes into
  the running machine; full rebuild on Run / Reset / ORG change.
- ✅ **Memory-as-graphics view** (`src/debug/memview.ts`) — any block as a CPC
  bitmap, mode 0/1/2, linear or interleaved.
- ✅ **Frame-budget profiler** (`src/debug/profiler.ts`) — per-routine T-states
  as scanlines against the 312 available.
- ✅ **T-state gutter** (`src/debug/timing.ts`) — per-instruction cost, `12/8`
  for the conditional ones.
- ✅ **Screen-address helper** (`src/debug/screen.ts`) — hover the screen for the
  byte address and pixel layout.
- ✅ **Instruction trace** (`src/debug/trace.ts`) — opt-in ring of the last 1024
  instructions.

Small follow-ups are listed under Deferred.

## Phase 3 — fidelity

- ✅ **Sound** — AY-3-8912 (ayumi port), synthesised in the emulator, buffered to
  Web Audio via an AudioWorklet. Register writes are sample-accurate. See
  [`plan/sound.md`](plan/sound.md). Firmware `SOUND` works once the ROMs are on.
- ✅ **Firmware ROMs + disc** — the **Machine** switch boots the real 464 firmware
  to a BASIC `Ready` prompt; BASIC checks out (PRINT, RUN, INK, SOUND, CALL); a
  minimal 765 FDC ([`plan/fdc.md`](plan/fdc.md)) plus a **Disc** mount control
  let AMSDOS `CAT` and `RUN"` a disc — the current listing or a `.dsk` from your
  machine. Plans: [`plan/rom.md`](plan/rom.md),
  [`plan/rom-boot-findings.md`](plan/rom-boot-findings.md).
- **Cassette `RUN""`** — emulate the bit-banged tape port so an exported `.cdt`
  loads in-app, the tape equivalent of the disc mount. Not scheduled; design
  sketch in [`plan/cassette.md`](plan/cassette.md).
- **Per-microsecond palette changes** for mid-line colour splits. Needs a finer
  renderer than the per-scanline snapshot. Pairs with the WebGL renderer move
  (see Architecture decisions).
- **Fuller CRTC** — R0–R9 effects, split screens, overscan.

## Phase 4 — content tools

- Sprite/tile editor with the 27-colour hardware palette, exporting `db` blocks.
- Font editor. Palette picker showing firmware and hardware numbers side by side.
- Arkos Tracker player integration.

## Hardware variants

The 464 is the identity. Also running **6128** (128K, BASIC 1.1 — a week's work,
high return) and the **Plus / GX4000** ASIC (4096 colours, hardware sprites,
raster interrupts, DMA sound — a multi-week, renderer-heavy project best done
after the WebGL move). Sketch: [`plan/hardware-variants.md`](plan/hardware-variants.md).
Not scheduled.

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

- **Seam 3** (above) — CPU as a class + the interpreter perf win. ~2× throughput,
  its own PR.
- **Tier C integration test** — load `.sna`/`.dsk`/`.cdt` into headless MAME
  `cpc6128` and assert the program took over the screen. Design in
  `test/integration/README.md` ("Tier C"); not built. `fdc-amsdos.itest.ts` now
  covers `.dsk` in-app, which was the main motivation.
- **Renderer cross-check** — MAME's framebuffer vs ours, pixel for pixel.
- **Phase 2 follow-ups** — profiler rolled up to top-level routines; a
  selection-total on the T-state gutter; live editing in the memory-as-graphics
  view.

## Settled

- Editor: CodeMirror 6, legacy `z80` stream mode.
- Hash compression: `lz-string`.
- Capture: WebM via `MediaRecorder`. No GIF.
- Disc: the exporter writes DATA format only, and the FDC ([`plan/fdc.md`](plan/fdc.md))
  is minimal — standard `.dsk`, no weak sectors or copy protection. Extended
  `.dsk`, protected images and SYSTEM-format autoboot are later upgrades if a
  real need turns up.
- Conformance testing: SingleStepTests is the gate; zexdoc/zexall are opt-in.
