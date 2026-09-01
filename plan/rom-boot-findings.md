# Firmware boot spike — findings

PR 2 of [`rom.md`](rom.md). Load the CPC 464 firmware, run it with no disc, see
where it dies.

## It doesn't die

The 464 firmware boots cleanly to the BASIC `Ready` prompt with **only ROM
paging added** (PR 1). No other hardware changes.

```
 Amstrad 64K Microcomputer  (v1)

 (c)1984 Amstrad Consumer Electronics plc
           and Locomotive Software Ltd.

 BASIC 1.0

Ready
```

Recovered from screen RAM by matching cells against the ROM font — the picture
renders correctly too.

## What works out of the box

| Thing | State |
| --- | --- |
| Reset → OS init → BASIC | reaches `Ready` in ~2s of virtual time |
| Interrupts | enabled by frame 1, 300 Hz ticker running |
| Mode | firmware selects mode 1 |
| CRTC | fully programmed (R1=40, R6=25, R9=7, R12=48 → base &C000) |
| Screen driver (TXT VDU) | banner + prompt render, cursor line advances |
| ROM scan | upper ROM (BASIC) paged in around frame 25, then back out |
| Keyboard | **works** — holding a matrix key echoes at the prompt; a bad line
  gets `Syntax error` and a re-prompt |

The keyboard was the expected gap (the `rom.md` plan flagged "PSG keyboard read
(R14)" as PR 3 work). It isn't a gap: the firmware's KM scan selects a matrix
row through PPI port C and reads it back through PPI port A, and our existing
port decode already handles both. No PSG R14 read path is needed.

## Idle loop

After boot the OS sits in a ~29-instruction loop at `&1A3C–&1D2B` in the lower
ROM, polling KM workspace at `&B4DE`/`&B4E0` (the key-buffer pointers) with
interrupts on. This is the editor waiting for a line — the normal `Ready` state.

## BASIC shakedown (PR 4)

Driving BASIC 1.0 through the key matrix
(`test/integration/emulator/basic-shakedown.itest.ts`), everything a playground
user reaches works with no firmware fixes:

- `PRINT "text"` and `PRINT 2+2`
- entering `10`/`20` line-numbered statements and `RUN`, including a `GOTO` loop
- `INK` and `BORDER` (the palette changes)
- `SOUND` (the firmware programs the PSG — tone period, channel volume, mixer)
- `CALL &8000` into machine code poked into RAM — the playground's own workflow

## Consequence for the plan

`rom.md` budgeted PR 3 ("firmware hardware gaps") at "days to weeks" and treated
a full firmware boot as the risky part. **That risk is retired.** The hardware
model built for bare-metal demos is already enough for Amstrad's OS.

Revised order:

1. ✅ ROM paging (PR 1)
2. ✅ This spike (PR 2)
3. ✅ **UI "Machine" switch** — *bare* vs *firmware (464)* (`src/ui/firmware.ts`).
4. ✅ **BASIC shakedown** — PRINT, program entry + RUN, INK/BORDER, SOUND, CALL.
5. ✅ **Minimal FDC 765** + `.dsk` reader ([`fdc.md`](fdc.md)).
6. ✅ **Disc mount UI** — `RUN"` an exported `.dsk` or one from disk.
7. **Cassette via firmware** — not scheduled ([`cassette.md`](cassette.md)).

PR 3-as-written (a phase of hardware-gap grinding) collapsed into step 4's
shakedown — it found nothing to fix.

## Repro

`npm run test:integration -- firmware-boot`, or see
`test/integration/emulator/firmware-boot.itest.ts`.
