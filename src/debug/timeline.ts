// Time-travel: periodic snapshots + a keyboard event log let us restore the
// machine to any past frame by loading the nearest snapshot and replaying
// forward. Replay is exact because the machine is a pure function of its state
// plus keyboard input.
import type { Z80 } from '../z80/cpu';
import { type CPCMachine, type MachineState, getState, setState, runUntil } from '../cpc';

interface KeyEvent { frame: number; line: number; bit: number; down: boolean }

export class Timeline {
  private snaps: Array<{ frame: number; state: MachineState }> = [];
  private keys: KeyEvent[] = [];
  private liveState: MachineState | null = null;
  private readonly interval: number;
  private readonly maxSnaps: number;
  reviewing = false;
  head = 0;

  constructor(
    private readonly cpu: Z80,
    private readonly m: CPCMachine,
    opts: { interval?: number; maxSnaps?: number } = {},
  ) {
    // Each snapshot is a full ~71 KB machine copy (64 KB RAM + registers +
    // per-scanline palette). 120 x 0.5s => ~1 min of history, ~8.5 MB.
    this.interval = opts.interval ?? 25;
    this.maxSnaps = opts.maxSnaps ?? 120;
  }

  /** Wipe history — call on reset / rebuild. */
  clear(): void {
    this.snaps = [];
    this.keys = [];
    this.liveState = null;
    this.reviewing = false;
    this.head = 0;
  }

  /** Call once per rendered frame while running live. */
  record(): void {
    this.head = this.m.frames;
    const last = this.snaps[this.snaps.length - 1];
    if (!last || this.m.frames - last.frame >= this.interval) {
      this.snaps.push({ frame: this.m.frames, state: getState(this.cpu, this.m) });
      if (this.snaps.length > this.maxSnaps) this.snaps.shift();
    }
  }

  recordKey(line: number, bit: number, down: boolean): void {
    if (this.reviewing) return;
    this.keys.push({ frame: this.m.frames, line, bit, down });
  }

  get earliest(): number { return this.snaps[0]?.frame ?? 0; }
  get latest(): number { return this.head; }

  /** Restore the machine to `frame`. Leaves it paused, in review mode. */
  seek(frame: number): void {
    if (!this.snaps.length) return;
    if (!this.reviewing) {
      this.liveState = getState(this.cpu, this.m);
      this.reviewing = true;
    }
    const target = Math.max(this.earliest, Math.min(frame, this.head));

    let snap = this.snaps[0];
    for (const s of this.snaps) { if (s.frame <= target) snap = s; else break; }
    setState(this.cpu, this.m, snap.state);

    for (let f = snap.frame; f < target; f++) {
      for (const k of this.keys) if (k.frame === f) this.m.setKey(k.line, k.bit, k.down);
      runUntil(this.cpu, this.m, { frame: true });
      this.m.frames++;
    }
  }

  /** Return to the latest state and leave review mode. */
  goLive(): void {
    if (this.reviewing && this.liveState) setState(this.cpu, this.m, this.liveState);
    this.reviewing = false;
    this.liveState = null;
  }

  /** Keep the machine where `seek` left it and discard everything after it. */
  resumeHere(): void {
    const frame = this.m.frames;
    this.snaps = this.snaps.filter((s) => s.frame <= frame);
    this.keys = this.keys.filter((k) => k.frame <= frame);
    this.head = frame;
    this.reviewing = false;
    this.liveState = null;
  }
}
