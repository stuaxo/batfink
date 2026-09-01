// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Sound } from '../../src/ui/sound';

const messages: unknown[] = [];

class FakePort {
  postMessage(m: unknown, _transfer?: unknown) { messages.push(m); }
}
class FakeNode {
  port = new FakePort();
  connect = vi.fn();
}
class FakeContext {
  sampleRate = 44100;
  state = 'suspended';
  destination = {};
  audioWorklet = { addModule: vi.fn().mockResolvedValue(undefined) };
  resume = vi.fn().mockImplementation(() => { this.state = 'running'; return Promise.resolve(); });
  suspend = vi.fn().mockImplementation(() => { this.state = 'suspended'; return Promise.resolve(); });
}

beforeEach(() => {
  messages.length = 0;
  vi.stubGlobal('AudioContext', FakeContext);
  vi.stubGlobal('AudioWorkletNode', FakeNode);
  vi.stubGlobal('URL', Object.assign(URL, {
    createObjectURL: () => 'blob:fake',
    revokeObjectURL: () => undefined,
  }));
});

describe('Sound', () => {
  it('starts a context, loads the worklet and resumes', async () => {
    const s = new Sound();
    expect(s.isRunning()).toBe(false);
    await s.start();
    expect(s.isRunning()).toBe(true);
    expect(s.sampleRate).toBe(44100);
  });

  it('pushes sample buffers to the worklet', async () => {
    const s = new Sound();
    await s.start();
    messages.length = 0;
    s.push(new Float32Array([0.1, -0.1, 0.2, -0.2]));
    s.push(new Float32Array(0)); // ignored
    expect(messages).toHaveLength(1);
    expect((messages[0] as { samples: Float32Array }).samples.length).toBe(4);
  });

  it('sends gain and flush control messages', async () => {
    const s = new Sound();
    await s.start();
    messages.length = 0;
    s.setVolume(0.5);
    s.flush();
    expect(messages).toContainEqual({ gain: 0.5 });
    expect(messages).toContainEqual({ flush: true });
  });

  it('clamps volume', async () => {
    const s = new Sound();
    await s.start();
    messages.length = 0;
    s.setVolume(5);
    expect(messages).toContainEqual({ gain: 1 });
  });

  it('push is a no-op before start()', () => {
    const s = new Sound();
    expect(() => s.push(new Float32Array([1, 2]))).not.toThrow();
    expect(messages).toHaveLength(0);
  });
});
