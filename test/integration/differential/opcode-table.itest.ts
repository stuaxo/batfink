// Assembles a generated coverage corpus with our assembler and with rasm /
// pasmo, and compares the bytes line by line. A diff is a real encoding bug or
// a genuine dialect divergence (allowlisted per tool).
import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { assemble, type AssembleResult } from '../../../src/asm';
import { runAssembler, type Assembler } from '../asm-tools';
import { RASM, PASMO, announce } from '../tools';
import { opcodeCorpus } from './corpus/gen-opcodes';

/**
 * Assemble with a tool that aborts on the first parse error (pasmo). Lines it
 * rejects are replaced, in place, with `db` of the bytes our assembler produced
 * — so addresses stay aligned and we simply don't compare those lines.
 */
function assembleTolerant(
  bin: string, kind: Assembler, source: string, ours: AssembleResult,
): { bytes: Uint8Array; skipped: number[] } {
  const lines = source.split('\n');
  const byLine = new Map<number, number[]>();
  for (const r of ours.listing) if (r.addr !== null && r.bytes.length) byLine.set(r.line, r.bytes);
  const skipped: number[] = [];

  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      return { bytes: runAssembler(bin, kind, lines.join('\n')), skipped };
    } catch (err) {
      const m = /on line (\d+)/.exec(String((err as { stderr?: Buffer }).stderr ?? err));
      const n = m ? Number(m[1]) : 0;
      if (!n || skipped.includes(n)) throw err;
      const bytes = byLine.get(n);
      lines[n - 1] = bytes ? '     db ' + bytes.join(',') : '';
      skipped.push(n);
    }
  }
  throw new Error('too many rejected lines');
}

const ARTIFACT = fileURLToPath(new URL('./corpus/opcodes.neutral.asm', import.meta.url));
const allowlist = (name: Assembler) =>
  JSON.parse(
    readFileSync(fileURLToPath(new URL(`./allowlists/${name}.json`, import.meta.url)), 'utf8'),
  ) as { skipContains: string[]; knownDiffs: { contains: string; note: string }[] };

describe('opcode-table differential', () => {
  const source = opcodeCorpus();

  it('the committed corpus artifact is up to date', () => {
    if (process.env.WRITE_CORPUS === '1') {
      writeFileSync(ARTIFACT, source);
      return;
    }
    expect(existsSync(ARTIFACT), 'run WRITE_CORPUS=1 to create it').toBe(true);
    expect(readFileSync(ARTIFACT, 'utf8')).toBe(source);
  });

  it('every mnemonic our encoder handles appears in the corpus', () => {
    const encode = readFileSync(
      fileURLToPath(new URL('../../../src/asm/encode.ts', import.meta.url)),
      'utf8',
    );
    const cases = [...encode.matchAll(/case '([A-Z]{2,6})':/g)].map((m) => m[1].toLowerCase());
    const lower = source.toLowerCase();
    const missing = [...new Set(cases)].filter((mn) => !new RegExp(`\\b${mn}\\b`).test(lower));
    expect(missing, 'mnemonics not exercised by the corpus').toEqual([]);
  });

  const ours = assemble(source);

  it('our assembler accepts the corpus', () => {
    expect(ours.errors).toEqual([]);
  });

  for (const [name, bin] of [['rasm', RASM], ['pasmo', PASMO]] as const) {
    describe.skipIf(!announce(`differential/${name}`, !!bin, `install ${name} or set ${name.toUpperCase()}_BIN`))(
      name,
      () => {
        it('encodes every corpus line the same as our assembler', () => {
          const { bytes: ref, skipped } =
            name === 'pasmo'
              ? assembleTolerant(bin!, name, source, ours)
              : { bytes: runAssembler(bin!, name, source), skipped: [] as number[] };
          if (skipped.length) console.info(`[${name}] auto-skipped ${skipped.length} rejected line(s): ${skipped.join(', ')}`);
          const allow = allowlist(name);
          const skippedSet = new Set(skipped);

          // address -> source line, from listing rows that emitted a small run
          // (skips the ORG row, which spans the whole image)
          const lineAt = new Map<number, { line: number; text: string }>();
          for (const row of ours.listing) {
            if (row.addr === null || row.bytes.length === 0 || row.bytes.length > 8) continue;
            for (let i = 0; i < row.bytes.length; i++) {
              if (!lineAt.has(row.addr + i)) lineAt.set(row.addr + i, { line: row.line, text: row.text.trim() });
            }
          }

          const seen = new Set<number>();
          const diffs: string[] = [];
          for (let a = ours.start; a < ours.end; a++) {
            if (!ours.used[a] || ours.bytes[a] === ref[a - ours.start]) continue;
            const info = lineAt.get(a) ?? { line: -1, text: `addr 0x${a.toString(16)}` };
            if (seen.has(info.line)) continue;
            seen.add(info.line);
            if (skippedSet.has(info.line)) continue;
            if (allow.skipContains.some((s) => info.text.includes(s))) continue;
            const row = ours.listing.find((r) => r.line === info.line && r.addr !== null);
            const oh = row ? row.bytes.map((b) => b.toString(16).padStart(2, '0')).join(' ') : '?';
            const rh = row
              ? row.bytes.map((_, k) => (ref[row.addr! + k - ours.start] ?? -1).toString(16).padStart(2, '0')).join(' ')
              : '?';
            diffs.push(`line ${info.line}: ${info.text}\n    ours: ${oh}\n    ${name}: ${rh}`);
          }

          const real = diffs.filter((d) => !allow.knownDiffs.some((k) => d.includes(k.contains)));
          if (diffs.length !== real.length) {
            console.info(`[${name}] ${diffs.length - real.length} allowlisted diff(s) ignored`);
          }
          expect(ref.length, `${name} produced ${ref.length} bytes, ours ${ours.end - ours.start}`).toBe(ours.end - ours.start);
          expect(real, '\n' + real.join('\n')).toEqual([]);
        });
      },
    );
  }
});
