// Web Audio output: an AudioWorklet ring buffer fed with the emulator's stereo
// samples once per frame. Must be started from a user gesture (autoplay policy).
//
// The worklet is loaded from a Blob URL built from its source — data: URLs are
// rejected by addModule() in some browsers, and small assets get inlined.
import pcmWorkletSrc from './pcm-worklet.js?raw';

export class Sound {
  private ctx: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private volume = 0.7;
  private starting: Promise<void> | null = null;

  /** The context's rate; drives what the emulator's AudioSink should produce. */
  get sampleRate(): number {
    return this.ctx?.sampleRate ?? 48000;
  }

  isRunning(): boolean {
    return !!this.node && this.ctx?.state === 'running';
  }

  /** Create/resume the audio graph. Call from a click. */
  async start(): Promise<void> {
    if (!this.starting) this.starting = this.init();
    await this.starting;
    await this.ctx!.resume();
  }

  private async init(): Promise<void> {
    const Ctor: typeof AudioContext =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new Ctor();
    const url = URL.createObjectURL(new Blob([pcmWorkletSrc], { type: 'application/javascript' }));
    try {
      await this.ctx.audioWorklet.addModule(url);
    } finally {
      URL.revokeObjectURL(url);
    }
    this.node = new AudioWorkletNode(this.ctx, 'pcm', { outputChannelCount: [2] });
    this.node.connect(this.ctx.destination);
    this.node.port.postMessage({ gain: this.volume });
  }

  suspend(): void {
    void this.ctx?.suspend();
  }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    this.node?.port.postMessage({ gain: this.volume });
  }

  /** Drop any buffered audio — on pause, so a fragment doesn't loop. */
  flush(): void {
    this.node?.port.postMessage({ flush: true });
  }

  /** Interleaved stereo Float32; the buffer is transferred (zero-copy). */
  push(samples: Float32Array): void {
    if (!this.node || samples.length === 0) return;
    this.node.port.postMessage({ samples }, [samples.buffer]);
  }
}
