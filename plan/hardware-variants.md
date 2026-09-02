# Hardware variants — 6128 and the Plus range

Not scheduled. Design sketch. The 464 is the identity and stays the default;
this is about *also* running 6128 and Plus/GX4000 software.

## What it unlocks

- **6128** — BASIC 1.1 (nicer: `FILL`, `MASK`, `FRAME`, `GRAPHICS PAPER`,
  windowed `PRINT`), and the large library of disc software that assumes 128K.
  Small model change, high return.
- **Plus / GX4000** — the ASIC: 4096 colours, 16 hardware sprites, programmable
  raster interrupts, pixel-smooth scrolling, DMA sound. A whole category of
  later games and demos (Burnin' Rubber, Pang, Navy Seals, Plus-only demos).
  A large, renderer-heavy project.
- **664** — skip. Tiny library, awkward OS between 464 and 6128.

## The model

`CPCMachine` is implicitly a 464 today. Add a machine kind, chosen at
construction:

```ts
type MachineKind = 'cpc464' | 'cpc6128' | 'plus' | 'gx4000';
makeCPC(kind = 'cpc464')
```

`kind` parameterises: RAM size, whether the Gate Array RAM-config register does
anything, which firmware loads, whether the ASIC exists, a few CRTC/timing
details. Keep the **seam pattern**: 464-only fields (`m.banking`, `m.asic`) are
`null` on a 464 and the hot paths keep a fast branch, so the demo still runs at
50fps on a phone. Where an indirection can't be a cheap null-check (RAM
banking), swap the `bus.read`/`bus.write` implementation on `makeCPC` by kind
rather than branch per access — the same trick the ROM read path can use.

`getState`/`setState` and `MachineState` grow the extra RAM and the new
register blocks. `snapshotSNA` already carries `ramConfig`; extend to SNA v3 for
128K if we want cross-emulator 6128 snapshots.

---

## Phase A — CPC 6128

Two tiers. Spike done: the 6128 firmware **already boots to `Ready` on the
current 64K model** — banner, BASIC 1.1, interrupts, mode all fine — and writes
the RAM-config register exactly once, config 0 (straight mapping, already a
no-op for us). So:

### A0 — minimal 6128 ✅

Boots BASIC 1.1; runs anything that stays in the base 64K (most type-ins, a lot
of disc software).

- `src/cpc/roms/cpc6128.rom` committed (OS 3.1 + BASIC 1.1, 32K — splits like
  `cpc464.rom`, `installFirmware` unchanged).
- `src/ui/firmware.ts` fetches per `FirmwareKind`; the Machine select is
  *Bare metal* / *Firmware (464)* / *Firmware (6128)*.
- `test/integration/emulator/boot-6128.itest.ts` — the 128K banner, `Ready`,
  a BASIC 1.1 program runs.

### A1 — full 128K (~2–4 days on top)

Needed for 128K games, demos, and BASIC that uses the extra banks.

1. **RAM banking** (`src/cpc/banking.ts`). The Gate Array RAM-config register
   (`&7Fxx`, `%11xxxxxx` — the `case 0xc0` branch in `ports.ts`, currently just
   stored) selects one of 8 configurations for the four 16K logical pages. The
   standard C3 table:

   | cfg | &0000 | &4000 | &8000 | &C000 |
   | --- | --- | --- | --- | --- |
   | 0 | 0 | 1 | 2 | 3 |
   | 1 | 0 | 1 | 2 | 7 |
   | 2 | 4 | 5 | 6 | 7 |
   | 3 | 0 | 3 | 2 | 7 |
   | 4–7 | 0 | 4–7 | 2 | 3 |

   Bank numbers 0–3 are the base 64K, 4–7 the second 64K. Model: one 128K
   `Uint8Array` plus a 4-entry offset table recomputed on a config write.
   `bus.read`/`write` index through it. Config 0 gives `[0, 0x4000, 0x8000,
   0xC000]` — identical to the 464 today, so a 464 uses the plain path and only
   a 6128 gets the mapped one. Benchmark the mapped path; expect a few percent.

2. **128K RAM** in `getState`/`setState` and `MachineState`; a bank selector in
   the memory-as-graphics view and the debugger hex dump for &4000–&7FFF.

3. **Tests**. `test/cpc/banking.test.ts` — the 8 configs map the right physical
   bytes, writes land in the mapped bank, a 464 is unaffected.
   `test/integration/emulator/banking-6128.itest.ts` — from BASIC 1.1, a
   `|BANKOPEN` / poke sequence writes and reads back the second 64K.

---

## Phase B — Plus range and GX4000

Multi-week. Best done **after** the renderer moves to WebGL (see the
Architecture decisions in `plan.md` and the deferred per-microsecond palette) —
B3 and B4 need per-pixel compositing that the canvas-2D scanline renderer can't
do cleanly.

- **B1 — Cartridge (`.cpr`)**. A RIFF parser (`RIFF/AMS!` + `cbNN` 16K chunks,
  up to 32 pages / 512K). Cartridge pages map like the upper ROM; the lower ROM
  region can be a cartridge page too. Needed even to boot a Plus — the Plus BIOS
  and BASIC 1.1 live on the *system cartridge*, not a masked ROM.

- **B2 — ASIC unlock + registers** (`src/cpc/asic.ts`). The 17-byte unlock
  sequence written to the CRTC-select port (`&BCxx`); once unlocked, an upper
  ROM select of `&B8..&BF` maps the 16K ASIC register/sprite page at
  `&4000–&7FFF`, shadowing RAM. The register map: 16 sprites (X/Y, magnification,
  16×16×4bpp pixel data), a 32-entry 12-bit palette, PRI (raster interrupt
  scanline), SSCR (soft scroll — pixel H/V offset and border width), IVR
  (interrupt vector), the DMA channel registers, the analogue inputs, DCSR.

- **B3 — 4096-colour palette**. `CPC_PALETTE` is a fixed 27-colour table indexed
  `pen & 0x1f`; `linePens` is one byte per pen. Widen to 12-bit RGB values and a
  per-pen `Uint16Array`. Gate Array inks still map through the 27-colour table;
  ASIC inks are direct 12-bit. Pairs with the WebGL renderer move.

- **B4 — Hardware sprites**. 16 sprites, 16×16, 15 colours + transparent, 0–3×
  magnification, composited over the pixel output with the sprite palette
  (separate 15 entries). Renderer work; a compositing pass per scanline or in
  the shader.

- **B5 — Programmable raster interrupt + soft scroll**. PRI fires a Z80
  interrupt at a chosen scanline instead of the fixed 6-per-frame Gate Array
  interrupt; the frame loop's interrupt generation (`src/cpc/frame.ts`) becomes
  ASIC-aware. SSCR shifts the displayed area by pixels and widens the border.

- **B6 — DMA sound**. 3 DMA channels walk lists of `(register, value)` pairs in
  RAM synced to the PSG clock, driving `src/cpc/ay.ts` automatically —
  "hardware" music with no CPU cost. Steps from the frame loop next to
  `AudioSink`.

- **B7 — GX4000 profile**. 64K RAM, no keyboard / FDC / cassette, boots the
  game cartridge directly. Mostly a config once B1–B6 exist, plus the two analogue
  joypad ports.

---

## Renderer implications

Phase B forces the WebGL renderer that `plan.md` already earmarks for
per-microsecond palette changes. Sensible order: **6128 → WebGL renderer +
per-µs palette → Plus**. The Plus palette, sprites and soft-scroll then land on
a renderer built for them.

## Decisions to flag

- **Machine-kind representation** — a `MachineKind` string on `makeCPC`, with
  `m.banking` / `m.asic` as nullable sub-objects (seam pattern). Not subclasses.
- **Keep the 464 fast path** — swap `bus.read`/`write` by kind at construction;
  never add a per-access branch that a 464 pays for.
- **Plus firmware licensing** — Amstrad's redistribution permission is usually
  cited for "the CPC and Spectrum ROMs". Whether it covers the Plus *system
  cartridge* (BIOS + BASIC 1.1) is less clear than the plain CPC ROMs. Check
  before bundling; the computer Plus models need it, GX4000 does not.
- **6128 SNA** — extend `snapshotSNA` to v3 for 128K, or keep `.sna` as a
  64K-only interchange format and rely on `getState` for 128K time-travel.
- **`.cpr` export** — probably not; niche. Import only.

## Effort

6128: A0 minimal ✅. A1 full 128K ~2–4 days. WebGL renderer + per-µs palette —
its own project. Plus ~4–8 weeks on top, B1–B6 each roughly a week, B7 a day.
GX4000 falls out of Plus.

## Sources

- 6128 RAM banking (C3 table) and Gate Array — CPCWiki "Gate Array",
  "Programming:Bank switching".
- Plus ASIC — Kevin Thacker's "Amstrad CPC Plus / GX4000 Technical
  Documentation"; the ASIC register list on CPCWiki ("CPC Plus").
- `.cpr` format — CPCWiki "Format:CPR".
