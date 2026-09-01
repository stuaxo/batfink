// AudioWorklet: a ring buffer of interleaved stereo Float32 samples, fed by the
// main thread via postMessage. Outputs silence on underrun.
class PcmProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    // ~300ms of headroom; latency is bounded by dropping the oldest on overflow.
    this.capacity = Math.ceil(sampleRate * 0.3) * 2;
    this.ring = new Float32Array(this.capacity);
    this.read = 0;
    this.write = 0;
    this.filled = 0;
    this.gain = 1;
    this.underruns = 0;

    this.port.onmessage = (e) => {
      const d = e.data;
      if (d.gain !== undefined) { this.gain = d.gain; return; }
      if (d.flush) { this.read = this.write = this.filled = 0; return; }
      const s = d.samples;
      if (!s) return;
      for (let i = 0; i < s.length; i++) {
        this.ring[this.write] = s[i];
        this.write = (this.write + 1) % this.capacity;
        if (this.filled < this.capacity) this.filled++;
        else this.read = (this.read + 1) % this.capacity; // overflow: drop oldest
      }
    };
  }

  process(_inputs, outputs) {
    const out = outputs[0];
    const left = out[0];
    const right = out[1] || out[0];
    const n = left.length;
    const g = this.gain;
    for (let i = 0; i < n; i++) {
      if (this.filled >= 2) {
        left[i] = this.ring[this.read] * g;
        right[i] = this.ring[(this.read + 1) % this.capacity] * g;
        this.read = (this.read + 2) % this.capacity;
        this.filled -= 2;
      } else {
        left[i] = 0;
        right[i] = 0;
        this.underruns++;
      }
    }
    return true;
  }
}

registerProcessor('pcm', PcmProcessor);
