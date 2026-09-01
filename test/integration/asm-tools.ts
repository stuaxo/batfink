// Run an external assembler on a source string and return the raw bytes.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export type Assembler = 'rasm' | 'pasmo';

export function runAssembler(bin: string, kind: Assembler, source: string): Uint8Array {
  const dir = mkdtempSync(join(tmpdir(), 'batfink-asm-'));
  try {
    const src = join(dir, 'in.asm');
    writeFileSync(src, source);
    if (kind === 'rasm') {
      // -amper: `&` is hex (our dialect). -eo: errors to stdout for capture.
      execFileSync(bin, [src, '-amper', '-o', join(dir, 'out')], { stdio: 'pipe' });
      return new Uint8Array(readFileSync(join(dir, 'out.bin')));
    }
    const out = join(dir, 'out.bin');
    execFileSync(bin, ['--bin', src, out], { stdio: 'pipe' });
    return new Uint8Array(readFileSync(out));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
