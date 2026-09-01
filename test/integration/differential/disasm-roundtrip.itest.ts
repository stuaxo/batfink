// disassemble -> reassemble -> identical bytes, over the full opcode corpus and
// every example program. Needs no external tools.
import { describe, it, expect } from 'vitest';
import { assemble } from '../../../src/asm';
import { disassemble } from '../../../src/asm';
import { EXAMPLES } from '../../../src/examples';
import { opcodeCorpus } from './corpus/gen-opcodes';

function roundTrip(source: string, label: string) {
  const asm = assemble(source);
  expect(asm.errors, label).toEqual([]);

  // instruction rows only — skip db/dw/ds/equ/org and label-only lines
  const rows = asm.listing.filter((r) => {
    if (r.addr === null || r.bytes.length === 0) return false;
    const t = r.text.replace(/^\s*[A-Za-z_.@][\w.@]*\s*:/, '').trim().toLowerCase();
    return !/^(db|dw|ds|defb|defw|defs|byte|word|org|equ|align|end)\b/.test(t);
  });

  for (const row of rows) {
    let addr = row.addr!;
    const stop = addr + row.bytes.length;
    while (addr < stop) {
      const d = disassemble((a) => asm.bytes[a], addr);
      const re = assemble(`org &${addr.toString(16)}\n ${d.text}`);
      expect(re.errors, `${label} @ &${addr.toString(16)}: "${d.text}"`).toEqual([]);
      expect(
        Array.from(re.bytes.slice(addr, addr + d.length)),
        `${label} @ &${addr.toString(16)}: "${d.text}"`,
      ).toEqual(d.bytes);
      addr += d.length;
    }
  }
}

describe('disassembler round-trip', () => {
  it('opcode coverage corpus', () => {
    roundTrip(opcodeCorpus(), 'corpus');
  });

  for (const ex of EXAMPLES) {
    it(ex.id, () => roundTrip(ex.source, ex.id));
  }
});
