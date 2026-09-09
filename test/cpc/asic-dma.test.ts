import { describe, it, expect } from 'vitest';
import { makeZ80 } from '../../src/z80/cpu';
import { makeCPC, stepDma, getState, setState, ASIC } from '../../src/cpc';

/** Set up channel 0 with a word list at &8000 and start it. Prescaler 0 -> one
 *  entry per 4 T-states. */
function armChannel0(m: ReturnType<typeof makeCPC>, list: number[]): void {
  list.forEach((w, i) => { m.ram[0x8000 + i * 2] = w & 0xff; m.ram[0x8000 + i * 2 + 1] = (w >> 8) & 0xff; });
  const a = m.asic!;
  a.regs[ASIC.DMA] = 0x00;
  a.regs[ASIC.DMA + 1] = 0x80;
  a.regs[ASIC.DMA + 2] = 0; // prescaler
  a.regs[ASIC.DCSR] = 0x01; // enable channel 0
  a.onRegWrite(ASIC.DCSR);
}

const run = (m: ReturnType<typeof makeCPC>, entries: number) => {
  for (let i = 0; i < entries; i++) stepDma(m, 4);
};

describe('DMA sound', () => {
  it('LOAD writes PSG registers; STOP halts the channel', () => {
    const m = makeCPC('gx4000');
    m.reset();
    armChannel0(m, [0x0042, 0x0103, 0x0099, 0x4020]);
    expect(m.asic!.dmaOn).toBe(true);

    run(m, 1); expect(m.psg[0]).toBe(0x42);
    run(m, 1); expect(m.psg[1]).toBe(0x03);
    run(m, 1); expect(m.psg[0]).toBe(0x99);
    run(m, 1); // STOP
    expect(m.asic!.dmaOn).toBe(false);
  });

  it('PAUSE delays the next entry', () => {
    const m = makeCPC('gx4000');
    m.reset();
    armChannel0(m, [0x1003, 0x0055, 0x4020]); // pause 3, then LOAD r0=&55
    run(m, 4); // read PAUSE + 3 wait ticks
    expect(m.psg[0]).toBe(0); // not loaded yet
    run(m, 1);
    expect(m.psg[0]).toBe(0x55);
  });

  it('REPEAT / LOOP repeats a body a fixed number of times', () => {
    const m = makeCPC('gx4000');
    m.reset();
    // REPEAT x2, body: LOAD r0=7, LOOP; then LOAD r0=&FF, STOP
    armChannel0(m, [0x2002, 0x0007, 0x4001, 0x00ff, 0x4020]);
    run(m, 40);
    expect(m.psg[0]).toBe(0xff); // the loop ran out and execution continued
    expect(m.asic!.dmaOn).toBe(false);
  });

  it('a zero repeat count loops forever', () => {
    const m = makeCPC('gx4000');
    m.reset();
    armChannel0(m, [0x2000, 0x0007, 0x4001, 0x00ff]);
    run(m, 100);
    expect(m.psg[0]).toBe(0x07); // never reached the &FF
    expect(m.asic!.dmaOn).toBe(true);
  });

  it('a channel does nothing until DCSR enables it', () => {
    const m = makeCPC('gx4000');
    m.reset();
    m.ram[0x8000] = 0x42; m.ram[0x8001] = 0x00;
    m.asic!.regs[ASIC.DMA] = 0; m.asic!.regs[ASIC.DMA + 1] = 0x80;
    run(m, 5);
    expect(m.psg[0]).toBe(0);
    expect(m.asic!.dmaOn).toBe(false);
  });

  it('round-trips through getState / setState mid-list', () => {
    const m = makeCPC('gx4000');
    const cpu = makeZ80(m.bus);
    m.reset();
    armChannel0(m, [0x0011, 0x0222, 0x0433, 0x4020]); // r0=&11, r2=&22, r4=&33
    run(m, 1);
    const snap = getState(cpu, m);
    expect(snap.asic?.dmaOn).toBe(true);

    run(m, 3); // finish it on the original
    m.asic!.reset();
    setState(cpu, m, snap); // back to after entry 1
    run(m, 1);
    expect(m.psg[2]).toBe(0x22); // resumed at entry 2
  });
});
