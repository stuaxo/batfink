// Operand classification helpers shared by the instruction encoder. All pure:
// they inspect operand text and return small descriptors or register numbers.

export const R8: Record<string, number> = { B: 0, C: 1, D: 2, E: 3, H: 4, L: 5, '(HL)': 6, A: 7 };
export const RP: Record<string, number> = { BC: 0, DE: 1, HL: 2, SP: 3 };
export const RP2: Record<string, number> = { BC: 0, DE: 1, HL: 2, AF: 3 };
export const CC: Record<string, number> = { NZ: 0, Z: 1, NC: 2, C: 3, PO: 4, PE: 5, P: 6, M: 7 };
export const ALU: Record<string, number> = { ADD: 0, ADC: 1, SUB: 2, SBC: 3, AND: 4, XOR: 5, OR: 6, CP: 7 };
export const CBOPS: Record<string, number> = { RLC: 0, RRC: 1, RL: 2, RR: 3, SLA: 4, SRA: 5, SLL: 6, SRL: 7 };

/** 0xDD for IX, 0xFD for IY. */
export const pre = (r: string): number => (r === 'IX' ? 0xdd : 0xfd);

/** `(IX+d)` / `(IY-d)` -> { reg, disp } (disp is an expression string), else null. */
export function idxOf(o: string): { reg: string; disp: string } | null {
  const m = /^\(\s*(IX|IY)\s*([+-][^)]*)?\)$/i.exec(o);
  if (!m) return null;
  return { reg: m[1].toUpperCase(), disp: m[2] ? m[2] : '0' };
}

/** register number 0-7 for an 8-bit operand ((HL) is 6), or -1. */
export function reg8(o: string): number {
  const u = o.toUpperCase().replace(/\s+/g, '');
  if (u in R8) return R8[u];
  if (u === '(HL)') return 6;
  return -1;
}

/** `IXH` / `IYL` etc -> { reg, half } where half is 4 (H) or 5 (L), else null. */
export function idxHalf(o: string): { reg: string; half: number } | null {
  const m = /^(IX|IY)(H|L)$/i.exec(o.trim());
  if (!m) return null;
  return { reg: m[1].toUpperCase(), half: m[2].toUpperCase() === 'H' ? 4 : 5 };
}

/** true for a parenthesised (memory) operand. */
export const isMem = (o: string): boolean => /^\(.*\)$/.test(o.trim());

/** strip one layer of parentheses. */
export const inner = (o: string): string => o.trim().slice(1, -1).trim();
