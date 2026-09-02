// 6128 RAM banking. The Gate Array RAM-config register (&7Fxx, %11cccccc)
// picks which of 8 physical 16K banks appears in each of the four 16K logical
// slots. `m.ram` always holds the *currently visible* 64K — a config change
// copies 16K slabs between `m.ram` and `m.banks` — so video, the debugger and
// snapshots read `m.ram` unchanged and the 464 pays nothing.
import type { CPCMachine } from './machine';

const B = 0x4000;

/** Physical bank (0-7) visible in slots &0000 / &4000 / &8000 / &C000, per
 *  config. Banks 0-3 are the base 64K, 4-7 the second. The standard C3 table. */
export const RAM_CONFIGS: readonly (readonly [number, number, number, number])[] = [
  [0, 1, 2, 3],
  [0, 1, 2, 7],
  [4, 5, 6, 7],
  [0, 3, 2, 7],
  [0, 4, 2, 3],
  [0, 5, 2, 3],
  [0, 6, 2, 3],
  [0, 7, 2, 3],
];

/** Turn the second 64K on or off. On: allocate the bank store, seed banks 0-3
 *  from the live 64K and clear 4-7, config 0. Off: drop it. Called on a full
 *  (re)load, never mid-run. */
export function setExtRam(m: CPCMachine, on: boolean): void {
  if (on) {
    m.banks ??= new Uint8Array(8 * B);
    m.banks.set(m.ram);       // banks 0-3 mirror the visible 64K
    m.banks.fill(0, 4 * B);   // banks 4-7 start clear
  } else {
    m.banks = null;
  }
  m.ram128 = on;
  m.bankAt.set([0, 1, 2, 3]);
  m.ramConfig = on ? 0 : m.ramConfig;
}

/** Apply a RAM-config write. No-op without the second 64K. Only the config
 *  (bits 0-2) is used — a plain 6128 has one 64K block, so the block-select
 *  bits 3-5 are ignored. */
export function setRamConfig(m: CPCMachine, v: number): void {
  m.ramConfig = v;
  const banks = m.banks;
  if (!m.ram128 || !banks) return;
  const map = RAM_CONFIGS[v & 7];

  // Two passes: write every changed slot back to the store first, then load, so
  // a bank that moves between slots in one switch (e.g. config 4 -> 2) carries
  // its latest bytes.
  const changed: number[] = [];
  for (let s = 0; s < 4; s++) {
    if (map[s] === m.bankAt[s]) continue;
    banks.set(m.ram.subarray(s * B, s * B + B), m.bankAt[s] * B);
    changed.push(s);
  }
  for (const s of changed) {
    m.ram.set(banks.subarray(map[s] * B, map[s] * B + B), s * B);
    m.bankAt[s] = map[s];
  }
}

/** Copy every visible slot back into the bank store, so `m.banks` is a complete
 *  128K image. Used before a snapshot. Leaves `m.ram` and `m.bankAt` untouched. */
export function flushBanks(m: CPCMachine): void {
  const banks = m.banks;
  if (!m.ram128 || !banks) return;
  for (let s = 0; s < 4; s++) {
    banks.set(m.ram.subarray(s * B, s * B + B), m.bankAt[s] * B);
  }
}
