// Z80 CPU core. Sufficient subset for CPC demo code:
// all base opcodes, CB, ED (block ops, IN/OUT, 16-bit ALU), DD/FD (IX/IY).
import type { Bus } from './bus';

export interface Z80 {
  /** 0=B 1=C 2=D 3=E 4=H 5=L 6=unused 7=A */
  R: Uint8Array;
  /** shadow register file */
  Rs: Uint8Array;
  F: number;
  Fs: number;
  SP: number;
  PC: number;
  IX: number;
  IY: number;
  I: number;
  /** memory-refresh register */
  Rr: number;
  IFF1: number;
  IFF2: number;
  IM: number;
  halted: boolean;
  /** running T-state count, padded to a multiple of 4 per instruction */
  tstates: number;
  reset(): void;
  /** Execute one instruction. Returns the (rounded) T-states it took. */
  step(): number;
  /** Raise a maskable interrupt. Returns T-states consumed (0 if masked). */
  interrupt(): number;
  getHL(): number;
  getBC(): number;
  getDE(): number;
}

export function makeZ80(bus: Bus): Z80 {
  const SF = 0x80, ZF = 0x40, YF = 0x20, HF = 0x10, XF = 0x08, PF = 0x04, NF = 0x02, CF = 0x01;

  const parity = new Uint8Array(256);
  for (let i = 0; i < 256; i++) { let p = 0, v = i; while (v) { p ^= v & 1; v >>= 1; } parity[i] = p ? 0 : PF; }

  const cpu = {
    R: new Uint8Array(8),
    Rs: new Uint8Array(8),
    F: 0, Fs: 0,
    SP: 0xC000, PC: 0,
    IX: 0, IY: 0, I: 0, Rr: 0,
    IFF1: 0, IFF2: 0, IM: 1,
    halted: false,
    tstates: 0,
  } as unknown as Z80;

  function reset(): void {
    cpu.R.fill(0); cpu.Rs.fill(0); cpu.F = 0; cpu.Fs = 0;
    cpu.SP = 0xC000; cpu.PC = 0; cpu.IX = 0; cpu.IY = 0;
    cpu.IFF1 = 0; cpu.IFF2 = 0; cpu.IM = 1; cpu.halted = false; cpu.tstates = 0;
  }

  const R = cpu.R;
  const rd = (a: number) => bus.read(a & 0xFFFF);
  const wr = (a: number, v: number) => bus.write(a & 0xFFFF, v & 0xFF);

  const getHL = () => (R[4] << 8) | R[5];
  const setHL = (v: number) => { R[4] = (v >> 8) & 0xFF; R[5] = v & 0xFF; };
  const getBC = () => (R[0] << 8) | R[1];
  const setBC = (v: number) => { R[0] = (v >> 8) & 0xFF; R[1] = v & 0xFF; };
  const getDE = () => (R[2] << 8) | R[3];
  const setDE = (v: number) => { R[2] = (v >> 8) & 0xFF; R[3] = v & 0xFF; };

  function fetch() { const v = rd(cpu.PC); cpu.PC = (cpu.PC + 1) & 0xFFFF; return v; }
  function fetch16() { const l = fetch(); return l | (fetch() << 8); }

  function push(v: number) { cpu.SP = (cpu.SP - 1) & 0xFFFF; wr(cpu.SP, v >> 8); cpu.SP = (cpu.SP - 1) & 0xFFFF; wr(cpu.SP, v & 0xFF); }
  function pop() { const l = rd(cpu.SP); cpu.SP = (cpu.SP + 1) & 0xFFFF; const h = rd(cpu.SP); cpu.SP = (cpu.SP + 1) & 0xFFFF; return l | (h << 8); }

  // --- ALU ---
  function add8(v: number, carry: number) {
    const a = R[7], r = a + v + carry;
    let f = (r & 0xFF) ? 0 : ZF;
    f |= r & (SF | YF | XF);
    if (r > 0xFF) f |= CF;
    if (((a ^ v ^ 0x80) & (a ^ r) & 0x80)) f |= PF;
    if (((a & 0x0F) + (v & 0x0F) + carry) > 0x0F) f |= HF;
    R[7] = r & 0xFF; cpu.F = f;
  }
  function sub8(v: number, carry: number, store: boolean) {
    const a = R[7], r = a - v - carry;
    let f = NF | ((r & 0xFF) ? 0 : ZF);
    f |= r & (SF | YF | XF);
    if (r & 0x100) f |= CF;
    if (((a ^ v) & (a ^ r) & 0x80)) f |= PF;
    if (((a & 0x0F) - (v & 0x0F) - carry) & 0x10) f |= HF;
    if (store) R[7] = r & 0xFF;
    else { f = (f & ~(YF | XF)) | (v & (YF | XF)); }
    cpu.F = f;
  }
  function and8(v: number) { R[7] &= v; cpu.F = parity[R[7]] | HF | (R[7] ? 0 : ZF) | (R[7] & (SF | YF | XF)); }
  function or8(v: number) { R[7] |= v; cpu.F = parity[R[7]] | (R[7] ? 0 : ZF) | (R[7] & (SF | YF | XF)); }
  function xor8(v: number) { R[7] ^= v; cpu.F = parity[R[7]] | (R[7] ? 0 : ZF) | (R[7] & (SF | YF | XF)); }

  function inc8(v: number) {
    const r = (v + 1) & 0xFF;
    cpu.F = (cpu.F & CF) | (r ? 0 : ZF) | (r & (SF | YF | XF)) | ((r & 0x0F) ? 0 : HF) | (r === 0x80 ? PF : 0);
    return r;
  }
  function dec8(v: number) {
    const r = (v - 1) & 0xFF;
    cpu.F = (cpu.F & CF) | NF | (r ? 0 : ZF) | (r & (SF | YF | XF)) | (((r & 0x0F) === 0x0F) ? HF : 0) | (r === 0x7F ? PF : 0);
    return r;
  }

  function add16(a: number, b: number) {
    const r = a + b;
    cpu.F = (cpu.F & (SF | ZF | PF)) | ((r >> 8) & (YF | XF)) | (r > 0xFFFF ? CF : 0) | (((a & 0xFFF) + (b & 0xFFF)) > 0xFFF ? HF : 0);
    return r & 0xFFFF;
  }
  function adc16(a: number, b: number) {
    const c = cpu.F & CF, r = a + b + c;
    let f = ((r & 0xFFFF) ? 0 : ZF) | ((r >> 8) & (SF | YF | XF)) | (r > 0xFFFF ? CF : 0);
    if (((a ^ b ^ 0x8000) & (a ^ r) & 0x8000)) f |= PF;
    if (((a & 0xFFF) + (b & 0xFFF) + c) > 0xFFF) f |= HF;
    cpu.F = f; return r & 0xFFFF;
  }
  function sbc16(a: number, b: number) {
    const c = cpu.F & CF, r = a - b - c;
    let f = NF | ((r & 0xFFFF) ? 0 : ZF) | ((r >> 8) & (SF | YF | XF)) | (r & 0x10000 ? CF : 0);
    if (((a ^ b) & (a ^ r) & 0x8000)) f |= PF;
    if (((a & 0xFFF) - (b & 0xFFF) - c) & 0x1000) f |= HF;
    cpu.F = f; return r & 0xFFFF;
  }

  // --- rotates/shifts (CB) ---
  function szp(r: number) { return parity[r] | (r ? 0 : ZF) | (r & (SF | YF | XF)); }
  function rlc(v: number) { const c = (v >> 7) & 1, r = ((v << 1) | c) & 0xFF; cpu.F = szp(r) | c; return r; }
  function rrc(v: number) { const c = v & 1, r = ((v >> 1) | (c << 7)) & 0xFF; cpu.F = szp(r) | c; return r; }
  function rl(v: number) { const c = (v >> 7) & 1, r = ((v << 1) | (cpu.F & CF)) & 0xFF; cpu.F = szp(r) | c; return r; }
  function rr(v: number) { const c = v & 1, r = ((v >> 1) | ((cpu.F & CF) << 7)) & 0xFF; cpu.F = szp(r) | c; return r; }
  function sla(v: number) { const c = (v >> 7) & 1, r = (v << 1) & 0xFF; cpu.F = szp(r) | c; return r; }
  function sra(v: number) { const c = v & 1, r = ((v >> 1) | (v & 0x80)) & 0xFF; cpu.F = szp(r) | c; return r; }
  function sll(v: number) { const c = (v >> 7) & 1, r = ((v << 1) | 1) & 0xFF; cpu.F = szp(r) | c; return r; }
  function srl(v: number) { const c = v & 1, r = (v >> 1) & 0xFF; cpu.F = szp(r) | c; return r; }
  function bit(v: number, b: number) {
    const r = v & (1 << b);
    cpu.F = (cpu.F & CF) | HF | (r ? 0 : (ZF | PF)) | (r & SF) | (v & (YF | XF));
  }
  const shifters: Array<(v: number) => number> = [rlc, rrc, rl, rr, sla, sra, sll, srl];

  const cond = (i: number): boolean => {
    switch (i) {
      case 0: return !(cpu.F & ZF); case 1: return !!(cpu.F & ZF);
      case 2: return !(cpu.F & CF); case 3: return !!(cpu.F & CF);
      case 4: return !(cpu.F & PF); case 5: return !!(cpu.F & PF);
      case 6: return !(cpu.F & SF); case 7: return !!(cpu.F & SF);
      default: return false;
    }
  };

  function getR(i: number) { return i === 6 ? rd(getHL()) : R[i]; }
  function setR(i: number, v: number) { if (i === 6) wr(getHL(), v); else R[i] = v & 0xFF; }

  function rp(i: number) { return i === 0 ? getBC() : i === 1 ? getDE() : i === 2 ? getHL() : cpu.SP; }
  function setrp(i: number, v: number) { if (i === 0) setBC(v); else if (i === 1) setDE(v); else if (i === 2) setHL(v); else cpu.SP = v & 0xFFFF; }

  const aluOp = (i: number, v: number) => {
    switch (i) {
      case 0: add8(v, 0); break; case 1: add8(v, cpu.F & CF); break;
      case 2: sub8(v, 0, true); break; case 3: sub8(v, cpu.F & CF, true); break;
      case 4: and8(v); break; case 5: xor8(v); break;
      case 6: or8(v); break; case 7: sub8(v, 0, false); break;
    }
  };

  // --- CB prefix ---
  function execCB() {
    const op = fetch(); cpu.tstates += 8;
    const y = (op >> 3) & 7, z = op & 7, x = op >> 6;
    if (z === 6) cpu.tstates += 7;
    const v = getR(z);
    if (x === 0) { setR(z, shifters[y](v)); }
    else if (x === 1) { bit(v, y); }
    else if (x === 2) { setR(z, v & ~(1 << y)); }
    else { setR(z, v | (1 << y)); }
  }

  // --- ED prefix ---
  function execED() {
    const op = fetch(); cpu.tstates += 8;
    switch (op) {
      case 0x40: case 0x48: case 0x50: case 0x58:
      case 0x60: case 0x68: case 0x70: case 0x78: { // IN r,(C)
        const v = bus.in(getBC()); cpu.tstates += 8;
        const y = (op >> 3) & 7; if (y !== 6) R[y] = v;
        cpu.F = (cpu.F & CF) | szp(v); break;
      }
      case 0x41: case 0x49: case 0x51: case 0x59:
      case 0x61: case 0x69: case 0x71: case 0x79: { // OUT (C),r
        const y = (op >> 3) & 7; bus.out(getBC(), y === 6 ? 0 : R[y]); cpu.tstates += 8; break;
      }
      case 0x42: setHL(sbc16(getHL(), getBC())); cpu.tstates += 7; break;
      case 0x52: setHL(sbc16(getHL(), getDE())); cpu.tstates += 7; break;
      case 0x62: setHL(sbc16(getHL(), getHL())); cpu.tstates += 7; break;
      case 0x72: setHL(sbc16(getHL(), cpu.SP)); cpu.tstates += 7; break;
      case 0x4A: setHL(adc16(getHL(), getBC())); cpu.tstates += 7; break;
      case 0x5A: setHL(adc16(getHL(), getDE())); cpu.tstates += 7; break;
      case 0x6A: setHL(adc16(getHL(), getHL())); cpu.tstates += 7; break;
      case 0x7A: setHL(adc16(getHL(), cpu.SP)); cpu.tstates += 7; break;
      case 0x43: case 0x53: case 0x63: case 0x73: { // LD (nn),rp
        const a = fetch16(), v = rp((op >> 4) & 3); wr(a, v & 0xFF); wr(a + 1, v >> 8); cpu.tstates += 12; break;
      }
      case 0x4B: case 0x5B: case 0x6B: case 0x7B: { // LD rp,(nn)
        const a = fetch16(); setrp((op >> 4) & 3, rd(a) | (rd(a + 1) << 8)); cpu.tstates += 12; break;
      }
      case 0x44: case 0x4C: case 0x54: case 0x5C:
      case 0x64: case 0x6C: case 0x74: case 0x7C: { // NEG
        const v = R[7]; R[7] = 0; sub8(v, 0, true); break;
      }
      case 0x45: case 0x55: case 0x5D: case 0x65: case 0x6D: case 0x75: case 0x7D: // RETN
        cpu.IFF1 = cpu.IFF2; cpu.PC = pop(); cpu.tstates += 6; break;
      case 0x4D: cpu.PC = pop(); cpu.tstates += 6; break; // RETI
      case 0x46: case 0x4E: case 0x66: case 0x6E: cpu.IM = 0; break;
      case 0x56: case 0x76: cpu.IM = 1; break;
      case 0x5E: case 0x7E: cpu.IM = 2; break;
      case 0x47: cpu.I = R[7]; cpu.tstates += 1; break;
      case 0x4F: cpu.Rr = R[7]; cpu.tstates += 1; break;
      case 0x57: R[7] = cpu.I; cpu.F = (cpu.F & CF) | (R[7] ? 0 : ZF) | (R[7] & SF) | (cpu.IFF2 ? PF : 0); cpu.tstates += 1; break;
      case 0x5F: R[7] = cpu.Rr & 0xFF; cpu.F = (cpu.F & CF) | (R[7] ? 0 : ZF) | (R[7] & SF) | (cpu.IFF2 ? PF : 0); cpu.tstates += 1; break;
      case 0x67: { // RRD
        const a = R[7], m = rd(getHL());
        wr(getHL(), ((m >> 4) | (a << 4)) & 0xFF); R[7] = (a & 0xF0) | (m & 0x0F);
        cpu.F = (cpu.F & CF) | szp(R[7]); cpu.tstates += 10; break;
      }
      case 0x6F: { // RLD
        const a = R[7], m = rd(getHL());
        wr(getHL(), ((m << 4) | (a & 0x0F)) & 0xFF); R[7] = (a & 0xF0) | (m >> 4);
        cpu.F = (cpu.F & CF) | szp(R[7]); cpu.tstates += 10; break;
      }
      case 0xA0: case 0xA8: case 0xB0: case 0xB8: { // LDI/LDD/LDIR/LDDR
        const dir = (op & 8) ? -1 : 1;
        const v = rd(getHL()); wr(getDE(), v);
        setHL((getHL() + dir) & 0xFFFF); setDE((getDE() + dir) & 0xFFFF);
        setBC((getBC() - 1) & 0xFFFF);
        const n = (v + R[7]) & 0xFF;
        cpu.F = (cpu.F & (SF | ZF | CF)) | (getBC() ? PF : 0) | (n & XF) | ((n & 2) ? YF : 0);
        cpu.tstates += 8;
        if ((op & 0x10) && getBC()) { cpu.PC = (cpu.PC - 2) & 0xFFFF; cpu.tstates += 5; }
        break;
      }
      case 0xA1: case 0xA9: case 0xB1: case 0xB9: { // CPI/CPD/CPIR/CPDR
        const dir = (op & 8) ? -1 : 1, v = rd(getHL()), c = cpu.F & CF;
        sub8(v, 0, false); cpu.F = (cpu.F & ~CF) | c;
        setHL((getHL() + dir) & 0xFFFF); setBC((getBC() - 1) & 0xFFFF);
        cpu.F = (cpu.F & ~PF) | (getBC() ? PF : 0);
        cpu.tstates += 8;
        if ((op & 0x10) && getBC() && !(cpu.F & ZF)) { cpu.PC = (cpu.PC - 2) & 0xFFFF; cpu.tstates += 5; }
        break;
      }
      case 0xA3: case 0xAB: case 0xB3: case 0xBB: { // OUTI/OUTD/OTIR/OTDR
        const dir = (op & 8) ? -1 : 1;
        R[0] = (R[0] - 1) & 0xFF;
        const v = rd(getHL()); bus.out(getBC(), v);
        setHL((getHL() + dir) & 0xFFFF);
        cpu.F = NF | (R[0] ? 0 : ZF) | (R[0] & (SF | YF | XF));
        cpu.tstates += 8;
        if ((op & 0x10) && R[0]) { cpu.PC = (cpu.PC - 2) & 0xFFFF; cpu.tstates += 5; }
        break;
      }
      case 0xA2: case 0xAA: case 0xB2: case 0xBA: { // INI/IND/INIR/INDR
        const dir = (op & 8) ? -1 : 1;
        const v = bus.in(getBC()); wr(getHL(), v);
        R[0] = (R[0] - 1) & 0xFF;
        setHL((getHL() + dir) & 0xFFFF);
        cpu.F = NF | (R[0] ? 0 : ZF) | (R[0] & (SF | YF | XF));
        cpu.tstates += 8;
        if ((op & 0x10) && R[0]) { cpu.PC = (cpu.PC - 2) & 0xFFFF; cpu.tstates += 5; }
        break;
      }
      default: break; // NOP-like
    }
  }

  // --- DD/FD prefix (IX/IY) ---
  function execIdx(isIY: boolean) {
    const op = fetch(); cpu.tstates += 4;
    const get = () => isIY ? cpu.IY : cpu.IX;
    const set = (v: number) => { if (isIY) cpu.IY = v & 0xFFFF; else cpu.IX = v & 0xFFFF; };
    const idxH = () => (get() >> 8) & 0xFF, idxL = () => get() & 0xFF;
    const setH = (v: number) => set((get() & 0x00FF) | ((v & 0xFF) << 8));
    const setL = (v: number) => set((get() & 0xFF00) | (v & 0xFF));
    const disp = () => { let d = fetch(); if (d > 127) d -= 256; return (get() + d) & 0xFFFF; };

    switch (op) {
      case 0x21: set(fetch16()); cpu.tstates += 10; break;
      case 0x22: { const a = fetch16(); wr(a, idxL()); wr(a + 1, idxH()); cpu.tstates += 16; break; }
      case 0x2A: { const a = fetch16(); set(rd(a) | (rd(a + 1) << 8)); cpu.tstates += 16; break; }
      case 0x23: set(get() + 1); cpu.tstates += 6; break;
      case 0x2B: set(get() - 1); cpu.tstates += 6; break;
      case 0x09: set(add16(get(), getBC())); cpu.tstates += 11; break;
      case 0x19: set(add16(get(), getDE())); cpu.tstates += 11; break;
      case 0x29: set(add16(get(), get())); cpu.tstates += 11; break;
      case 0x39: set(add16(get(), cpu.SP)); cpu.tstates += 11; break;
      case 0xE5: push(get()); cpu.tstates += 11; break;
      case 0xE1: set(pop()); cpu.tstates += 10; break;
      case 0xE3: { const t = pop(); push(get()); set(t); cpu.tstates += 19; break; }
      case 0xE9: cpu.PC = get(); cpu.tstates += 4; break;
      case 0xF9: cpu.SP = get(); cpu.tstates += 6; break;
      case 0x24: setH(inc8(idxH())); cpu.tstates += 4; break;
      case 0x25: setH(dec8(idxH())); cpu.tstates += 4; break;
      case 0x2C: setL(inc8(idxL())); cpu.tstates += 4; break;
      case 0x2D: setL(dec8(idxL())); cpu.tstates += 4; break;
      case 0x26: setH(fetch()); cpu.tstates += 7; break;
      case 0x2E: setL(fetch()); cpu.tstates += 7; break;
      case 0x34: { const a = disp(); wr(a, inc8(rd(a))); cpu.tstates += 19; break; }
      case 0x35: { const a = disp(); wr(a, dec8(rd(a))); cpu.tstates += 19; break; }
      case 0x36: { const a = disp(), v = fetch(); wr(a, v); cpu.tstates += 15; break; }
      case 0xCB: { // DDCB
        let d = fetch(); if (d > 127) d -= 256;
        const a = (get() + d) & 0xFFFF, sub = fetch();
        const y = (sub >> 3) & 7, z = sub & 7, x = sub >> 6;
        let v = rd(a);
        if (x === 0) { v = shifters[y](v); wr(a, v); if (z !== 6) R[z] = v; }
        else if (x === 1) { bit(v, y); }
        else if (x === 2) { v = v & ~(1 << y); wr(a, v); if (z !== 6) R[z] = v; }
        else { v = v | (1 << y); wr(a, v); if (z !== 6) R[z] = v; }
        cpu.tstates += 15; break;
      }
      default: {
        const y = (op >> 3) & 7, z = op & 7, x = op >> 6;
        if (x === 1) { // LD r,r'
          if (z === 6 && y !== 6) { R[y] = rd(disp()); cpu.tstates += 15; }
          else if (y === 6 && z !== 6) { wr(disp(), R[z]); cpu.tstates += 15; }
          else if (y === 4) { if (z === 4) { /* LD IXH,IXH */ } else if (z === 5) setH(idxL()); else setH(R[z]); cpu.tstates += 4; }
          else if (y === 5) { if (z === 5) { /* LD IXL,IXL */ } else if (z === 4) setL(idxH()); else setL(R[z]); cpu.tstates += 4; }
          else if (z === 4) { R[y] = idxH(); cpu.tstates += 4; }
          else if (z === 5) { R[y] = idxL(); cpu.tstates += 4; }
          else { R[y] = R[z]; cpu.tstates += 4; }
        } else if (x === 2) { // ALU
          if (z === 6) { aluOp(y, rd(disp())); cpu.tstates += 15; }
          else if (z === 4) { aluOp(y, idxH()); cpu.tstates += 4; }
          else if (z === 5) { aluOp(y, idxL()); cpu.tstates += 4; }
          else { aluOp(y, R[z]); cpu.tstates += 4; }
        } else {
          cpu.PC = (cpu.PC - 1) & 0xFFFF; // treat as plain opcode
          step();
        }
      }
    }
  }

  function step(): number {
    if (cpu.halted) { cpu.tstates += 4; return 4; }
    const t0 = cpu.tstates;
    const op = fetch();
    cpu.Rr = (cpu.Rr & 0x80) | ((cpu.Rr + 1) & 0x7F);
    const x = op >> 6, y = (op >> 3) & 7, z = op & 7, p = (op >> 4) & 3, q = (op >> 3) & 1;

    switch (x) {
      case 1:
        if (op === 0x76) { cpu.halted = true; cpu.tstates += 4; break; }
        cpu.tstates += (y === 6 || z === 6) ? 7 : 4;
        setR(y, getR(z));
        break;
      case 2:
        cpu.tstates += (z === 6) ? 7 : 4;
        aluOp(y, getR(z));
        break;
      case 0:
        switch (z) {
          case 0:
            if (y === 0) { cpu.tstates += 4; }
            else if (y === 1) { const a = R[7], f = cpu.F; R[7] = cpu.Rs[7]; cpu.Rs[7] = a; cpu.F = cpu.Fs; cpu.Fs = f; cpu.tstates += 4; }
            else if (y === 2) {
              let d = fetch(); if (d > 127) d -= 256;
              R[0] = (R[0] - 1) & 0xFF;
              if (R[0]) { cpu.PC = (cpu.PC + d) & 0xFFFF; cpu.tstates += 13; } else cpu.tstates += 8;
            }
            else if (y === 3) { let d = fetch(); if (d > 127) d -= 256; cpu.PC = (cpu.PC + d) & 0xFFFF; cpu.tstates += 12; }
            else {
              let d = fetch(); if (d > 127) d -= 256;
              if (cond(y - 4)) { cpu.PC = (cpu.PC + d) & 0xFFFF; cpu.tstates += 12; } else cpu.tstates += 7;
            }
            break;
          case 1:
            if (q === 0) { setrp(p, fetch16()); cpu.tstates += 10; }
            else { setHL(add16(getHL(), rp(p))); cpu.tstates += 11; }
            break;
          case 2:
            if (q === 0) {
              if (p === 0) { wr(getBC(), R[7]); cpu.tstates += 7; }
              else if (p === 1) { wr(getDE(), R[7]); cpu.tstates += 7; }
              else if (p === 2) { const a = fetch16(); wr(a, R[5]); wr(a + 1, R[4]); cpu.tstates += 16; }
              else { const a = fetch16(); wr(a, R[7]); cpu.tstates += 13; }
            } else {
              if (p === 0) { R[7] = rd(getBC()); cpu.tstates += 7; }
              else if (p === 1) { R[7] = rd(getDE()); cpu.tstates += 7; }
              else if (p === 2) { const a = fetch16(); R[5] = rd(a); R[4] = rd(a + 1); cpu.tstates += 16; }
              else { const a = fetch16(); R[7] = rd(a); cpu.tstates += 13; }
            }
            break;
          case 3:
            setrp(p, rp(p) + (q ? -1 : 1)); cpu.tstates += 6; break;
          case 4: cpu.tstates += (y === 6) ? 11 : 4; setR(y, inc8(getR(y))); break;
          case 5: cpu.tstates += (y === 6) ? 11 : 4; setR(y, dec8(getR(y))); break;
          case 6: cpu.tstates += (y === 6) ? 10 : 7; setR(y, fetch()); break;
          case 7:
            cpu.tstates += 4;
            if (y === 0) { const c = (R[7] >> 7) & 1; R[7] = ((R[7] << 1) | c) & 0xFF; cpu.F = (cpu.F & (SF | ZF | PF)) | c | (R[7] & (YF | XF)); }
            else if (y === 1) { const c = R[7] & 1; R[7] = ((R[7] >> 1) | (c << 7)) & 0xFF; cpu.F = (cpu.F & (SF | ZF | PF)) | c | (R[7] & (YF | XF)); }
            else if (y === 2) { const c = (R[7] >> 7) & 1; R[7] = ((R[7] << 1) | (cpu.F & CF)) & 0xFF; cpu.F = (cpu.F & (SF | ZF | PF)) | c | (R[7] & (YF | XF)); }
            else if (y === 3) { const c = R[7] & 1; R[7] = ((R[7] >> 1) | ((cpu.F & CF) << 7)) & 0xFF; cpu.F = (cpu.F & (SF | ZF | PF)) | c | (R[7] & (YF | XF)); }
            else if (y === 4) { // DAA
              let a = R[7], adj = 0, c = cpu.F & CF;
              if ((cpu.F & HF) || (a & 0x0F) > 9) adj |= 6;
              if (c || a > 0x99) { adj |= 0x60; c = 1; }
              if (cpu.F & NF) { const h = ((a & 0x0F) - (adj & 0x0F)) & 0x10 ? HF : 0; a = (a - adj) & 0xFF; cpu.F = (cpu.F & NF) | h; }
              else { const h = (((a & 0x0F) + (adj & 0x0F)) > 0x0F) ? HF : 0; a = (a + adj) & 0xFF; cpu.F = (cpu.F & NF) | h; }
              R[7] = a; cpu.F |= parity[a] | (a ? 0 : ZF) | (a & (SF | YF | XF)) | c;
            }
            else if (y === 5) { R[7] = (~R[7]) & 0xFF; cpu.F = (cpu.F & (SF | ZF | PF | CF)) | HF | NF | (R[7] & (YF | XF)); }
            else if (y === 6) { cpu.F = (cpu.F & (SF | ZF | PF)) | CF | (R[7] & (YF | XF)); }
            else { const c = cpu.F & CF; cpu.F = (cpu.F & (SF | ZF | PF)) | (c ? HF : 0) | (c ? 0 : CF) | (R[7] & (YF | XF)); }
            break;
        }
        break;
      case 3:
        switch (z) {
          case 0: if (cond(y)) { cpu.PC = pop(); cpu.tstates += 11; } else cpu.tstates += 5; break;
          case 1:
            if (q === 0) {
              const v = pop();
              if (p === 3) { R[7] = v >> 8; cpu.F = v & 0xFF; } else setrp(p, v);
              cpu.tstates += 10;
            }
            else {
              if (p === 0) { cpu.PC = pop(); cpu.tstates += 10; }
              else if (p === 1) { for (let i = 0; i < 6; i++) { const t = R[i]; R[i] = cpu.Rs[i]; cpu.Rs[i] = t; } cpu.tstates += 4; }
              else if (p === 2) { cpu.PC = getHL(); cpu.tstates += 4; }
              else { cpu.SP = getHL(); cpu.tstates += 6; }
            }
            break;
          case 2: { const a = fetch16(); if (cond(y)) cpu.PC = a; cpu.tstates += 10; break; }
          case 3:
            if (y === 0) { cpu.PC = fetch16(); cpu.tstates += 10; }
            else if (y === 1) { execCB(); }
            else if (y === 2) { const port = fetch(); bus.out((R[7] << 8) | port, R[7]); cpu.tstates += 15; }
            else if (y === 3) { const port = fetch(); R[7] = bus.in((R[7] << 8) | port); cpu.tstates += 15; }
            else if (y === 4) { const t = pop(); push(getHL()); setHL(t); cpu.tstates += 19; }
            else if (y === 5) { const t = getDE(); setDE(getHL()); setHL(t); cpu.tstates += 4; }
            else if (y === 6) { cpu.IFF1 = cpu.IFF2 = 0; cpu.tstates += 4; }
            else { cpu.IFF1 = cpu.IFF2 = 1; cpu.tstates += 4; }
            break;
          case 4: {
            const a = fetch16();
            if (cond(y)) { push(cpu.PC); cpu.PC = a; cpu.tstates += 17; } else cpu.tstates += 10; break;
          }
          case 5:
            if (q === 0) { push(p === 3 ? ((R[7] << 8) | cpu.F) : rp(p)); cpu.tstates += 11; }
            else {
              if (p === 0) { const a = fetch16(); push(cpu.PC); cpu.PC = a; cpu.tstates += 17; }
              else if (p === 1) { execIdx(false); }
              else if (p === 2) { execED(); }
              else { execIdx(true); }
            }
            break;
          case 6: aluOp(y, fetch()); cpu.tstates += 7; break;
          case 7: push(cpu.PC); cpu.PC = y * 8; cpu.tstates += 11; break;
        }
        break;
    }
    // On the CPC the Gate Array steals a cycle from any machine cycle that is
    // not already a multiple of four, so every instruction ends up padded to a
    // multiple of 4 T-states. This is what makes hand-timed raster code work.
    const rounded = ((cpu.tstates - t0) + 3) & ~3;
    cpu.tstates = t0 + rounded;
    return rounded;
  }

  cpu.reset = reset;
  cpu.step = step;
  cpu.interrupt = function (): number {
    if (!cpu.IFF1) return 0;
    if (cpu.halted) { cpu.halted = false; cpu.PC = (cpu.PC + 1) & 0xFFFF; }
    cpu.IFF1 = cpu.IFF2 = 0;
    if (cpu.IM === 2) {
      const v = (cpu.I << 8) | 0xFF;
      push(cpu.PC); cpu.PC = rd(v) | (rd(v + 1) << 8);
      cpu.tstates += 20; return 20;
    }
    push(cpu.PC); cpu.PC = 0x38; cpu.tstates += 16; return 16;
  };
  cpu.getHL = getHL; cpu.getBC = getBC; cpu.getDE = getDE;
  return cpu;
}
