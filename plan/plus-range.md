# Plus range — CPC 464 Plus, CPC 6128 Plus, GX4000

Makes Phase B of [`hardware-variants.md`](hardware-variants.md) concrete. The
464 stays the identity and the default; this adds the three Plus/ASIC machines
as selectable kinds. The **664 is skipped** (tiny library, awkward OS).

## Context

Done: bare metal, Firmware (464), Firmware (6128) with 128K banking, `.dsk` and
`.cdt` in-app. Missing: the entire Plus family. All three share one ASIC (4096
colours, 16 hardware sprites, programmable raster interrupt, soft scroll, DMA
sound) and differ only in RAM, peripherals and how they boot:

| Kind | RAM | Keyboard / FDC / tape | Boot |
| --- | --- | --- | --- |
| `plus464` | 64K | yes | system cartridge → menu / BASIC 1.1 |
| `plus6128` | 128K | yes | system cartridge → menu / BASIC 1.1 |
| `gx4000` | 64K | none (2 joypad ports) | game cartridge directly |

The ASIC stages (2–5) need per-pixel compositing the canvas-2D scanline
renderer can't do cleanly. **The WebGL renderer move is a separate prerequisite
plan** ([`plan.md`](../plan.md) Architecture decisions); this plan lists it as a
dependency for Stages 2+ and keeps each stage's *data model* renderer-agnostic
so the register work lands first.

## The seam

`CPCMachine` is implicitly a 464. Add a kind, chosen at construction, with
464-only sub-objects nullable so the hot paths keep a cheap branch:

```ts
type MachineKind = 'cpc464' | 'cpc6128' | 'plus464' | 'plus6128' | 'gx4000';
makeCPC(kind: MachineKind = 'cpc464')   // m.kind, m.asic: Asic | null, m.cart: Uint8Array[] | null
```

`kind` parameterises RAM128, whether the FDC / keyboard / tape are wired,
whether the ASIC exists, and the boot ROM source. Never add a per-access branch
a 464 pays for: the cartridge/ASIC read overlays hang off `m.cart` /
`m.asic?.pageIn` null-checks in `bus.read` / `bus.write`, the same shape as
today's `m.romLow` / `m.romHigh`.

---

## Stage 0 — machine-kind seam (~2–3 days)

No new hardware; just the scaffolding so later stages are additive.

- `src/cpc/machine.ts` — `makeCPC(kind)`, store `m.kind`; `m.asic = null`,
  `m.cart = null`. `m.reset()` unchanged for the CPC kinds.
- `src/cpc/state.ts` — `MachineState.kind`; `getState` records it, `setState`
  asserts a match (a snapshot is bound to its machine kind). `asic` field added
  as `null` now, populated in Stage 2.
- `src/ui/app.ts` — `machineKind` union widens; `onFirmware()` → `hasBios()`
  (true for every non-bare kind). Disc / Tape rows gate on
  `hasBios() && kind !== 'gx4000'`.
- `src/ui/firmware.ts` → `roms.ts` there renamed conceptually to
  `machine-roms.ts`: `loadMachineRoms(kind)` returns the right ROM/cartridge
  bytes.
- Tests: `test/cpc/machine.test.ts` — kind defaults to `cpc464`; `m.asic` /
  `m.cart` null on the CPC kinds; `setState` rejects a cross-kind snapshot.

**Verify:** `npm test`, `npm run typecheck`. The Machine switch still shows only
the current three options; nothing user-visible changes yet.

---

## Stage 1 — cartridge (`.cpr`) + Plus/GX4000 boot in compatibility mode (~1 week)

Ships: the three kinds appear in the Machine switch and boot `.cpr` cartridges.
Software that never unlocks the ASIC runs correctly; ASIC software boots but
renders as a plain CPC until Stage 2.

### Cartridge format — `src/cpc/cartridge.ts`

RIFF parser: `RIFF` + form type `AMS!`, then `cb00`…`cb1f` chunks of up to 16K
each (up to 32 pages / 512K). Returns `Uint8Array[]` of 16K pages, short final
chunk zero-padded. Rejects a non-`AMS!` file. Mirrors `readCdt` in style.

### Paging — `src/cpc/rom.ts`

`m.cart` (page array) joins `m.roms` as fixed hardware, never snapshotted. When
a cartridge is present `updateRomPaging` serves ROM space from it:

- lower ROM window (`&0000–&3FFF`, enabled) → `cart[0]`
- upper ROM window (`&C000–&FFFF`, enabled) → `cart[romSelect & 0x1f] ?? cart[0]`

(ASIC RMR2 lower-ROM page selection is deferred to Stage 2.)

### Boot ROMs — `src/cpc/roms/`

- **Plus system cartridge** — `plus.cpr` (OS + BASIC 1.1 + cartridge menu).
  **Licensing must be resolved first** (see Decisions). The `plus464` /
  `plus6128` kinds need it for a BASIC prompt.
- **GX4000** needs no system cartridge — games are self-contained. GX4000 +
  homebrew `.cpr` is unblocked regardless of the licensing question, so it can
  ship first.

`installCartridge(m, pages)` in `machine-roms.ts`, sibling to
`installFirmware`: sets `m.cart`, power-on paging, `updateRomPaging`. Reset
vector stays `&0000` (runs cartridge page 0).

### GX4000 profile

`kind === 'gx4000'`: 64K, `m.fdc` inert, no keyboard wiring, boot straight into
the cartridge. Digital joypad (D-pad + 2 fire) maps onto the keyboard-matrix
bits the Plus pads use (`src/cpc/keyboard.ts` gets a GX4000 layout); the second
fire buttons sit on the spare joystick lines.

### UI — `index.html` + `src/ui/app.ts`

- `#machine`: add `CPC 464 Plus`, `CPC 6128 Plus`, `GX4000`.
- **Cartridge** row (like Disc / Tape, shown for the Plus kinds): *Mount
  .cpr…*, *Mount program*, *Eject*. GX4000 with no cartridge shows a prompt.
- `src/export/cpr.ts` — minimal `makeCpr(code, meta)`: page 0 = a short boot
  stub that copies the listing to its `org` and jumps. Enough for *Mount
  program* and GX4000; not a full authoring format. Wire into the Download menu
  as `.cpr` alongside `.dsk` / `.cdt`.

### Tests

- `test/cpc/cartridge.test.ts` — RIFF header, chunk sizes, page count, padded
  last chunk, rejects non-`AMS!`.
- `test/export/cpr.test.ts` — `makeCpr` round-trips through the parser; the
  boot stub lands at page 0.
- `test/integration/emulator/plus-boot.itest.ts` — system cartridge → `Ready`,
  a BASIC 1.1 line runs. Gated on the ROM asset like the existing firmware
  itests.
- `test/ui/app.test.ts` — the three kinds boot without throwing; the Cartridge
  row shows for Plus, hides for GX4000; GX4000 hides Disc / Tape.

**Verify:** `npm run dev` → pick **GX4000**, Mount a homebrew `.cpr`, see it
run. Pick **CPC 6128 Plus**, boot to `Ready`, `CALL` the listing. Cross-check a
`.cpr` boot on WinAPE / Arnold.

---

## Stage 2 — ASIC unlock, register file, 4096-colour palette (~1 week, renderer-dependent)

`src/cpc/asic.ts` — `Asic` on `m.asic` (16K register page as a `Uint8Array`
plus `unlocked` / `pageIn` flags and DMA cursors).

- **Unlock** — the ~17-byte sequence written to the CRTC register-select port
  `&BCxx` (`0xFF,0x00,0xFF,0x77,0xB3,0x51,0xA8,0xD4,0x62,0x39,0x9C,0x46,0x2B,0x15,0x8A,0xCD,0xEE`
  per CPCWiki). Track match progress in the `ports.ts` CRTC branch; a wrong
  byte resets progress. On completion `m.asic.unlocked = true`.
- **Page in** — with the ASIC unlocked, an upper-ROM select of `&B8`–`&BF`
  maps the 16K ASIC page over `&4000–&7FFF`. `bus.read` / `bus.write` gain an
  `if (m.asic?.pageIn && a >= 0x4000 && a < 0x8000)` branch — reads/writes hit
  the register page, not RAM. 464/6128 (`m.asic === null`) skip it.
- **Register map** (offsets into the page, per the ASIC docs):
  `&4000–&4FFF` 16 sprites × 16×16 pixel data (low nibble = pen, 0 =
  transparent); `&6000–&607F` sprite attributes (12-bit X, 12-bit Y,
  magnification); `&6400–&643F` 32 palette entries × 2 bytes, 12-bit
  `GGGGRRRR`/`xxxxBBBB`; `&6800` PRI; `&6801` SPLT; `&6802–&6803` SSA; `&6804`
  SSCR; `&6805` IVR; `&6808–&680F` analogue in; `&6C00–&6C0F` DMA channels + DCSR.
- **Palette data model** — `CPC_PALETTE` stays the 27-colour Gate-Array table.
  Add a per-pen `Uint16Array(17)` of 12-bit RGB beside `linePens`: a GA ink maps
  through the 27-table to 12-bit, an ASIC ink is written direct. The renderer
  reads 12-bit → RGB8 (`nibble * 17`). Widening the renderer to consume this is
  the WebGL plan's job; this stage produces the values and the register writes.
- **State** — `MachineState.asic` (register page + flags + DMA cursors);
  `getState` / `setState` handle it; timeline snapshots grow 16K in Plus mode
  (halve the ring if it bites, as the 128K notes say).
- Tests: `test/cpc/asic.test.ts` — unlock match incl. reset on a bad byte;
  page-in shadows RAM; palette write → expected 12-bit; state round-trip.

---

## Stage 3 — hardware sprites (~1 week, renderer-dependent)

16 sprites composited over the pixel output: 16×16, pens from the 15-entry
sprite palette (upper half of the 32), pen 0 transparent, 0–3× magnification per
axis, signed 12-bit position. Sprite 0 = highest priority.

- Compositing model in `src/cpc/` with a render helper (top-most non-zero sprite
  pixel wins over background). Canvas-2D does it per scanline; the WebGL
  renderer does it per pixel in the shader.
- No new state beyond Stage 2's page.
- Tests: `test/cpc/sprites.test.ts` — placement, magnification, transparency,
  priority order, off-screen wrap, via render asserts.
- Add `src/examples/plus-sprite.asm` once this lands (a bouncing sprite +
  4096-colour gradient) and wire it into the gallery index — but only offered
  when a Plus kind is selected.

---

## Stage 4 — programmable raster interrupt + soft scroll (~1 week)

- `src/cpc/frame.ts` `advance()` becomes ASIC-aware: with `m.asic?.unlocked` and
  `PRI !== 0`, the Z80 interrupt fires at scanline `PRI` (vector from IVR/DCSR
  for IM 2) instead of the fixed 6-per-frame / 52-line Gate-Array cadence. `PRI
  === 0` keeps today's behaviour exactly.
- **Split screen** — at scanline `SPLT` the display base switches to `SSA` for
  the rest of the frame; the per-scanline renderer reads a second base mid-frame.
- **Soft scroll** — `SSCR` shifts the displayed area 0–15 px horizontally, 0–7
  vertically, widening the border to fill. Renderer offset; also update
  `src/debug/screen.ts` to fold in `SSCR` when the ASIC is active, so the
  screen-address helper stays honest.
- Tests: `test/cpc/asic-raster.test.ts` — interrupt at the programmed line; PRI
  0 = legacy cadence; soft-scroll offset in a render assert; split-screen base
  switch.

---

## Stage 5 — DMA sound (~1 week)

3 DMA channels each walk a 16-bit instruction list in RAM synced to the PSG
clock (1 MHz / prescaler): load PSG register pair, pause N ticks, loop, raise
interrupt, stop. Drives `src/cpc/ay.ts` with no CPU cost.

- Channel cursors / prescaler / enable live in `m.asic`. Stepped from `runUntil`
  in `frame.ts` — a `dma.step(dt)` next to `audio.step(dt)` / `tape.advance(dt)`,
  guarded by `m.asic?.dmaActive`. Completion / loop / interrupt raise the ASIC
  interrupt.
- Tests: `test/cpc/asic-dma.test.ts` — a hand-built list writes the expected PSG
  registers over N ticks; pause, loop, stop, interrupt-on-complete.

---

## Stage 6 — GX4000 profile polish (~1–2 days)

- The two analogue joypad ports fully (`&6808…`), the second fire buttons, the
  "no BASIC, boot the cartridge" path confirmed against a real homebrew `.cpr`.
- GX4000 UI: hide Disc / Tape / keyboard help, show a Joypad hint; Mount .cpr is
  the only load path.
- `test/integration/emulator/gx4000-boot.itest.ts` — a small hand-assembled
  `.cpr` boots and paints.

---

## Cross-cutting

- **`snapshotSNA`** — extend to v3 for 128K + a Plus chunk (cartridge id + ASIC
  regs), or keep `.sna` a 64K-only interchange format and rely on `getState`
  for Plus time-travel. Decide when Stage 2 lands.
- **Docs** — `index.html` notes gain a Plus paragraph; the readout shows *ASIC:
  unlocked* and active sprite count once Stage 3 is in.
- **Assembler** — no changes needed. Optionally ship an `equ` include of ASIC
  register names as an example listing.

## Decisions to flag

1. **Plus system-cartridge licensing.** Amstrad's redistribution permission is
   usually cited for "the CPC and Spectrum ROMs". The Plus system cartridge
   (BIOS + BASIC 1.1 + Burnin' Rubber) is less clearly covered — resolve before
   committing `plus.cpr`. GX4000 is unaffected, so **Stage 1 can ship GX4000
   first** and add the computer-Plus BASIC boot once licensing is clear.
2. **Renderer ordering.** Stages 2–5 assume the finer renderer from the
   separate WebGL plan. If it slips, Stage 2's palette model and register file
   still land on canvas-2D (colours approximate); sprites / scroll / split are
   where the scanline renderer bites.
3. **Machine-kind representation** — a string `kind` on `makeCPC` + nullable
   `m.asic` / `m.cart`; not subclasses. Explicit `plus464` / `plus6128` /
   `gx4000` (the ASIC code is shared regardless of RAM size).
4. **`.cpr` export** — import + a minimal `makeCpr` for *Mount program* /
   GX4000; no full authoring export.

## Effort

Stage 0 ~2–3 days · Stage 1 ~1 week (GX4000 path faster) · Stages 2–5 ~1 week
each, renderer-dependent · Stage 6 ~1–2 days. **~5–7 weeks** plus the separate
WebGL renderer move.

## Sources

- CPCWiki: "CPC Plus", "ASIC", "Format:CPR", "Programming:Bank switching".
- Kevin Thacker, "Amstrad CPC Plus / GX4000 Technical Documentation".
- Arnold / WinAPE ASIC register notes.
