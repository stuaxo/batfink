// A minimal CP/M host: enough BDOS to run the Frank Cringle Z80 exercisers
// (prelim / zexdoc / zexall) on our CPU core and collect what they print.
import { makeZ80 } from '../../src/z80/cpu';
import type { Bus } from '../../src/z80/bus';

export interface CpmRun {
  output: string;
  steps: number;
  stopped: 'warm-boot' | 'step-limit' | 'timeout';
}

// Async so a multi-minute run (zexdoc/zexall) yields to the event loop and
// vitest's worker heartbeat does not time out.
export async function runCpmProgram(
  com: Uint8Array,
  opts: { maxSteps?: number; maxMs?: number } = {},
): Promise<CpmRun> {
  const maxSteps = opts.maxSteps ?? 6_000_000_000;
  const maxMs = opts.maxMs ?? 25 * 60_000;

  const ram = new Uint8Array(0x10000);
  // Warm-boot and BDOS entry points. We trap PC before it executes at 0 or 5;
  // the JP stubs and the memory-top word at &0006 are what the programs read.
  ram[0] = 0xc3; ram[1] = 0x03; ram[2] = 0xff; // JP &FF03
  ram[5] = 0xc3; ram[6] = 0x00; ram[7] = 0xfe; // JP &FE00
  ram.set(com.subarray(0, 0x10000 - 0x100), 0x100);

  const bus: Bus = {
    read: (a) => ram[a & 0xffff],
    write: (a, v) => { ram[a & 0xffff] = v & 0xff; },
    in: () => 0xff,
    out: () => {},
  };

  const cpu = makeZ80(bus);
  cpu.reset();
  cpu.PC = 0x100;
  cpu.SP = 0xeffe;
  ram[0xeffe] = 0x00; ram[0xefff] = 0x00; // top-level RET -> warm boot

  let output = '';
  const start = Date.now();
  let steps = 0;
  let stopped: CpmRun['stopped'] = 'step-limit';

  for (; steps < maxSteps; steps++) {
    const pc = cpu.PC;
    if (pc === 0x0000) { stopped = 'warm-boot'; break; }
    if (pc === 0x0005) {
      const fn = cpu.R[1]; // C
      if (fn === 0) { stopped = 'warm-boot'; break; }
      if (fn === 2) {
        output += String.fromCharCode(cpu.R[3]); // E
      } else if (fn === 9) {
        let de = cpu.getDE();
        for (let g = 0; g < 0x10000; g++, de++) {
          const ch = ram[de & 0xffff];
          if (ch === 0x24) break; // '$'
          output += String.fromCharCode(ch);
        }
      }
      const lo = ram[cpu.SP];
      const hi = ram[(cpu.SP + 1) & 0xffff];
      cpu.SP = (cpu.SP + 2) & 0xffff;
      cpu.PC = lo | (hi << 8);
      continue;
    }
    cpu.step();
    if ((steps & 0x3fffff) === 0) {
      if (Date.now() - start > maxMs) { stopped = 'timeout'; break; }
      await new Promise<void>((r) => setImmediate(r));
    }
  }

  return { output, steps, stopped };
}
