# WebGL renderer + per-microsecond palette

Prerequisite for [`plus-range.md`](plus-range.md) Stages 2+. Two things the
canvas-2D scanline renderer can't do: mid-line colour splits (it snapshots the
palette once per scanline) and per-pixel sprite compositing at 50fps.

## Principles

- **The software renderer stays.** `renderFrame` in `src/cpc/video.ts` remains
  the reference implementation and the test path — every `m.render(rgba)` test
  keeps working. WebGL is a UI-only fast path in `src/ui/`, selected when
  available, with the software renderer as the fallback.
- **The core stays authoritative for state.** The renderer consumes a
  read-only *frame description*; it never drives the machine.
- **Keep the standalone-HTML build.** Shader source inlines as a string.

## Stage 1 — renderer seam (~2–3 days)

Extract the boundary without changing behaviour.

- `src/cpc/video.ts` — `renderFrame(m, rgba)` unchanged, but pull the pixel loop
  to read a `FrameView` (below) instead of poking `m.crtc` / `m.linePens` /
  `m.ram` directly. `m.render` builds the view and calls it.
- `src/ui/renderer.ts` (new) — `interface Renderer { draw(m: CPCMachine): void; resize(): void; dispose(): void }` and `createRenderer(canvas): Renderer`.
  For now it wraps the current `machine.render(rgba)` + `ctx.putImageData`.
- `src/ui/app.ts` — `paint()` calls `renderer.draw(machine)` instead of the
  inline `render` + `putImageData`. `capture.ts` unchanged (reads the canvas).
- Tests: unchanged. Add `test/ui/renderer.test.ts` — the software renderer wrap
  paints a non-empty canvas under happy-dom's stubbed 2D context.

**Verify:** `npm test`, `npm run dev` — pixel-identical to now.

## Stage 2 — frame description (~3 days)

`src/cpc/frameview.ts` (new) — a plain typed-array struct the core fills once
per frame and any renderer consumes:

```ts
interface FrameView {
  ram: Uint8Array;               // 64K screen source (live ref; renderer must not write)
  crtcPerLine: Uint8Array;       // R1/R6/R12/R13/mode packed, LINES_PER_FRAME rows
  paletteLog: Int32Array;        // (cycle, pen, value) triples, frame-relative T-states
  paletteLogLen: number;
  modeLog: Int32Array;           // (cycle, mode) pairs
  modeLogLen: number;
  border: { x: number; y: number };
}
```

- Software `renderFrame` consumes `FrameView` (replay the logs per scanline for
  now — identical output to today's `linePens`).
- `getState` / `setState` unaffected — the view is derived, not stored.

## Stage 3 — per-microsecond palette (~4 days)

The correctness win. Also on the `plan.md` list ("Fuller CRTC — mid-line
splits"). Renderer-independent.

- `src/cpc/ports.ts` — every Gate-Array pen write (`case 0x40`) and mode write
  (`case 0x80`) appends `(m.frameCycles-relative cycle, pen, value)` to
  `m.paletteLog` / `m.modeLog` (pre-sized ring, cleared at frame start in
  `frame.ts`).
- `src/cpc/frame.ts` — drop the per-line `m.linePens.set(m.pens, …)`; keep
  `m.pens` as the live palette. Frame start clears the logs.
- `src/cpc/video.ts` — walk the palette log by cycle: for each rendered
  character cell (1µs = 4 T-states, its screen X/Y → cycle) the palette state is
  the last log entry at or before that cycle. Binary search or a running cursor
  (the log is append-ordered).
- `MachineState` — replace `linePens` with `paletteLog` + `modeLog` (+ lengths).
  Timeline snapshots shrink slightly. `snapshotSNA` unaffected (it never carried
  `linePens`).
- **Migration:** `test/cpc/frame.test.ts` line 50 reads `m.linePens` — rework to
  read the palette log, or expose a `paletteAt(line, char)` helper for tests.
- Tests: `test/cpc/palette-split.test.ts` — a program that changes ink 0 twice
  within one scanline renders two colours on that row (the current renderer
  shows one).

**Verify:** the raster examples look unchanged; a new mid-line-split example
shows the split where a real CPC would.

## Stage 4 — WebGL path (~1.5 weeks)

`src/ui/gl/` — `WebGLRenderer implements Renderer`. WebGL2 (integer textures);
fall back to the software renderer if unavailable (or under happy-dom).

- **Textures per frame:** screen RAM as `R8UI` 256×256; `paletteLog` and
  `modeLog` as `RG32I` / `R32I`; `crtcPerLine` as a small `RGBA8UI`.
- **One draw call.** Fragment shader per output pixel: undo line-doubling and
  border → displayed (x, y) → CRTC base/offset/interleave → byte address →
  fetch RAM byte → decode pen for the mode-as-of-cycle → palette lookup
  as-of-cycle → 27-colour table (GA) or direct 12-bit (ASIC, Stage 5) → RGB.
- **Palette texture:** the 27-colour Gate-Array table as a 32×1 `RGBA8`
  constant; ASIC 4096-colour handled in Stage 5.
- `createRenderer` prefers WebGL2, catches context-creation failure, logs once,
  uses software.
- **Capture** — `screenshot` / `record` read the live canvas; set
  `preserveDrawingBuffer: true` (or blit to a 2D canvas for `toBlob`). Confirm
  `captureStream` works on the WebGL canvas.
- Tests: `test/ui/gl/shader-math.test.ts` — port the address/pen/palette math to
  a plain TS function shared with the shader (GLSL generated from it or kept in
  sync) and assert it matches `video.ts` for the example gallery, pixel for
  pixel. happy-dom has no WebGL, so the GL wrapper itself gets a stub-context
  smoke test only.

**Verify:** `npm run dev` on a WebGL2 browser — identical picture, lower CPU;
force-disable WebGL and confirm the software fallback.

## Stage 5 — ASIC compositing hooks (~1 week, with plus-range Stages 2–4)

Consumed by the Plus stages, not shipped alone.

- **4096-colour palette** — `FrameView` gains a 12-bit per-pen palette log (from
  the ASIC palette registers); shader outputs `nibble*17` per channel. Software
  renderer gets the same via a widened `paletteAt`.
- **Hardware sprites** — a sprite texture (16×16×16, `R8UI`) + attributes UBO
  (position, magnification, priority). Shader: after the background pixel, test
  sprites 0→15, first non-zero pen wins. Software renderer: a per-scanline
  sprite pass (slower; test path).
- **Split screen + soft scroll** — `crtcPerLine` already carries the base; add
  the `SSCR` pixel offsets and the split base switch. Shader applies the offset;
  `src/debug/screen.ts` reads the same offsets.

## Order and dependencies

```
Stage 1 renderer seam ─┐
Stage 2 frame view ────┼─► Stage 4 WebGL path ─► Stage 5 ASIC hooks
Stage 3 per-µs palette ┘                          (with plus-range 2–4)
```

Stages 1–3 are renderer-independent and worth landing regardless; Stage 3 is a
visible correctness improvement on its own.

## Decisions

- **WebGL2 required for the fast path** (integer textures); no WebGL1 shim —
  software fallback covers old browsers.
- **Software renderer is never removed** — reference + test oracle + fallback.
- **Shader math has a TS twin** so it is unit-tested against `video.ts` rather
  than trusted blind.
- **Capture** stays canvas-based; `preserveDrawingBuffer` if `toBlob` needs it.

## Effort

Stage 1 ~2–3 days · Stage 2 ~3 days · Stage 3 ~4 days · Stage 4 ~1.5 weeks ·
Stage 5 ~1 week (folded into plus-range). **~3–4 weeks** for Stages 1–4.

## Sources

- CPCWiki: "Gate Array", "CRTC", "Video modes", "CPC Plus" (ASIC palette /
  sprite registers).
- WebGL2 integer-texture usage — MDN `WebGL2RenderingContext`.
