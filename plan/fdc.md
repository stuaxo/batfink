# Minimal FDC 765 + disc

PR 5 of [`rom.md`](rom.md). Enough µPD765A to let AMSDOS read (and write) an
exported `.dsk` in-app. Not the full chip — no weak sectors, copy protection,
or real timing.

This doc is the research so the PR is mechanical. Sources at the end.

## What AMSDOS actually does

Traced from our own ROMs (`test/integration/emulator/fdc-trace.itest.ts`,
firmware + AMSDOS, `CAT`):

```
boot:  SPECIFY            params A1 03
CAT:   RECALIBRATE        drive 0                  (-> track 0)
       SENSE INT STATUS                            (poll until seek-end)
       READ ID (MFM)      drive 0 head 0
       READ DATA (MFM,SK) C=0 H=0 R=&C1 N=2 EOT=&C1 GPL=&2A DTL=&FF
```

So the minimum command set is **SPECIFY, RECALIBRATE, SEEK, SENSE INTERRUPT
STATUS, READ ID, READ DATA**. Add **SENSE DRIVE STATUS, WRITE DATA, FORMAT
TRACK** for `SAVE` and disc init. `CAT` reads track 0 sector &C1 — the first
directory block. Files on other tracks add a `SEEK`.

## CPC wiring

The FDC INT and DRQ pins are **not connected**. Everything is MSR polling; the
Z80 never gets an interrupt from the disc. Execution-phase transfer: the CPU
reads MSR, and when `RQM=1` with `EXM=1` it moves one byte through the data
register, looping for the whole sector, then reads the 7 result bytes.

### Ports

Decoded on A10, A8, A7, A0 (all other bits 1):

| A10 | A7 | A8 | A0 | Port | Function |
| --- | --- | --- | --- | --- | --- |
| 0 | 0 | 0 | 0 | `&FA7E` | motor latch, **write** (`00` off, `01` on — all drives) |
| 0 | 0 | 1 | 0 | `&FB7E` | Main Status Register, **read** |
| 0 | 0 | 1 | 1 | `&FB7F` | data register, **read/write** |

In `ports.ts` this sits after the PPI branch:
`else if ((port & 0x0480) === 0) { … }` — `A8` picks motor vs FDC, `A0` picks
MSR vs data.

## Main Status Register

| Bit | Name | Meaning |
| --- | --- | --- |
| 7 | RQM | data register ready for a transfer |
| 6 | DIO | 1 = FDC → CPU, 0 = CPU → FDC |
| 5 | EXM | in execution phase, non-DMA |
| 4 | CB | controller busy (command in progress) |
| 3–0 | D3B–D0B | drive n is seeking |

Values by phase: idle `0x80`; command/params `0x90` (RQM|CB); execution read
`0xF0`, execution write `0xB0`; result `0xD0` (RQM|DIO|CB); during a seek, set
the drive's DnB bit and clear CB (`0x01` for drive 0, so SENSE INT works).

## Status registers

- **ST0**: 7–6 IC (`00` normal, `01` abnormal), 5 SE seek-end, 4 EC, 3 NR,
  2 HD, 1–0 US.
- **ST1**: 7 EN end-of-cylinder, 5 DE CRC, 4 OR overrun, 2 ND no data,
  1 NW write-protect, 0 MA missing address mark.
- **ST2**: 6 CM, 5 DD, 4 WC wrong cylinder, 3 SH, 2 SN, 1 BC, 0 MD.
- **ST3**: 7 FT, 6 WP, 5 RY ready, 4 T0 track 0, 3 TS two-sided, 2 HD, 1–0 US.

For a clean read: ST0 = `US` only, ST1 = 0, ST2 = 0.

## Command / result bytes

Command byte bits: MT (multi-track), MF (1 = MFM — always on the CPC), SK (skip
deleted). AMSDOS issues READ ID as `&4A` and READ DATA as `&66`.

| Command | code | command bytes (after code) | result bytes |
| --- | --- | --- | --- |
| SPECIFY | `03` | SRT\|HUT, HLT\|ND | — |
| SENSE DRIVE STATUS | `04` | `0 0 0 0 0 HD US1 US0` | ST3 |
| RECALIBRATE | `07` | `… US1 US0` | — (then SENSE INT) |
| SEEK | `0F` | `… HD US1 US0`, NCN | — (then SENSE INT) |
| SENSE INTERRUPT STATUS | `08` | — | ST0, PCN |
| READ ID | `x A` | `… HD US1 US0` | ST0, ST1, ST2, C, H, R, N |
| READ DATA | `x 6` | `… HD US`, C, H, R, N, EOT, GPL, DTL | ST0, ST1, ST2, C, H, R, N |
| WRITE DATA | `x 5` | same as READ DATA | ST0, ST1, ST2, C, H, R, N |
| FORMAT TRACK | `x D` | `… HD US`, N, SC, GPL, D; then C,H,R,N per sector | ST0, ST1, ST2, C, H, R, N |

RECALIBRATE / SEEK raise a pending interrupt with SE set; the next SENSE
INTERRUPT STATUS returns `ST0 = 0x20 | US`, `PCN = track`, and clears it. An
extra SENSE INT with nothing pending returns `ST0 = 0x80` (invalid).

## The drive model

`src/cpc/fdc.ts` holds a `Disc | null` per drive (drive 0 only to start). A
`Disc` wraps the `.dsk` image bytes (`src/export/dsk.ts` builds them) with:

- `readSector(track, sectorId) → Uint8Array` — walk the Track Information Block
  at `256 + track * 0x1300`, match the Sector Information List entry (`+0x18`,
  8 bytes each: C, H, R, N, ST1, ST2, size-lo, size-hi) on R, return its 512
  bytes.
- `sectorIds(track)`, `trackCount` for READ ID and bounds.
- `writeSector` for `SAVE` (mutate the image; the UI can offer a re-download).

Standard `.dsk` only for now — the Extended format (per-sector size table,
copy-protected discs) is a later upgrade.

## State machine

`class Fdc`:

- `phase`: idle / command / execution / result.
- `writeData(v)` — in idle, `v` is the command: look up its parameter count,
  collect that many bytes, then run it. In execution (WRITE/FORMAT) `v` is a
  data byte.
- `readData()` — in execution (READ) returns the next sector byte; in result
  returns the next result byte, dropping to idle when drained.
- `readMsr()` — the table above.
- `motor(on)`, `reset()`.
- `intPending` + `pcn` for SENSE INTERRUPT STATUS.

Wire it in `machine.ts` (`m.fdc = new Fdc()`) and `ports.ts`. `getState` /
`setState`: the FDC phase and buffers are small and worth snapshotting so
time-travel across a disc load works; the disc images are not state (like the
ROMs).

## Tests

`test/cpc/fdc.test.ts`, against a `.dsk` we build with `makeDsk`:

- SPECIFY then RECALIBRATE then SENSE INT → `ST0 = 0x20`, `PCN = 0`.
- READ ID on track 0 → `R` in `&C1..&C9`, `N = 2`.
- READ DATA track 0 sector &C1 → the 512 bytes match the image, result `ST0 = 0`.
- READ DATA for a missing sector → `ST0` abnormal, `ST1` ND.
- SEEK to 5, SENSE INT → `PCN = 5`; READ ID returns `C = 5`.
- MSR sequencing: `0x80` idle → `0x90` taking params → `0xF0` execution →
  `0xD0` result → `0x80`.

Then the integration payoff in PR 6: firmware + AMSDOS + a mounted `.dsk`,
`RUN"` an exported program, assert it takes the screen — the Tier-C check
without MAME.

## Fallback

If real execution-phase timing trips AMSDOS up, trap the AMSDOS ROM sector
entry points and service reads/writes in JS against the image. Less faithful
(bespoke loaders break) but small. Decide from the PR 5 spike.

## Sources

- µPD765A command and status reference —
  <https://cpctech.cpcwiki.de/docs/upd765a/necfdc.htm>
- CPC FDC port decode and INT-not-connected —
  <https://cpctech.cpcwiki.de/docs/fdc.html>,
  <https://www.cpcwiki.eu/index.php/765_FDC>
- Our own `.dsk` layout — `src/export/dsk.ts`, [[cpc-file-formats]]
- AMSDOS command sequence — traced in
  `test/integration/emulator/fdc-trace.itest.ts`
