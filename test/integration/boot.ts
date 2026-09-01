// The assemble -> load -> reset -> set PC dance, shared by the integration
// specs. Mirrors the helper in test/examples/examples.test.ts.
import { assemble, type AssembleResult } from '../../src/asm';
import { makeZ80, type Z80 } from '../../src/z80/cpu';
import { makeCPC, type CPCMachine } from '../../src/cpc';

export interface Booted {
  result: AssembleResult;
  m: CPCMachine;
  cpu: Z80;
  entry: number;
}

export function boot(source: string): Booted {
  const result = assemble(source);
  if (result.errors.length) {
    throw new Error(`assemble failed: ${result.errors.map((e) => `line ${e.line}: ${e.message}`).join('; ')}`);
  }
  const m = makeCPC();
  const cpu = makeZ80(m.bus);
  m.reset();
  m.ram.fill(0);
  for (let a = result.start; a < result.end; a++) m.ram[a] = result.bytes[a];
  cpu.reset();
  const entry = 'START' in result.symbols ? result.symbols['START'] : result.start;
  cpu.PC = entry;
  return { result, m, cpu, entry };
}
