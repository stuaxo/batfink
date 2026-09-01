# Sound — AY-3-8912

## The chip

The CPC's PSG is the **AY-3-8912**, clocked at **1 MHz** (16 MHz master / 16).

- 3 square-wave tone channels, one noise LFSR (17-bit), one envelope generator
  (10 shapes), 4-bit logarithmic volume per channel, a mixer.
- 16 registers. Driven through the **PPI 8255**: port A carries the data byte,
  port C bits 6–7 are BC1 / BDIR.
- Tone frequency = 1 000 000 / (16 × period); noise = /(16 × period); envelope =
  /(256 × period).
- The CPC stereo jack is wired **A-left, B-centre, C-right**.

### Register map and write masks

| R | meaning | mask |
| --- | --- | --- |
| 0 / 2 / 4 | tone A/B/C period, fine | `0xFF` |
| 1 / 3 / 5 | tone A/B/C period, coarse | `0x0F` |
| 6 | noise period | `0x1F` |
| 7 | mixer: bit n = tone A/B/C off, bit n+3 = noise off; bit 6 = port A dir | `0xFF` |
| 8 / 9 / 10 | volume A/B/C (bit 4 = use envelope) | `0x1F` |
| 11 | envelope period, fine | `0xFF` |
| 12 | envelope period, coarse | `0xFF` |
| 13 | envelope shape (bit 0 Hold, 1 Alternate, 2 Attack, 3 Continue) | `0x0F` |
| 14 / 15 | I/O ports — R14 is the keyboard/joystick read on the CPC | — |

Writing **R13 restarts the envelope**.

### Current state

`m.psg` (16 bytes) and `m.psgSelect` exist and are in the snapshot, but nothing
populates them — the PPI→PSG write path is not wired. So every `.sna` export has
had zeroed PSG state.

## How the CPC drives it

PPI port C: bit 7 = BDIR, bit 6 = BC1. `(ppiC >> 6) & 3`:

| | |
| --- | --- |
| 0 | inactive |
| 1 | read — port A ← `psg[psgSelect]` (only if port A is an input; rare) |
| 2 | write — `psg[psgSelect]` ← `ppiA` (masked) |
| 3 | latch — `psgSelect` ← `ppiA & 0x0F` |

Canonical write sequence: set `ppiA` = reg number, port C = latch (3), port C =
inactive (0), set `ppiA` = value, port C = write (2), port C = inactive. Acting
on each port C write, using the current `ppiA`, reproduces this.

**Simplification:** the real CPC toggles port A between output (for PSG writes)
and input (for keyboard scanning). We shortcut the keyboard already, so we act on
PSG writes regardless of the PPI direction bits.

## Approach

Synthesise in the emulator, buffer out to Web Audio.

- The AY becomes another device stepped in `runUntil`'s loop, alongside the
  raster/interrupt advance. Register writes hit the AY at the exact instruction
  they happen → sub-frame modulation (drums, per-scanline effects) is
  sample-accurate.
- **No `SharedArrayBuffer`** — GitHub Pages cannot send COOP/COEP headers. The
  output AudioWorklet receives sample chunks by `postMessage` with a transferable
  `ArrayBuffer` (zero-copy) and keeps its own ring buffer.
- Synth cost at 48 kHz is ~0.5 % CPU — stays on the main thread with the
  emulator. The worklet only does output buffering, no synthesis.
- Latency ~2–3 frames (40–60 ms).
- Audio runs only while the machine runs live. Paused / stepping / scrubbing =
  silence. The timeline's replay path does not feed the audio buffer.

## The AY core

Port **ayumi** (github.com/true-grue/ayumi, MIT — ~300 lines C). Accurate
AY/YM emulator with the log volume table, all 10 envelope shapes, the noise
LFSR, DC removal and clock→rate decimation. Rolling our own risks getting the
volume table and envelope logic subtly wrong. Header attribution + a NOTICE.

`src/cpc/ay.ts` — a class mirroring the ayumi API:

```
configure(isYM: false, clockHz: 1_000_000, sampleRate)
setTone(ch, period)  setNoise(period)  setEnvelope(period)  setEnvelopeShape(shape)
setMixer(ch, toneOff, noiseOff, envOn)  setVolume(ch, 0..15)
setPan(ch, pan, equalPower)   // A: 0, B: 0.5, C: 1
process()  -> advances one output sample; result in .left / .right
```

A thin `writeReg(n, v)` adapter maps the 16 registers onto those setters
(R0+R1 → tone A period, R8 bit 4 → env-on mixer flag, R11+R12 → envelope period,
R13 → shape + restart).

## PRs

1. **PSG register path** — `src/cpc/psg.ts` decodes BC1/BDIR on port C writes,
   applies the masks, restarts the envelope on R13. Wire into `ports.ts`. Small;
   fixes `.sna` export; prerequisite. `getState`/`setState` already cover `psg`.
   Tests: the write dance populates `m.psg`; SNA reflects it.
2. **AY synth core** — `src/cpc/ay.ts`, the ayumi port, pure. Tests: register
   configs → measured output frequency (zero-crossings), envelope produces a
   ramp, volume table monotonic, silence when all channels off.
3. **Step the AY with the machine** — `m.audio: { ay, ring, sampleRate } | null`
   (null = silent, like `m.onWrite`). In the advance loop, `audioClock += dt`;
   while `audioClock >= tstatesPerSample` emit `ay.process()` into the ring. The
   `psg.ts` decode also calls `m.audio?.ay.writeReg(reg, val)`.
4. **Web Audio output** — `src/ui/sound.ts`: an AudioWorklet ring processor fed
   by `postMessage`; `context.resume()` on the first user gesture; mute + volume
   in the UI. The app tick posts each frame's samples after running frames.
5. **Polish** — volume slider; give `capture.ts` a `MediaStreamAudioDestinationNode`
   track so WebM recordings have sound.

## Decisions to flag

- **Firmware `SOUND`** needs the ROMs (separate Phase 3 item). Bare-metal demos
  that poke the PPI directly — the demoscene target — work with PRs 1–4 alone.
- 50 Hz / 300 Hz interrupt-driven replayers: our interrupt timing is already
  modelled, so their register writes land accurately.
- Real-time coupling: a tick-loop stutter (backgrounded tab, GC) glitches the
  audio. Small buffer + silence-on-underrun is the standard mitigation.
- `AudioContext` sample rate varies (44100 / 48000) — query it and configure the
  AY decimator to match.

## Rough effort

PR1 small · PR2 ~1 day · PR3 ~half day · PR4 ~1 day (browser audio is fiddly) ·
PR5 ~half day.
