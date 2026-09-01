# Firmware ROMs + disc

## What it unlocks

- Boot to a BASIC `Ready` prompt — type BASIC, `LOAD`, `RUN`.
- Mount an exported `.dsk` and `RUN"NAME"` it **in-app** — turns the disc export
  from "hope it works" into "tested in one click", closing the last "not
  verified on hardware" gap.
- Firmware `SOUND`, `INK`, text output, the `KM`/`TXT`/`GRA`/`SCR` jumpblock —
  so listings that use firmware calls (most non-demoscene code) run.
- Cassette `RUN"` for `.cdt` (via the firmware's own tape routines).

## The size of this

This is not "add ROM paging". It is **make the hardware model complete enough
that Amstrad's OS runs on it.** Our emulator today is tuned for code that pages
the ROMs out and talks to bare metal. The firmware does none of that — it reads
the keyboard through the PSG, leans on CRTC and PPI behaviour we shortcut, runs
a 300 Hz timer, and expects its RAM workspace to survive. Getting it to the
`Ready` prompt is a phase, not a PR, and the honest first step is a **spike**:
load the ROMs, wire paging, run, and see where it dies.

## Which machine

**CPC 464 + DDI-1** — matches our identity, no RAM banking.

| | 464 + DDI-1 | 6128 |
| --- | --- | --- |
| BASIC | 1.0 | 1.1 (nicer) |
| Disc | expansion (AMSDOS = ROM 7) | built in |
| RAM | 64K | 128K — needs bank switching (`&7Fxx` RAM config) |

Going 6128 would make disc "built in" but adds real RAM-banking work. Stay 464.

## The ROMs

- `cpc464.rom` — 32K: lower 16K (OS 1.0) + upper 16K (BASIC 1.0).
- `amsdos.rom` — 16K: the DDI-1 DOS, seen as upper ROM 7.

Amstrad (Cliff Lawson, 1990s) permit redistribution of the ROM images bundled
with an emulator; every CPC emulator ships them. Commit them under
`src/cpc/roms/`, note the permission + retained copyright in `NOTICE`.

**Bundling:** `import romUrl from './roms/cpc464.rom?url'` + `fetch(romUrl)` at
startup. 32K + 16K assets, works on the Pages deploy. The "export standalone
HTML" build would need a base64 variant — defer that.

## ROM paging

Gate Array ROM/Mode register (`&7Fxx`, `%10xxxxxx`): bit 2 = lower ROM disable,
bit 3 = upper ROM disable, bits 0–1 = mode. ROM-select latch (`&DFxx`) picks the
upper ROM number (0 = BASIC, 7 = AMSDOS).

- Reads `&0000–&3FFF`: lower ROM if enabled, else RAM.
- Reads `&C000–&FFFF`: the selected upper ROM if enabled, else RAM.
- **Writes always go to RAM** — that's how you draw to `&C000` with BASIC paged in.

`bus.read` is the hottest path. Keep the RAM case fast: two nullable fields,
`m.romLow` / `m.romHigh`, holding the *currently visible* ROM for each region
(null = RAM visible). Updated only on a paging change (rare).

```
read: (a) => {
  const lo = m.romLow;  if (lo && a < 0x4000)  return lo[a];
  const hi = m.romHigh; if (hi && a >= 0xc000) return hi[a & 0x3fff];
  return m.ram[a];
}
```

When no ROMs are loaded (or both paged out — every current demo), both fields
are null: two null checks, then the existing path. Benchmark the read hit;
expect ~5–10%, well inside our headroom.

Power-on config changes: real 464 boots with the lower ROM **enabled** (so the
firmware runs). Our default `gaConfig = 0x8d` (both off) is only right for the
no-ROM world; with ROMs, default to firmware-on and let `.sna`/examples page
out as they already do.

## Disc

A **minimal µPD765A FDC** — enough for AMSDOS and simple loaders, not the full
chip.

- Ports: `&FB7E` main status register (read), `&FB7F` data register (r/w),
  `&FA7E` motor on/off.
- Command → execution → result state machine. Implement: Specify, Recalibrate,
  Seek, Sense Interrupt Status, Sense Drive Status, Read ID, Read Data,
  Write Data, Format Track.
- Execution-phase data transfer by MSR polling (AMSDOS polls; it does not use
  the FDC interrupt line on the CPC).
- Backed by a **drive model** that reads/writes sectors in our standard `.dsk`
  image (`src/export/dsk.ts` already builds them; add a reader).

Full FDC (weak sectors, copy-protection, `.dsk` Extended format, real timing)
is a later upgrade for protected games.

## AMSDOS

With the AMSDOS ROM present as ROM 7 and the FDC emulated, AMSDOS initialises
itself: on firmware ROM-scan it hooks the cassette-in/out vectors so
`LOAD`/`SAVE`/`RUN"` go to disc. The `.dsk` we mount then works with
`RUN"NAME"` because AMSDOS does its own directory walk and sector reads through
the FDC — the same path a real machine takes. No AMSDOS-internal patching if
the FDC is faithful enough.

Fallback if the FDC proves too fiddly: **trap AMSDOS's disc entry points** and
service reads/writes in JS directly against the `.dsk`. Less authentic (demos
with their own FDC loaders won't work) but a fraction of the code. Decide after
the FDC spike.

## PR breakdown

Rough; re-plan after the spike.

1. **ROM paging** — `bus.read` ROM-awareness, `m.romLow`/`m.romHigh`, the
   `&7Fxx` bit 2/3 and `&DFxx` decode, power-on config. `getState`/`setState`
   already cover `gaConfig`/`romSelect`; add ROM contents? No — ROMs are fixed,
   not state. Tests: paging in/out, writes-through, read benchmark.
2. **Load + boot spike** — bundle `cpc464.rom`, fetch at startup, boot with no
   disc, screenshot where it gets to. Deliverable is a **findings note**, not a
   feature.
3. **Firmware hardware gaps** — whatever the spike surfaces: PSG keyboard read
   (R14), PPI details, CRTC registers the screen driver needs, the 300 Hz
   timer, `HALT` behaviour. Likely several PRs.
4. **`Ready` prompt** — keyboard input reaches BASIC, text output renders,
   `PRINT` works. A "Machine" switch in the UI: *bare* (today) vs *firmware*.
5. **Minimal FDC 765** — `src/cpc/fdc.ts` + a `.dsk` sector reader. Tests
   against a `.dsk` we build ourselves: Read ID, Seek, Read Data return the
   right bytes.
6. **AMSDOS + mount** — AMSDOS as ROM 7; a "mount disc" control; `RUN"` an
   exported `.dsk`. This is the payoff and the Tier-C-without-MAME check.
7. **Cassette via firmware** — `.cdt` `RUN"` through the firmware tape routines.

## Decisions to flag

- **Commit the ROMs** (redistribution-permitted, universal emulator practice) or
  fetch-by-script (keeps binaries out of git, but the deploy needs them). Lean
  commit.
- **Minimal FDC vs AMSDOS trap** — decide after PR 5's spike.
- **Standalone-HTML** loses ROMs unless we add a base64 build variant — defer.
- **Scope creep risk** — "boot the firmware" can absorb weeks. Timebox the spike;
  if the gap is large, ship the FDC-trap fallback for `.dsk` testing and leave a
  full firmware boot as its own project.

## Effort

PR 1 ~1 day. PR 2 (spike) ~1–2 days. PR 3 unknown until the spike — days to
weeks. PR 5 ~2–3 days. Everything else depends on PR 3. This is the largest item
on the roadmap.
