#!/usr/bin/env node
// Downloads the fixtures the opt-in integration suite needs. Idempotent;
// nothing here is committed (test/integration/fixtures/ is gitignored).
//
//   node scripts/fetch-fixtures.mjs            # zex binaries + a curated SST subset
//   SST_OPCODES=all node scripts/fetch-fixtures.mjs   # every SingleStepTests file
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../test/integration/fixtures/', import.meta.url));
const Z80 = ROOT + 'z80/';
const SST = Z80 + 'SingleStepTests/v1/';

// --- Frank Cringle Z80 exercisers -----------------------------------
// Pinned to superzazu/z80 (MIT), which vendors the assembled binaries.
const ZEX_BASE = 'https://raw.githubusercontent.com/superzazu/z80/d64fe10a2274e5e40019b1086bf7d8990cbc5f23/roms/';
const ZEX = [
  ['prelim.com', 'prelim.com', '3b3578f19030a4df7e25ce852f763af26053b12582a576c4dffb014aa7c590d1'],
  ['zexdoc.cim', 'zexdoc.com', '10b7c3972ff6765712ed160e5bd8750e4a13642f62b75711e062ef06a7f2f7b5'],
  ['zexall.cim', 'zexall.com', 'af7e5d86146d390a68440fb85668648f14a648602da29a1816d2ef11459411ae'],
];

// --- SingleStepTests z80/v1 (MIT) ---------------------------------
const SST_COMMIT = 'ebe1875d48f374bcfd4b505d8eb8ee751568b5f7';
const SST_RAW = `https://raw.githubusercontent.com/SingleStepTests/z80/${SST_COMMIT}/v1/`;
const SST_TAR = `https://codeload.github.com/SingleStepTests/z80/tar.gz/${SST_COMMIT}`;

// One file per instruction class our encoder emits: base, CB, ED (block ops,
// IN/OUT, 16-bit ALU), DD/FD (IX/IY) and the DDCB/FDCB sub-pages.
const SST_SUBSET = [
  '00', '01', '02', '07', '08', '09', '0a', '0f', '10', '17', '18', '1f', '20', '21',
  '22', '27', '28', '2a', '2f', '31', '32', '34', '35', '36', '37', '3a', '3f', '40',
  '46', '70', '76', '78', '7e', '80', '86', '88', '90', '98', 'a0', 'a8', 'b0', 'b8',
  'c0', 'c3', 'c5', 'c6', 'c9', 'cd', 'd3', 'db', 'd9', 'e3', 'e9', 'eb', 'f1', 'f3',
  'f5', 'f9', 'fb', 'fe',
  'cb 00', 'cb 06', 'cb 3f', 'cb 46', 'cb 86', 'cb c6',
  'ed 40', 'ed 41', 'ed 42', 'ed 44', 'ed 4a', 'ed 4b', 'ed 57', 'ed 5f', 'ed 67',
  'ed 6f', 'ed a0', 'ed a1', 'ed a2', 'ed a3', 'ed b0', 'ed b1',
  'dd 09', 'dd 21', 'dd 22', 'dd 23', 'dd 24', 'dd 2a', 'dd 34', 'dd 36', 'dd 46',
  'dd 70', 'dd 7e', 'dd 86', 'dd e1', 'dd e3', 'dd e5', 'dd e9', 'dd f9',
  'dd cb __ 06', 'dd cb __ 46', 'dd cb __ 86', 'dd cb __ c6', 'dd cb __ 3e',
  'fd 21', 'fd 46', 'fd 86', 'fd e5', 'fd cb __ 46',
];

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

async function get(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

async function fetchZex() {
  mkdirSync(Z80, { recursive: true });
  for (const [remote, local, hash] of ZEX) {
    const dest = Z80 + local;
    if (existsSync(dest) && sha256(readFileSync(dest)) === hash) {
      console.log(`ok    ${local}`);
      continue;
    }
    const buf = await get(ZEX_BASE + remote);
    const got = sha256(buf);
    if (got !== hash) throw new Error(`checksum mismatch for ${remote}: expected ${hash}, got ${got}`);
    writeFileSync(dest, buf);
    console.log(`saved ${local}  (${buf.length} bytes)`);
  }
  writeFileSync(
    Z80 + 'NOTICE',
    [
      'prelim.com / zexdoc.com / zexall.com',
      'Frank Cringle Z80 instruction exercisers (1994), CP/M ports.',
      `Fetched from superzazu/z80 @ d64fe10 (MIT). "May be freely distributed."`,
      '',
      'SingleStepTests/ — github.com/SingleStepTests/z80 @ ' + SST_COMMIT + ' (MIT).',
      '',
      'This directory is gitignored; regenerate with `npm run fetch:fixtures`.',
    ].join('\n') + '\n',
  );
}

async function fetchSstSubset() {
  mkdirSync(SST, { recursive: true });
  for (const name of SST_SUBSET) {
    const dest = SST + name + '.json';
    if (existsSync(dest)) continue;
    const buf = await get(SST_RAW + encodeURIComponent(name) + '.json');
    writeFileSync(dest, buf);
  }
  console.log(`saved ${SST_SUBSET.length} SingleStepTests files -> ${SST}`);
}

function fetchSstAll() {
  mkdirSync(Z80, { recursive: true });
  const tgz = Z80 + 'sst.tar.gz';
  console.log('downloading full SingleStepTests archive (large)…');
  execFileSync('curl', ['-sSL', SST_TAR, '-o', tgz]);
  rmSync(Z80 + 'SingleStepTests', { recursive: true, force: true });
  mkdirSync(SST, { recursive: true });
  execFileSync('tar', [
    '-xzf', tgz, '-C', SST, '--strip-components=2',
    `z80-${SST_COMMIT}/v1`,
  ]);
  rmSync(tgz, { force: true });
  console.log(`extracted full SingleStepTests set -> ${SST}`);
}

await fetchZex();
if (process.env.SST_OPCODES === 'all') fetchSstAll();
else await fetchSstSubset();
console.log('done.');
