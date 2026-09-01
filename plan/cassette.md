# Cassette (`.cdt`) `RUN"`

Not scheduled. This is the design sketch so the knowledge isn't lost, not a
committed plan. The disc side (see [`rom.md`](rom.md), [`fdc.md`](fdc.md)) is the
priority for "verified on hardware"; tape is a nice-to-have on top.

## What it would unlock

- `RUN""` an exported `.cdt` in-app — the tape equivalent of the disc mount,
  closing the last "structurally tested, not run" gap (`src/export/cdt.ts`).
- Loading real CPC tape images (games, type-ins).

## The hardware

The CPC has no tape controller — the firmware bit-bangs the cassette port:

| Signal | Where | Direction |
| --- | --- | --- |
| motor on/off | PPI port C bit 4 (write) | out |
| write (save) | PPI port C bit 5 (write) | out |
| read (load) | PPI port B bit 7 (read) | in |

Today `bus.in` for PPI port B returns `(vsync ? 1 : 0) | 0x1e` — bit 7 is always
0. The firmware `CAS IN` routines start the motor, then time the interval
between edges on port B bit 7 to recover bits (a short/long pulse pair per bit,
Manchester-ish), exactly as the `.cdt` records encode.

## Two approaches

### 1. Emulate the tape signal (faithful)

A `Tape` object turns a pulse stream into port-B-bit-7 transitions clocked by
T-states, stepped from the frame loop like `AudioSink`:

- **Playback engine** — hold a list of pulse lengths (in T-states); each
  `advance(dt)` counts down and flips the bit at each boundary. `bus.in` for
  port B ORs in `tape.level << 7`. Motor bit gates it.
- **`.cdt` reader** — a TZX parser. `src/export/cdt.ts` already has the CPC
  timing maths (baud → pulse lengths, the 0x11 turbo-block layout, CRC). Needs
  the inverse: parse blocks 0x10 (standard), 0x11 (turbo), 0x12 (pure tone),
  0x13 (pulse sequence), 0x14 (pure data), 0x20 (pause), 0x30/0x32 (text) and
  expand each to pulses. Our own exports are all 0x11, so start there and add
  blocks as real images need them.
- Wire a **Tape mount** control next to the Disc row (firmware mode). `RUN""`
  then works because the firmware does its own edge timing — the same path a
  real machine takes.

Cost: a TZX parser and a pulse engine. The engine is small; the parser grows
with the block types you support.

### 2. Trap the firmware tape vectors (cheap)

Patch or breakpoint `CAS IN OPEN` / `CAS IN DIRECT` / `CAS IN CHAR` in the lower
ROM and service them from the decoded file in JS. A fraction of the code, but
custom tape loaders (speedloaders, some intros) won't run, and it is less
honest. Reasonable fallback if the pulse engine proves fiddly — decide from a
spike, as with the FDC.

## Verification

Like the FDC: export a `.cdt` with `makeCdt`, mount it, `RUN""`, assert the
program takes the screen (`test/integration/emulator/` alongside
`fdc-amsdos.itest.ts`). A `cdt-trace.itest.ts` first, to see exactly which
firmware entry points and port bits a `.cdt` load touches — the same
spike-first approach that made the FDC mechanical.

## Sources

- TZX / `.cdt` format and CPC timings — `github.com/cpcitor/2cdt`
  (`src/2cdt.c`, `src/tzxfile.c`), already the basis for `src/export/cdt.ts`.
  See [[cpc-file-formats]].
- CPC cassette port bits — CPC firmware guide, `CAS` jumpblock.
