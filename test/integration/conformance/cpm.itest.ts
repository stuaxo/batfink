// Frank Cringle's Z80 exercisers run on our CPU core through a minimal CP/M
// host. `prelim` is quick and always runs; `zexdoc` / `zexall` are slow (minutes
// in JS) and opt-in via env.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runCpmProgram } from '../cpm';
import { zexFixture, havePrelim, haveZexdoc, haveZexall, announce, flag } from '../tools';

const load = (name: string) => new Uint8Array(readFileSync(zexFixture(name)));

/** zex prints "<name>....  OK" or "<name>....  ERROR ..." per sub-test. */
function parseZex(output: string) {
  const pass: string[] = [];
  const fail: string[] = [];
  for (const line of output.split(/\r?\n/)) {
    const m = /^\s*(.+?)\.{2,}\s+(OK|ERROR)/.exec(line);
    if (!m) continue;
    (m[2] === 'OK' ? pass : fail).push(m[1].trim());
  }
  return { pass, fail, complete: /Tests complete/.test(output) };
}

describe.skipIf(!announce('conformance/prelim', havePrelim(), 'run `npm run fetch:fixtures`'))(
  'prelim',
  () => {
    it('passes the preliminary exerciser', () => {
      const r = runCpmProgram(load('prelim.com'), { maxMs: 60_000 });
      expect(r.output).toContain('Preliminary tests complete');
      expect(r.output).not.toMatch(/ERROR/);
      expect(r.stopped).toBe('warm-boot');
    });
  },
);

describe.skipIf(
  !announce(
    'conformance/zexdoc',
    haveZexdoc() && flag('ZEX'),
    haveZexdoc() ? 'set ZEX=1 to run (~5-12 min)' : 'run `npm run fetch:fixtures`',
  ),
)('zexdoc', () => {
  it('passes every documented-flag CRC', () => {
    const r = runCpmProgram(load('zexdoc.com'), { maxMs: 20 * 60_000 });
    const { fail, complete } = parseZex(r.output);
    expect(complete, r.output.slice(-2000)).toBe(true);
    expect(fail).toEqual([]);
  }, 25 * 60_000);
});

describe.skipIf(
  !announce(
    'conformance/zexall',
    haveZexall() && flag('ZEXALL'),
    haveZexall() ? 'set ZEXALL=1 to run (~10-40 min)' : 'run `npm run fetch:fixtures`',
  ),
)('zexall', () => {
  it('does not regress against the known-failing baseline', async () => {
    const baseline = JSON.parse(
      readFileSync(fileURLToPath(new URL('./baselines/zexall.json', import.meta.url)), 'utf8'),
    ) as { knownFailing: string[] };
    const known = new Set(baseline.knownFailing);

    const r = runCpmProgram(load('zexall.com'), { maxMs: 40 * 60_000 });
    const { pass, fail, complete } = parseZex(r.output);
    expect(complete, r.output.slice(-2000)).toBe(true);

    const newFailures = fail.filter((n) => !known.has(n));
    expect(newFailures, 'undocumented-flag regressions').toEqual([]);

    const fixed = pass.filter((n) => known.has(n));
    if (fixed.length) console.info(`[zexall] now passing (tighten baseline): ${fixed.join(', ')}`);
  }, 45 * 60_000);
});
