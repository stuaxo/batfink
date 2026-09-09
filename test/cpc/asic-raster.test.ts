import { describe, it, expect } from 'vitest';
import { makeZ80, type Z80 } from '../../src/z80/cpu';
import { makeCPC, runFrame, ASIC, ASIC_UNLOCK } from '../../src/cpc';

function plus(pri: number, ivr = 0) {
  const m = makeCPC('gx4000');
  const cpu = makeZ80(m.bus);
  m.reset();
  cpu.reset();
  cpu.IFF1 = 1;
  for (const b of ASIC_UNLOCK) m.bus.out(0xbc00, b);
  m.bus.out(0xdf00, 0xb8);
  m.bus.write(0x4000 + ASIC.PRI, pri);
  m.bus.write(0x4000 + ASIC.IVR, ivr);
  m.bus.out(0xdf00, 0x00);
  return { m, cpu };
}

/** Record the scanline each interrupt is raised on across one frame. */
function irqLines(cpu: Z80, m: ReturnType<typeof makeCPC>): number[] {
  const lines: number[] = [];
  const orig = cpu.interrupt;
  cpu.interrupt = ((v?: number) => {
    if (cpu.IFF1) lines.push(m.lineCounter);
    const t = orig(v);
    cpu.IFF1 = 1; // re-arm so we see every attempt this frame
    return t;
  }) as typeof cpu.interrupt;
  runFrame(cpu, m);
  return lines;
}

describe('programmable raster interrupt', () => {
  it('fires one interrupt per frame at the PRI scanline', () => {
    const { m, cpu } = plus(100);
    expect(irqLines(cpu, m)).toEqual([100]);
  });

  it('a non-zero PRI suppresses the Gate Array cadence', () => {
    const withPri = plus(80);
    const noPri = plus(0);
    expect(irqLines(withPri.cpu, withPri.m).length).toBe(1);
    expect(irqLines(noPri.cpu, noPri.m).length).toBeGreaterThan(1);
  });

  it('IVR supplies the IM 2 vector low byte', () => {
    const { m, cpu } = plus(50, 0x40);
    cpu.IM = 2;
    cpu.I = 0x20;
    m.ram[0x2040] = 0x34;
    m.ram[0x2041] = 0x12; // vector table entry -> &1234

    let pcAfter = -1;
    const orig = cpu.interrupt;
    cpu.interrupt = ((v?: number) => { const t = orig(v); pcAfter = cpu.PC; return t; }) as typeof cpu.interrupt;
    runFrame(cpu, m);
    expect(pcAfter).toBe(0x1234); // (I<<8) | (IVR & 0xFE) = &2040
  });

  it('a locked ASIC keeps the classic cadence even with PRI set', () => {
    const m = makeCPC('gx4000');
    const cpu = makeZ80(m.bus);
    m.reset();
    cpu.reset();
    cpu.IFF1 = 1;
    m.asic!.regs[ASIC.PRI] = 100; // written without unlocking / paging in
    expect(irqLines(cpu, m).length).toBeGreaterThan(1);
  });
});
