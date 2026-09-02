# Cassette (`.cdt`) `RUN""`

✅ **Built.** `src/cpc/tape.ts` — a `Tape` pulse engine + `readCdt` (TZX
reader). A `.cdt` mounts next to the disc; `RUN""` plays it through the
firmware's own `CAS IN` routines. Verified end to end
(`test/integration/emulator/cassette.itest.ts`) — which also validates
`src/export/cdt.ts` for the first time.

The trace-based analysis below is what the build was based on.

## What it unlocked

- `RUN""` an exported `.cdt` in-app — the last "structurally tested, not run"
  gap on `src/export/cdt.ts`, now closed.
- Loading real CPC tape images (the reader handles the common TZX blocks;
  our own exports are all 0x11).

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

## How it was built

The faithful "emulate the tape signal" route (the trap-`&29CD` fallback wasn't
needed):

1. **`src/cpc/tape.ts` — `class Tape`.** An `Int32Array` of pulse durations in
   CPU T-states, a cursor + countdown, a `level` (0/1), `motorOn`. `advance(dt)`
   (from the frame loop, only while `motorOn`) counts down and flips `level` at
   each boundary. `rewind()`, `getState`/`setState`.
2. **`ports.ts`.** `in` port B ORs in `level << 7`; `out` port C (`fn === 2`)
   sets `motorOn` from bit 4.
3. **`frame.ts`.** `if (tape) tape.advance(dt)` beside `audio.step(dt)` — a null
   check, zero cost with no tape.
4. **`machine.ts` / `state.ts`.** `m.tape: Tape | null`; the cursor is
   snapshotted (the pulse list is fixed, like a ROM).
5. **`readCdt`** (in `tape.ts`). Parses the TZX container to a pulse list,
   converting TZX (3.5 MHz) pulse lengths to CPU T-states. Blocks: 0x10, 0x11
   (what `makeCdt` writes), 0x12, 0x13, 0x14, 0x20, and skips 0x30/0x32/0x33/
   0x35. Unknown blocks throw.
6. **UI.** A **Tape** row (firmware mode): *Mount .cdt…*, *Mount program*
   (`makeCdt`), *Rewind*, *Eject*.
7. **The AMSDOS quirk.** `RUN"` defaults to disc when AMSDOS is loaded, so
   mounting a tape boots the firmware *without* AMSDOS (and ejects any disc) —
   one medium at a time. The user still presses a key at `Press PLAY then any
   key:` (the status line says so).

## Verification

- `test/cpc/tape.test.ts` — the pulse engine's timing/rewind/snapshot, and
  `readCdt` on a `makeCdt` image and on metadata-only blocks.
- `test/integration/emulator/cassette.itest.ts` — mount a `makeCdt` image,
  `RUN""`, press a key, and the loaded program takes the screen; a blank tape
  doesn't hang or falsely succeed.

## Sources

- TZX / `.cdt` format and CPC timings — `github.com/cpcitor/2cdt`
  (`src/2cdt.c`, `src/tzxfile.c`), already the basis for `src/export/cdt.ts`.
  See [[cpc-file-formats]].
- CPC PPI port bits — <https://cpctech.cpcwiki.de/docs/8255cpc.html> (port C
  bit 4 = motor, bit 5 = write; port B bit 7 = read).
