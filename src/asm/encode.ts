// Instruction encoder: one mnemonic + its operand strings -> bytes, via the
// Emitter the driver supplies. Everything address- and pass-aware (emit, the
// relative-jump and byte-range checks, expression evaluation) lives behind the
// Emitter so this file stays a pure opcode table.
import {
  RP, RP2, CC, ALU, CBOPS, pre, idxOf, reg8, idxHalf, isMem, inner,
} from './operands';

export interface Emitter {
  emit(...bytes: number[]): void;
  emitW(v: number): void;
  /** displacement byte for a relative jump to `target`, range-checked in pass 2 */
  rel(target: number): number;
  /** assert -128..255 in pass 2, return v & 0xFF */
  chk8(v: number): number;
  evalExpr(s: string): number;
}

export function encodeInstruction(e: Emitter, mn: string, ops: string[]): void {
  const M = mn.toUpperCase();
  const A = ops.map((s) => s.trim());
  const a0 = A[0] || '', a1 = A[1] || '';
  const U0 = a0.toUpperCase().replace(/\s+/g, ''), U1 = a1.toUpperCase().replace(/\s+/g, '');
  const { emit, emitW, chk8, rel, evalExpr } = e;

  switch (M) {
    case 'NOP': return emit(0x00);
    case 'HALT': return emit(0x76);
    case 'DI': return emit(0xf3);
    case 'EI': return emit(0xfb);
    case 'EXX': return emit(0xd9);
    case 'RLCA': return emit(0x07);
    case 'RRCA': return emit(0x0f);
    case 'RLA': return emit(0x17);
    case 'RRA': return emit(0x1f);
    case 'DAA': return emit(0x27);
    case 'CPL': return emit(0x2f);
    case 'SCF': return emit(0x37);
    case 'CCF': return emit(0x3f);
    case 'NEG': return emit(0xed, 0x44);
    case 'RETN': return emit(0xed, 0x45);
    case 'RETI': return emit(0xed, 0x4d);
    case 'RRD': return emit(0xed, 0x67);
    case 'RLD': return emit(0xed, 0x6f);
    case 'LDI': return emit(0xed, 0xa0);
    case 'LDD': return emit(0xed, 0xa8);
    case 'LDIR': return emit(0xed, 0xb0);
    case 'LDDR': return emit(0xed, 0xb8);
    case 'CPI': return emit(0xed, 0xa1);
    case 'CPIR': return emit(0xed, 0xb1);
    case 'CPD': return emit(0xed, 0xa9);
    case 'CPDR': return emit(0xed, 0xb9);
    case 'INI': return emit(0xed, 0xa2);
    case 'INIR': return emit(0xed, 0xb2);
    case 'IND': return emit(0xed, 0xaa);
    case 'INDR': return emit(0xed, 0xba);
    case 'OUTI': return emit(0xed, 0xa3);
    case 'OTIR': return emit(0xed, 0xb3);
    case 'OUTD': return emit(0xed, 0xab);
    case 'OTDR': return emit(0xed, 0xbb);

    case 'IM': {
      const v = evalExpr(a0);
      return emit(0xed, v === 0 ? 0x46 : v === 1 ? 0x56 : 0x5e);
    }

    case 'EX': {
      if (U0 === 'DE' && U1 === 'HL') return emit(0xeb);
      if (U0 === 'AF' && (U1 === "AF'" || U1 === 'AF')) return emit(0x08);
      if (U0 === '(SP)') {
        if (U1 === 'HL') return emit(0xe3);
        if (U1 === 'IX' || U1 === 'IY') return emit(pre(U1), 0xe3);
      }
      throw new Error('bad operands for EX');
    }

    case 'PUSH': case 'POP': {
      const base = M === 'PUSH' ? 0xc5 : 0xc1;
      if (U0 === 'IX' || U0 === 'IY') return emit(pre(U0), M === 'PUSH' ? 0xe5 : 0xe1);
      if (U0 in RP2) return emit(base | (RP2[U0] << 4));
      throw new Error('bad operand for ' + M);
    }

    case 'RST': {
      const v = evalExpr(a0);
      if (v & ~0x38) throw new Error('bad RST target');
      return emit(0xc7 | v);
    }

    case 'RET':
      if (!a0) return emit(0xc9);
      if (U0 in CC) return emit(0xc0 | (CC[U0] << 3));
      throw new Error('bad condition for RET');

    case 'JP':
      if (A.length === 1) {
        if (U0 === '(HL)') return emit(0xe9);
        if (U0 === '(IX)' || U0 === '(IY)') return emit(pre(U0.slice(1, 3)), 0xe9);
        emit(0xc3); return emitW(evalExpr(a0));
      }
      if (U0 in CC) { emit(0xc2 | (CC[U0] << 3)); return emitW(evalExpr(a1)); }
      throw new Error('bad condition for JP');

    case 'CALL':
      if (A.length === 1) { emit(0xcd); return emitW(evalExpr(a0)); }
      if (U0 in CC) { emit(0xc4 | (CC[U0] << 3)); return emitW(evalExpr(a1)); }
      throw new Error('bad condition for CALL');

    case 'DJNZ': { emit(0x10); return emit(rel(evalExpr(a0))); }

    case 'JR': {
      if (A.length === 1) { emit(0x18); return emit(rel(evalExpr(a0))); }
      const c = ({ NZ: 0, Z: 1, NC: 2, C: 3 } as Record<string, number>)[U0];
      if (c === undefined) throw new Error('JR only supports NZ, Z, NC, C');
      emit(0x20 | (c << 3)); return emit(rel(evalExpr(a1)));
    }

    case 'IN': {
      if (U1 === '(C)') {
        const r = U0 === 'F' ? 6 : reg8(a0);
        if (r < 0 || (r === 6 && U0 !== 'F')) throw new Error('bad register for IN');
        return emit(0xed, 0x40 | (r << 3));
      }
      if (U0 === 'A' && isMem(a1)) { emit(0xdb); return emit(chk8(evalExpr(inner(a1)))); }
      throw new Error('bad operands for IN');
    }
    case 'OUT': {
      if (U0 === '(C)') {
        const r = (U1 === '0') ? 6 : reg8(a1);
        if (r < 0) throw new Error('bad register for OUT');
        return emit(0xed, 0x41 | (r << 3));
      }
      if (isMem(a0) && U1 === 'A') { emit(0xd3); return emit(chk8(evalExpr(inner(a0)))); }
      throw new Error('bad operands for OUT');
    }

    case 'INC': case 'DEC': {
      const isInc = M === 'INC';
      if (U0 === 'IX' || U0 === 'IY') return emit(pre(U0), isInc ? 0x23 : 0x2b);
      if (U0 in RP) return emit((RP[U0] << 4) | (isInc ? 0x03 : 0x0b));
      const ih = idxHalf(a0);
      if (ih) return emit(pre(ih.reg), (ih.half << 3) | (isInc ? 0x04 : 0x05));
      const ix = idxOf(a0);
      if (ix) { emit(pre(ix.reg), isInc ? 0x34 : 0x35); return emit(chk8(evalExpr(ix.disp))); }
      const r = reg8(a0);
      if (r >= 0) return emit((r << 3) | (isInc ? 0x04 : 0x05));
      throw new Error('bad operand for ' + M);
    }

    case 'ADD': case 'ADC': case 'SBC': case 'SUB': case 'AND':
    case 'OR': case 'XOR': case 'CP': {
      let dst = a0, src = a1;
      if (A.length === 1) { dst = 'A'; src = a0; }
      const D = dst.toUpperCase().replace(/\s+/g, '');
      const S = src.toUpperCase().replace(/\s+/g, '');
      if (D === 'HL' && (M === 'ADD' || M === 'ADC' || M === 'SBC')) {
        if (!(S in RP)) throw new Error('bad 16-bit operand');
        if (M === 'ADD') return emit(0x09 | (RP[S] << 4));
        return emit(0xed, (M === 'ADC' ? 0x4a : 0x42) | (RP[S] << 4));
      }
      if ((D === 'IX' || D === 'IY') && M === 'ADD') {
        const sp = S === 'IX' || S === 'IY' ? 2 : RP[S];
        if (sp === undefined) throw new Error('bad 16-bit operand');
        if ((S === 'IX' || S === 'IY') && S !== D) throw new Error('cannot mix IX and IY');
        return emit(pre(D), 0x09 | (sp << 4));
      }
      if (D !== 'A') throw new Error(M + ' destination must be A');
      const op = ALU[M];
      const ih = idxHalf(src);
      if (ih) return emit(pre(ih.reg), 0x80 | (op << 3) | ih.half);
      const ix = idxOf(src);
      if (ix) { emit(pre(ix.reg), 0x80 | (op << 3) | 6); return emit(chk8(evalExpr(ix.disp))); }
      const r = reg8(src);
      if (r >= 0) return emit(0x80 | (op << 3) | r);
      emit(0xc6 | (op << 3)); return emit(chk8(evalExpr(src)));
    }

    case 'RLC': case 'RRC': case 'RL': case 'RR':
    case 'SLA': case 'SRA': case 'SLL': case 'SRL': {
      const op = CBOPS[M];
      const ix = idxOf(a0);
      if (ix) return emit(pre(ix.reg), 0xcb, chk8(evalExpr(ix.disp)), (op << 3) | 6);
      const r = reg8(a0);
      if (r < 0) throw new Error('bad operand for ' + M);
      return emit(0xcb, (op << 3) | r);
    }
    case 'BIT': case 'RES': case 'SET': {
      const base = M === 'BIT' ? 0x40 : M === 'RES' ? 0x80 : 0xc0;
      const b = evalExpr(a0);
      if (b < 0 || b > 7) throw new Error('bit number must be 0-7');
      const ix = idxOf(a1);
      if (ix) return emit(pre(ix.reg), 0xcb, chk8(evalExpr(ix.disp)), base | (b << 3) | 6);
      const r = reg8(a1);
      if (r < 0) throw new Error('bad operand for ' + M);
      return emit(0xcb, base | (b << 3) | r);
    }

    case 'LD': return doLD(e, a0, a1, U0, U1);
  }
  throw new Error('unknown instruction "' + mn + '"');
}

function doLD(e: Emitter, a0: string, a1: string, U0: string, U1: string): void {
  const { emit, emitW, chk8, evalExpr } = e;

  // 16-bit destinations
  if (U0 === 'SP') {
    if (U1 === 'HL') return emit(0xf9);
    if (U1 === 'IX' || U1 === 'IY') return emit(pre(U1), 0xf9);
  }
  if (U0 === 'IX' || U0 === 'IY') {
    if (isMem(a1) && !idxOf(a1)) { emit(pre(U0), 0x2a); return emitW(evalExpr(inner(a1))); }
    emit(pre(U0), 0x21); return emitW(evalExpr(a1));
  }
  if (U0 in RP) {
    if (isMem(a1)) {
      const addr = evalExpr(inner(a1));
      if (U0 === 'HL') { emit(0x2a); return emitW(addr); }
      emit(0xed, 0x4b | (RP[U0] << 4)); return emitW(addr);
    }
    emit(0x01 | (RP[U0] << 4)); return emitW(evalExpr(a1));
  }

  // memory destinations
  if (isMem(a0)) {
    const ix = idxOf(a0);
    if (ix) {
      const d = chk8(evalExpr(ix.disp));
      const r = reg8(a1);
      if (r >= 0 && r !== 6) return emit(pre(ix.reg), 0x70 | r, d);
      emit(pre(ix.reg), 0x36, d); return emit(chk8(evalExpr(a1)));
    }
    const t = inner(a0).toUpperCase().replace(/\s+/g, '');
    if (t === 'HL') {
      const r = reg8(a1);
      if (r >= 0 && r !== 6) return emit(0x70 | r);
      emit(0x36); return emit(chk8(evalExpr(a1)));
    }
    if (t === 'BC') { if (U1 !== 'A') throw new Error('only A can be stored via (BC)'); return emit(0x02); }
    if (t === 'DE') { if (U1 !== 'A') throw new Error('only A can be stored via (DE)'); return emit(0x12); }
    const addr = evalExpr(inner(a0));
    if (U1 === 'A') { emit(0x32); return emitW(addr); }
    if (U1 === 'HL') { emit(0x22); return emitW(addr); }
    if (U1 === 'IX' || U1 === 'IY') { emit(pre(U1), 0x22); return emitW(addr); }
    if (U1 in RP) { emit(0xed, 0x43 | (RP[U1] << 4)); return emitW(addr); }
    throw new Error('bad source for LD (nn),..');
  }

  // 8-bit destinations
  if (U0 === 'I') { if (U1 !== 'A') throw new Error('LD I,A only'); return emit(0xed, 0x47); }
  if (U0 === 'R') { if (U1 !== 'A') throw new Error('LD R,A only'); return emit(0xed, 0x4f); }
  if (U0 === 'A') {
    if (U1 === 'I') return emit(0xed, 0x57);
    if (U1 === 'R') return emit(0xed, 0x5f);
    const t = isMem(a1) ? inner(a1).toUpperCase().replace(/\s+/g, '') : null;
    if (t === 'BC') return emit(0x0a);
    if (t === 'DE') return emit(0x1a);
  }
  const dh = idxHalf(a0);
  if (dh) {
    const sh = idxHalf(a1);
    if (sh) return emit(pre(dh.reg), 0x40 | (dh.half << 3) | sh.half);
    const r = reg8(a1);
    if (r >= 0 && r !== 6) return emit(pre(dh.reg), 0x40 | (dh.half << 3) | r);
    emit(pre(dh.reg), 0x06 | (dh.half << 3)); return emit(chk8(evalExpr(a1)));
  }
  const d = reg8(a0);
  if (d < 0) throw new Error('bad destination "' + a0 + '"');
  const six = idxOf(a1);
  if (six) {
    if (d === 6) throw new Error('cannot LD (HL),(IX+d)');
    emit(pre(six.reg), 0x46 | (d << 3)); return emit(chk8(evalExpr(six.disp)));
  }
  const sh = idxHalf(a1);
  if (sh) { if (d === 6) throw new Error('bad LD'); return emit(pre(sh.reg), 0x40 | (d << 3) | sh.half); }
  const s = reg8(a1);
  if (s >= 0) { if (d === 6 && s === 6) throw new Error('LD (HL),(HL) is HALT'); return emit(0x40 | (d << 3) | s); }
  if (isMem(a1)) {
    if (d !== 7) throw new Error('only A can load from (nn)');
    emit(0x3a); return emitW(evalExpr(inner(a1)));
  }
  emit(0x06 | (d << 3)); return emit(chk8(evalExpr(a1)));
}
