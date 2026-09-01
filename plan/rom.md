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

The spike ([`rom-boot-findings.md`](rom-boot-findings.md)) settled the open
question: the 464 firmware boots to `Ready` and takes keyboard input on the
hardware model we already have, with only ROM paging added. Getting BASIC
running is now small. The bulk of the remaining work is the **disc** side — a
µPD765A FDC and AMSDOS — so an exported `.dsk` can be `RUN"` in-app.

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

1. ✅ **ROM paging** (`src/cpc/rom.ts`) — ROM-aware `bus.read`, `m.romLow`/
   `m.romHigh` derived by `updateRomPaging` from the `&7Fxx` bit 2/3 and `&DFxx`
   decode; `setState` re-derives them. ROM contents are fixed hardware, not
   snapshotted. No images load yet, so behaviour is unchanged. Read hit measured
   ~12% on the demo (43→38× realtime) — inside headroom. Power-on config stays
   `&8D` (both off); the firmware-on default lands with PR 2's boot.
2. ✅ **Load + boot spike** (`src/cpc/roms.ts`, `installFirmware`) — committed
   `cpc464.rom` + `amsdos.rom`, booted with no disc. Result: reaches the BASIC
   `Ready` prompt and takes keyboard input, unchanged hardware model. Full
   findings: [`rom-boot-findings.md`](rom-boot-findings.md). **The "firmware
   hardware gaps" risk is retired** — the old PR 3 collapses into PR 4's
   shakedown.
3. ✅ **UI "Machine" switch** (`src/ui/firmware.ts`, `#machine` select) — *bare*
   vs *firmware (464)*. Fetches the ROM assets (`?url` + `fetch`, cached),
   `installFirmware`, boots from &0000; the assembled listing loads at its `org`
   for `CALL` from BASIC. Debugger/time-travel/downloads unchanged.
4. **BASIC shakedown** — enter and `RUN` a program; `PRINT`, `INK`, `LOCATE`,
   firmware `SOUND`. Fix whatever the firmware trips on (expected small).
5. **Minimal FDC 765** — `src/cpc/fdc.ts` + a `.dsk` sector reader. Tests
   against a `.dsk` we build ourselves: Read ID, Seek, Read Data return the
   right bytes.
6. **AMSDOS + mount** — AMSDOS as ROM 7; a "mount disc" control; `RUN"` an
   exported `.dsk`. This is the payoff and the Tier-C-without-MAME check.
7. **Cassette via firmware** — `.cdt` `RUN"` through the firmware tape routines.

## Decisions to flag

- ✅ **Commit the ROMs** — done, in `src/cpc/roms/`. Redistribution-permitted,
  universal emulator practice.
- **Minimal FDC vs AMSDOS trap** — decide after PR 5's spike.
- **Standalone-HTML** loses ROMs unless we add a base64 build variant — defer.
- ✅ **Scope creep risk** — the spike retired it: the firmware boots on the
  model we already have.

## Effort

PR 1 ~1 day (done). PR 2 spike ~½ day (done — and cheaper than feared). PR 3
(UI switch) ~1 day. PR 4 (BASIC shakedown) ~1–3 days. PR 5 (FDC) ~2–3 days.
PR 6–7 build on PR 5.
