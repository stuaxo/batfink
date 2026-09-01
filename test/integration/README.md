# Integration & conformance tests

Opt-in checks against independent references — real Z80 test suites and
established assemblers. **Not** run by `npm test` or in CI.

```
npm run fetch:fixtures     # download the Z80 test data (gitignored)
npm run test:integration   # run everything available; skip the rest
npm run test:conformance   # just the CPU checks
npm run test:differential   # just the assembler checks
```

Every spec skips cleanly when its tool or fixture is missing, printing a hint.
On a bare checkout, `npm run test:integration` passes with everything skipped.

## What runs

| Spec | Needs | Checks |
| --- | --- | --- |
| `conformance/cpm.itest.ts` — prelim | `fetch:fixtures` | Frank Cringle's preliminary exerciser |
| `conformance/cpm.itest.ts` — zexdoc | `fetch:fixtures`, `ZEX=1` | every documented-flag CRC (~5–12 min in JS) |
| `conformance/cpm.itest.ts` — zexall | `fetch:fixtures`, `ZEXALL=1` | undocumented flags too; ratcheted against `baselines/zexall.json` |
| `conformance/single-step.itest.ts` | `fetch:fixtures` | SingleStepTests `z80/v1`, first `SST_CASES` (default 25) per opcode, ratcheted against `baselines/single-step.json` |
| `differential/opcode-table.itest.ts` | `rasm` and/or `pasmo` | a generated coverage corpus, byte-compared |
| `differential/examples-rasm.itest.ts` | `rasm` | every example + the demo, byte-compared |
| `emulator/firmware-boot.itest.ts` | (ROMs are committed) | CPC 464 firmware boots to `Ready` and takes a keystroke |
| `emulator/basic-shakedown.itest.ts` | (ROMs are committed) | BASIC 1.0: PRINT, program + RUN, INK/BORDER, SOUND, CALL |
| `emulator/fdc-trace.itest.ts` | (ROMs are committed) | records the µPD765 command sequence AMSDOS issues for `CAT` (feeds `plan/fdc.md`) |
| `emulator/fdc-amsdos.itest.ts` | (ROMs are committed) | real FDC + AMSDOS: `CAT` and `RUN"` a `.dsk` built by `makeDsk` |

## Tools

- **rasm** — build from source, it shares our `&`-hex Amstrad dialect:
  ```
  git clone https://github.com/EdouardBERGE/rasm && make -C rasm
  export RASM_BIN=$PWD/rasm/rasm.exe
  ```
- **pasmo** — `apt install pasmo`, or build the CMake fork. Stricter ZX dialect;
  a few lines are allowlisted (`allowlists/pasmo.json`).

Point at a tool with `RASM_BIN` / `PASMO_BIN` (a bare `PATH` lookup is
unreliable under npm). SingleStepTests can be reused from an existing checkout
with `Z80_SST_DIR`.

## Environment

| Var | Effect |
| --- | --- |
| `RASM_BIN`, `PASMO_BIN` | path to the assembler |
| `Z80_SST_DIR` | existing SingleStepTests `v1/` directory |
| `SST_CASES` | cases per opcode (default 25; `1000` for the full run) |
| `SST_OPCODES=all` | `fetch:fixtures` grabs every opcode, not the curated subset |
| `SST_WRITE_BASELINE=1` | regenerate `baselines/single-step.json` |
| `ZEX=1`, `ZEXALL=1` | run the slow Cringle exercisers |
| `WRITE_CORPUS=1` | regenerate `differential/corpus/opcodes.neutral.asm` |

## Tier C — MAME cross-check (designed, not built)

An `emulator/exports-mame.itest.ts`, `describe.skipIf(!MAME || !MAME_ROMPATH)`.
The tester supplies CPC ROMs via `MAME_ROMPATH` (Amstrad copyright — never
committed, never in CI; unrelated to `src/cpc/roms/`, which are the firmware
images bundled with the app).

Per `EXAMPLES` entry: `boot(source)`, then build each export —
`snapshotSNA(cpu, m)`, `makeDsk(bytes, …)`, `makeCdt(bytes, …)` — and launch
headless MAME:

```
SDL_VIDEODRIVER=offscreen mame cpc6128 -rompath $MAME_ROMPATH \
  -video soft -sound none -nothrottle -seconds_to_run 8 -skip_gameinfo \
  -autoboot_script emulator/lua/capture.lua \
  <per format: -snapshot prog.sna
             | -flop1 prog.dsk -autoboot_delay 3 -autoboot_command 'run"PROG\n'
             | -cass  prog.cdt -autoboot_delay 3 -autoboot_command 'run""\n'>
```

`capture.lua` waits ~250 frames, dumps the visible screen as raw RGBA to
`$BATFINK_CAP`, exits. `beforeAll` captures a no-media "BASIC ready" reference.
**Assert:** the capture parses, has > 2 distinct colours, and differs from the
reference by > 5 % of pixels (the program took over).

Now largely superseded for `.dsk` by `fdc-amsdos.itest.ts` (real AMSDOS ROM,
no MAME). Still the only cross-check for the renderer and for `.cdt`.

## Known core gaps (baselined)

Surfaced by this suite, accepted for now:

- `LD A,R` reads one low — `R` is bumped per `step()`, not per opcode fetch.
- `INI`/`IND`/`OUTI`/`OUTD` flags come from `B` only; the real Z80 folds in the
  transferred byte.
- `BIT n,(HL)` / `BIT n,(IX+d)` and `CPI`/`CPD` undocumented `YF`/`XF` need
  MEMPTR, which the core does not model. `zexdoc` (which masks those bits)
  passes 100%.
