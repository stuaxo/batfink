# Cassette (`.cdt`) `RUN"`

Not scheduled. This is the design sketch so the knowledge isn't lost, not a
committed plan. The disc side (see [`rom.md`](rom.md), [`fdc.md`](fdc.md)) is the
priority for "verified on hardware"; tape is a nice-to-have on top.

## What it would unlock

- `RUN""` an exported `.cdt` in-app — the tape equivalent of the disc mount,
  closing the last "structurally tested, not run" gap (`src/export/cdt.ts`).
- Loading real CPC tape images (games, type-ins).

## The hardware

The CPC has no tape controller — the firmware bit-bangs the cassette port
(confirmed by a trace, `RUN""` on a tape-only 464):

| Signal | Where | Direction | Notes |
| --- | --- | --- | --- |
| motor on/off | PPI port C **bit 4** (write) | out | held 1 through a load |
| write (save) | PPI port C bit 5 (write) | out | toggles during load too — ignore for read |
| read (load) | PPI port B **bit 7** (read) | in | always 0 today |

Today `bus.in` for PPI port B returns `(vsync ? 1 : 0) | 0x1e` — bit 7 is always
0.

**What the firmware does** (`RUN""`, no AMSDOS):

1. Prints `Press PLAY then any key:` and blocks in the KM key-wait loop.
2. On a keypress, sets port C bit 4 (motor on) and drops into the read routine
   at **`&2919`–`&29xx`** in the OS ROM.
3. The edge timer is the subroutine at **`&29CD`**: it polls port B bit 7 in a
   tight loop, counting iterations until the bit flips, and returns the
   half-period. `&2923`+ measure two edges, find the 0/1 threshold
   (`srl a / srl a / adc a,d` at `&2947` — divide by ~1.25), and assemble bits →
   bytes → the 64-byte record header and data, CRC-checked, exactly as
   `src/export/cdt.ts` encodes them.

`&29CD` is the single hook point — everything above it is framing that works
unmodified once it sees real edges.

## Two approaches

### 1. Emulate the tape signal (faithful — recommended, mirrors the FDC/audio work)

Steps:

1. **`src/cpc/tape.ts` — `class Tape`.** A flat `Int32Array` of pulse durations
   in T-states, a cursor, a countdown, a `level` (0/1), `motorOn`. `advance(dt)`
   (called from the frame loop like `AudioSink.step`, only while `motorOn`)
   decrements the countdown and flips `level` at each boundary. `reset()`,
   `rewind()`.
2. **`ports.ts`.** `in` port B: OR in `(m.tape?.motorOn ? m.tape.level : 0) << 7`.
   `out` port C (`fn === 2`): `m.tape?.setMotor((v & 0x10) !== 0)`.
3. **`frame.ts`.** `if (m.tape) m.tape.advance(dt)` alongside `audio.step(dt)`,
   behind a `cond.tape` flag / null check — zero cost with no tape, same seam
   pattern as `m.audio`.
4. **`machine.ts` / `state.ts`.** `m.tape: Tape | null` (null by default).
   Snapshot cursor + countdown + level.
5. **TZX / `.cdt` reader** (`src/cassette/cdt-read.ts`). Inverse of
   `src/export/cdt.ts`, which already has the CPC pulse-length maths and 0x11
   layout. Expand blocks to a pulse list:
   - **0x11 (turbo)** — every one of our own exports. Do this first; it's the
     whole job for "our `.cdt` round-trips".
   - 0x10 (standard), 0x12 (tone), 0x13 (pulse seq), 0x14 (pure data),
     0x20 (pause), 0x2A/0x30/0x32 (stop/text — skip). Add these for real-world
     images.
6. **UI.** A **Tape** row by the Disc row (firmware mode): *Mount .cdt…*,
   *Mount program* (`makeCdt` on the current listing), *Rewind*, *Eject*.
7. **Two firmware quirks to handle:**
   - With AMSDOS installed, `RUN"` defaults to disc. The user needs `|TAPE`
     first (`|` = Shift+@). Give them a **Use tape** button that issues it, or
     only default to tape when no disc is mounted.
   - `RUN""` blocks on `Press PLAY then any key:` — feed a synthetic keypress
     from the mount action so it "just works".

Cost: the engine + wiring ~½ day (small, like `AudioSink`); the 0x11 reader
~½ day. **~1–2 days for "our `.cdt` round-trips".** Full real-tape-image support
is the open-ended part (more block types, weird timings) and is not the goal.

### 2. Trap the edge timer (cheap fallback)

Breakpoint `&29CD` and, on hit, walk a decoded bit stream directly: return the
half-period for the next 0 or 1 (advance registers/flags as the routine would).
No TZX parser — walk the file's bytes. ~½ day, but bespoke/fast loaders and real
images won't work. Take this only if the pulse engine proves fiddly; decide from
a spike, as with the FDC.

## Verification

- `test/cpc/tape.test.ts` — the pulse engine's timing, and TZX 0x11 → pulses
  (round-trip against `src/export/cdt.ts`).
- `test/integration/emulator/cassette.itest.ts` — mount a `makeCdt` image,
  `|TAPE`, `RUN""`, feed a keypress, run frames, assert the program took the
  screen. Mirrors `fdc-amsdos.itest.ts`.

The trace spike this doc is based on is already done (see "What the firmware
does"); the read routine at `&2919`/`&29CD` and the port bits are known.

## Sources

- TZX / `.cdt` format and CPC timings — `github.com/cpcitor/2cdt`
  (`src/2cdt.c`, `src/tzxfile.c`), already the basis for `src/export/cdt.ts`.
  See [[cpc-file-formats]].
- CPC PPI port bits — <https://cpctech.cpcwiki.de/docs/8255cpc.html> (port C
  bit 4 = motor, bit 5 = write; port B bit 7 = read).
