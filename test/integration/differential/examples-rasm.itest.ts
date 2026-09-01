// Assembles every example program and the demo with rasm (same Amstrad dialect)
// and compares the whole binary to our assembler's output. A diff here is a real
// assembler bug or a genuine dialect divergence.
import { describe, it, expect } from 'vitest';
import { assemble } from '../../../src/asm';
import { EXAMPLES } from '../../../src/examples';
import { runAssembler } from '../asm-tools';
import { RASM, announce } from '../tools';

describe.skipIf(!announce('differential/examples-rasm', !!RASM, 'build rasm or set RASM_BIN'))(
  'examples vs rasm',
  () => {
    for (const ex of EXAMPLES) {
      it(ex.id, () => {
        const ours = assemble(ex.source);
        expect(ours.errors, ours.errors.map((e) => `line ${e.line}: ${e.message}`).join('\n')).toEqual([]);

        const ref = runAssembler(RASM!, 'rasm', ex.source);
        const oursBytes = ours.bytes.subarray(ours.start, ours.end);

        if (ref.length !== oursBytes.length) {
          console.warn(`[${ex.id}] length differs: ours ${oursBytes.length}, rasm ${ref.length} — comparing the overlap`);
        }
        const n = Math.min(ref.length, oursBytes.length);
        let firstDiff = -1;
        for (let i = 0; i < n; i++) {
          if (oursBytes[i] !== ref[i]) { firstDiff = i; break; }
        }
        if (firstDiff >= 0) {
          const addr = ours.start + firstDiff;
          const row = ours.listing.find((r) => r.addr !== null && addr >= r.addr && addr < r.addr + r.bytes.length);
          const ctx = row ? `line ${row.line}: ${row.text.trim()}` : `address 0x${addr.toString(16)}`;
          const slice = (b: Uint8Array, o: number) =>
            [...b.subarray(o, o + 6)].map((v) => v.toString(16).padStart(2, '0')).join(' ');
          expect.fail(`${ex.id} diverges at 0x${addr.toString(16)} (${ctx})\n    ours: ${slice(oursBytes, firstDiff)}\n    rasm: ${slice(ref, firstDiff)}`);
        }
        expect(oursBytes.length).toBe(ref.length);
      });
    }
  },
);
