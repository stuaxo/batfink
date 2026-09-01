import { describe, it, expect } from 'vitest';
import { assemble } from '../../src/asm/assembler';
import { makeZ80 } from '../../src/z80/cpu';
import { makeCPC, runFrame, runUntil, AudioSink } from '../../src/cpc';

// A tone on channel A, driven by poking the PPI like bare-metal code does.
const TONE = `
       org &4000
start: di
       ld sp,&BFF0
       ld de,&008E
       call psg        ; R0 tone A fine
       ld de,&0101
       call psg        ; R1 tone A coarse
       ld de,&080F
       call psg        ; R8 volume A = 15
       ld de,&073E
       call psg        ; R7 mixer: tone A on, rest off
spin:  jr spin

psg:   ld bc,&F400
       out (c),d       ; port A = register number
       ld bc,&F6C0
       out (c),c       ; port C: latch address
       ld bc,&F600
       out (c),c       ; inactive
       ld bc,&F400
       out (c),e       ; port A = value
       ld bc,&F680
       out (c),c       ; port C: write
       ld bc,&F600
       out (c),c       ; inactive
       ret
`;

function boot(src: string, withAudio: boolean) {
  const r = assemble(src);
  expect(r.errors).toEqual([]);
  const m = makeCPC();
  const cpu = makeZ80(m.bus);
  m.reset();
  m.ram.fill(0);
  for (let a = r.start; a < r.end; a++) m.ram[a] = r.bytes[a];
  cpu.reset();
  cpu.PC = 'START' in r.symbols ? r.symbols['START'] : r.start;
  if (withAudio) {
    m.audio = new AudioSink(44100);
    m.psgWrite = (reg, v) => m.audio!.ay.writeReg(reg, v);
  }
  return { m, cpu };
}

const rms = (b: Float32Array) => Math.sqrt([...b].reduce((a, v) => a + v * v, 0) / (b.length || 1));

describe('AudioSink wired to the machine', () => {
  /** Run `frames`, draining each one like the app does. */
  function runDraining(cpu: ReturnType<typeof makeZ80>, m: ReturnType<typeof makeCPC>, frames: number): Float32Array {
    const chunks: Float32Array[] = [];
    for (let f = 0; f < frames; f++) {
      runUntil(cpu, m, { frame: true, audio: true });
      chunks.push(m.audio!.drain());
    }
    const total = chunks.reduce((a, c) => a + c.length, 0);
    const out = new Float32Array(total);
    let o = 0;
    for (const c of chunks) { out.set(c, o); o += c.length; }
    return out;
  }

  it('produces roughly one sample rate worth of samples per second', () => {
    const { m, cpu } = boot(TONE, true);
    const out = runDraining(cpu, m, 50); // 1 second
    expect(out.length / 2).toBeGreaterThan(43000);
    expect(out.length / 2).toBeLessThan(45000);
  });

  it('a program that pokes the PSG is not silent', () => {
    const { m, cpu } = boot(TONE, true);
    const out = runDraining(cpu, m, 40);
    expect(rms(out.subarray(out.length >> 1))).toBeGreaterThan(0.02); // settled tail
  });

  it('a program that never touches the PSG is silent', () => {
    const { m, cpu } = boot('      org &4000\nspin: jr spin', true);
    expect(rms(runDraining(cpu, m, 40))).toBe(0);
  });

  it('does not generate audio without the audio flag', () => {
    const { m, cpu } = boot(TONE, true);
    for (let f = 0; f < 10; f++) runUntil(cpu, m, { frame: true }); // no audio:true
    expect(m.audio!.drain().length).toBe(0);
  });

  it('runFrame still works with no audio sink', () => {
    const { m, cpu } = boot(TONE, false);
    expect(() => { for (let f = 0; f < 10; f++) runFrame(cpu, m); }).not.toThrow();
    expect(m.frames).toBe(10);
  });

  it('drain empties the buffer', () => {
    const { m, cpu } = boot(TONE, true);
    for (let f = 0; f < 5; f++) runUntil(cpu, m, { frame: true, audio: true });
    expect(m.audio!.drain().length).toBeGreaterThan(0);
    expect(m.audio!.drain().length).toBe(0);
  });
});
