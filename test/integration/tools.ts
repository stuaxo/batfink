// Capability detection for the opt-in suite. Every spec asks here whether its
// tool or fixture is present and skips cleanly (with an install hint) if not.
//
// PATH is unreliable under npm scripts, so the *_BIN / *_DIR env vars are the
// supported way to point at a tool or a local checkout.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

function which(bin: string): string | null {
  try {
    const out = execFileSync('sh', ['-c', `command -v ${bin} 2>/dev/null`], { encoding: 'utf8' }).trim();
    return out || null;
  } catch {
    return null;
  }
}

const dir = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));

export const FIXTURES = dir('./fixtures/');
export const Z80_FIXTURES = dir('./fixtures/z80/');
export const SST_DIR = process.env.Z80_SST_DIR ?? dir('./fixtures/z80/SingleStepTests/v1/');

export const RASM = process.env.RASM_BIN ?? which('rasm');
export const PASMO = process.env.PASMO_BIN ?? which('pasmo');
export const MAME = process.env.MAME_BIN ?? which('mame');
export const MAME_ROMPATH = process.env.MAME_ROMPATH ?? null;

export const zexFixture = (name: string) => dir(`./fixtures/z80/${name}`);

export const havePrelim = () => existsSync(zexFixture('prelim.com'));
export const haveZexdoc = () => existsSync(zexFixture('zexdoc.com'));
export const haveZexall = () => existsSync(zexFixture('zexall.com'));

export function haveSst(): boolean {
  try {
    return existsSync(SST_DIR) && readdirSync(SST_DIR).some((f) => f.endsWith('.json'));
  } catch {
    return false;
  }
}

const announced = new Set<string>();

/** Log a one-time install hint when a capability is missing; returns `ok`. */
export function announce(name: string, ok: boolean, hint: string): boolean {
  if (!ok && !announced.has(name)) {
    announced.add(name);
    console.info(`[integration] skipping ${name} — ${hint}`);
  }
  return ok;
}

/** Env flag is truthy when set to anything other than "" / "0" / "false". */
export const flag = (name: string): boolean => {
  const v = process.env[name];
  return v !== undefined && v !== '' && v !== '0' && v !== 'false';
};
