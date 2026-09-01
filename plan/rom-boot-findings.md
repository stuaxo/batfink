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

## Consequence for the plan

`rom.md` budgeted PR 3 ("firmware hardware gaps") at "days to weeks" and treated
a full firmware boot as the risky part. **That risk is retired.** The hardware
model built for bare-metal demos is already enough for Amstrad's OS.

Revised order:

1. ✅ ROM paging (PR 1)
2. ✅ This spike (PR 2)
3. **UI: a "Machine" switch** — *bare* (today) vs *firmware*. Fetch the ROM
   asset, `installFirmware`, boot. Check `.sna`/example loading still pages the
   ROMs out as before. (Was PR 4; now next.)
4. **BASIC shakedown** — type and `RUN` a real program, `PRINT`, firmware
   `SOUND`, `INK`, `LOCATE`. Fix whatever the firmware trips on. Likely small.
5. **Minimal FDC 765** + `.dsk` sector reader (unchanged, PR 5).
6. **AMSDOS + mount** — `RUN"` an exported `.dsk` (unchanged, PR 6).
7. **Cassette via firmware** (unchanged, PR 7).

PR 3-as-written (a phase of hardware-gap grinding) collapses into step 4's
shakedown.

## Repro

`npm run test:integration -- firmware-boot`, or see
`test/integration/emulator/firmware-boot.itest.ts`.
