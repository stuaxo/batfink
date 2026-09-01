// Z80 disassembler — the inverse of the encoder. Used by step-over, the
// disassembly view, trace formatting and instruction editing. Output matches
// our assembler's dialect (`&FF` hex) so it round-trips.

export interface Decoded {
  /** e.g. "ld a,(&C000)" */
  text: string;
  bytes: number[];
  length: number;
  /** statically-known jump/call target, else null */
  target: number | null;
  /** true for call / rst (step-over runs to the following instruction) */
  isCall: boolean;
  /** true for ret / reti / retn */
  isReturn: boolean;
}

const R8 = ['b', 'c', 'd', 'e', 'h', 'l', '(hl)', 'a'];
const RP = ['bc', 'de', 'hl', 'sp'];
const RP2 = ['bc', 'de', 'hl', 'af'];
const CC = ['nz', 'z', 'nc', 'c', 'po', 'pe', 'p', 'm'];
const ALU = ['add a,', 'adc a,', 'sub ', 'sbc a,', 'and ', 'xor ', 'or ', 'cp '];
const ROT = ['rlc', 'rrc', 'rl', 'rr', 'sla', 'sra', 'sll', 'srl'];
const ACC = ['rlca', 'rrca', 'rla', 'rra', 'daa', 'cpl', 'scf', 'ccf'];
const BLI = [
  ['ldi', 'cpi', 'ini', 'outi'],
  ['ldd', 'cpd', 'ind', 'outd'],
  ['ldir', 'cpir', 'inir', 'otir'],
  ['lddr', 'cpdr', 'indr', 'otdr'],
];

const h2 = (n: number) => '&' + (n & 0xff).toString(16).toUpperCase().padStart(2, '0');
const h4 = (n: number) => '&' + (n & 0xffff).toString(16).toUpperCase().padStart(4, '0');
const disp = (d: number) => (d < 128 ? '+' + h2(d) : '-' + h2(256 - d));

export function disassemble(read: (a: number) => number, addr: number): Decoded {
  const bytes: number[] = [];
  let pc = addr;
  const next = () => { const b = read(pc & 0xffff) & 0xff; bytes.push(b); pc = (pc + 1) & 0xffff; return b; };
  const imm16 = () => { const lo = next(); return lo | (next() << 8); };
  const rel = () => { const d = next(); return (pc + (d < 128 ? d : d - 256)) & 0xffff; };

  let text = '???';
  let target: number | null = null;
  let isCall = false;
  let isReturn = false;

  const op = next();

  const idx = op === 0xdd || op === 0xfd;
  if (idx) {
    // IX/IY: decode the inner opcode with h/l/(hl) rewritten
    const ir = op === 0xdd ? 'ix' : 'iy';
    const sub = next();
    if (sub === 0xcb) {
      const d = next();
      const cbop = next();
      const y = (cbop >> 3) & 7;
      const z = cbop & 7;
      const x = cbop >> 6;
      const at = `(${ir}${disp(d)})`;
      const tail = z === 6 ? at : `${at},${R8[z]}`;
      if (x === 0) text = `${ROT[y]} ${tail}`;
      else if (x === 1) text = `bit ${y},${at}`;
      else text = `${x === 2 ? 'res' : 'set'} ${y},${tail}`;
    } else {
      text = decodeIdx(sub, ir, next, imm16);
    }
  } else if (op === 0xcb) {
    const cbop = next();
    const y = (cbop >> 3) & 7;
    const z = cbop & 7;
    const x = cbop >> 6;
    if (x === 0) text = `${ROT[y]} ${R8[z]}`;
    else if (x === 1) text = `bit ${y},${R8[z]}`;
    else text = `${x === 2 ? 'res' : 'set'} ${y},${R8[z]}`;
  } else if (op === 0xed) {
    const e = next();
    const y = (e >> 3) & 7;
    const z = e & 7;
    const x = e >> 6;
    if (x === 1) {
      if (z === 0) text = `in ${y === 6 ? 'f' : R8[y]},(c)`;
      else if (z === 1) text = y === 6 ? 'out (c),0' : `out (c),${R8[y]}`;
      else if (z === 2) text = `${y & 1 ? 'adc' : 'sbc'} hl,${RP[(y >> 1) & 3]}`;
      else if (z === 3) { const nn = imm16(); text = y & 1 ? `ld ${RP[(y >> 1) & 3]},(${h4(nn)})` : `ld (${h4(nn)}),${RP[(y >> 1) & 3]}`; }
      else if (z === 4) text = 'neg';
      else if (z === 5) { text = y === 1 ? 'reti' : 'retn'; isReturn = true; }
      else if (z === 6) text = `im ${[0, 0, 1, 2, 0, 0, 1, 2][y]}`;
      else text = ['ld i,a', 'ld r,a', 'ld a,i', 'ld a,r', 'rrd', 'rld', 'nop', 'nop'][y];
    } else if (x === 2 && z <= 3 && y >= 4) {
      text = BLI[y - 4][z];
    } else {
      text = 'nop'; // undocumented ED
    }
  } else {
    const res = decodeMain(op, next, imm16, rel);
    text = res.text;
    target = res.target;
    isCall = res.isCall;
    isReturn = res.isReturn;
  }

  return { text, bytes, length: bytes.length, target, isCall, isReturn };
}

function decodeMain(
  op: number,
  next: () => number,
  imm16: () => number,
  rel: () => number,
): { text: string; target: number | null; isCall: boolean; isReturn: boolean } {
  const x = op >> 6;
  const y = (op >> 3) & 7;
  const z = op & 7;
  const p = y >> 1;
  const q = y & 1;
  let target: number | null = null;
  let isCall = false;
  let isReturn = false;
  let text: string;

  if (x === 1) {
    text = op === 0x76 ? 'halt' : `ld ${R8[y]},${R8[z]}`;
  } else if (x === 2) {
    text = `${ALU[y]}${R8[z]}`;
  } else if (x === 0) {
    switch (z) {
      case 0:
        if (y === 0) text = 'nop';
        else if (y === 1) text = "ex af,af'";
        else if (y === 2) { target = rel(); text = `djnz ${h4(target)}`; }
        else if (y === 3) { target = rel(); text = `jr ${h4(target)}`; }
        else { target = rel(); text = `jr ${CC[y - 4]},${h4(target)}`; }
        break;
      case 1:
        text = q === 0 ? `ld ${RP[p]},${h4(imm16())}` : `add hl,${RP[p]}`;
        break;
      case 2:
        if (q === 0) {
          if (p === 0) text = 'ld (bc),a';
          else if (p === 1) text = 'ld (de),a';
          else if (p === 2) text = `ld (${h4(imm16())}),hl`;
          else text = `ld (${h4(imm16())}),a`;
        } else {
          if (p === 0) text = 'ld a,(bc)';
          else if (p === 1) text = 'ld a,(de)';
          else if (p === 2) text = `ld hl,(${h4(imm16())})`;
          else text = `ld a,(${h4(imm16())})`;
        }
        break;
      case 3:
        text = `${q === 0 ? 'inc' : 'dec'} ${RP[p]}`;
        break;
      case 4:
        text = `inc ${R8[y]}`;
        break;
      case 5:
        text = `dec ${R8[y]}`;
        break;
      case 6:
        text = `ld ${R8[y]},${h2(next())}`;
        break;
      default:
        text = ACC[y];
        break;
    }
  } else {
    // x === 3
    switch (z) {
      case 0:
        text = `ret ${CC[y]}`;
        break;
      case 1:
        if (q === 0) { text = `pop ${RP2[p]}`; }
        else {
          text = ['ret', 'exx', 'jp (hl)', 'ld sp,hl'][p];
          isReturn = p === 0;
        }
        break;
      case 2:
        target = imm16();
        text = `jp ${CC[y]},${h4(target)}`;
        break;
      case 3:
        if (y === 0) { target = imm16(); text = `jp ${h4(target)}`; }
        else if (y === 2) text = `out (${h2(next())}),a`;
        else if (y === 3) text = `in a,(${h2(next())})`;
        else if (y === 4) text = 'ex (sp),hl';
        else if (y === 5) text = 'ex de,hl';
        else if (y === 6) text = 'di';
        else text = 'ei';
        break;
      case 4:
        target = imm16();
        text = `call ${CC[y]},${h4(target)}`;
        isCall = true;
        break;
      case 5:
        if (q === 0) text = `push ${RP2[p]}`;
        else { target = imm16(); text = `call ${h4(target)}`; isCall = true; }
        break;
      case 6:
        text = `${ALU[y]}${h2(next())}`;
        break;
      default:
        target = y * 8;
        text = `rst ${h2(target)}`;
        isCall = true;
        break;
    }
  }
  return { text, target, isCall, isReturn };
}

function decodeIdx(sub: number, ir: string, next: () => number, imm16: () => number): string {
  const irh = ir + 'h';
  const irl = ir + 'l';
  const at = () => `(${ir}${disp(next())})`;
  const reg = (r: number) => (r === 4 ? irh : r === 5 ? irl : R8[r]);

  const x = sub >> 6;
  const y = (sub >> 3) & 7;
  const z = sub & 7;

  if (sub === 0x21) return `ld ${ir},${h4(imm16())}`;
  if (sub === 0x22) return `ld (${h4(imm16())}),${ir}`;
  if (sub === 0x2a) return `ld ${ir},(${h4(imm16())})`;
  if (sub === 0x23) return `inc ${ir}`;
  if (sub === 0x2b) return `dec ${ir}`;
  if (sub === 0x09) return `add ${ir},bc`;
  if (sub === 0x19) return `add ${ir},de`;
  if (sub === 0x29) return `add ${ir},${ir}`;
  if (sub === 0x39) return `add ${ir},sp`;
  if (sub === 0xe1) return `pop ${ir}`;
  if (sub === 0xe5) return `push ${ir}`;
  if (sub === 0xe3) return `ex (sp),${ir}`;
  if (sub === 0xe9) return `jp (${ir})`;
  if (sub === 0xf9) return `ld sp,${ir}`;
  if (sub === 0x24) return `inc ${irh}`;
  if (sub === 0x25) return `dec ${irh}`;
  if (sub === 0x2c) return `inc ${irl}`;
  if (sub === 0x2d) return `dec ${irl}`;
  if (sub === 0x26) return `ld ${irh},${h2(next())}`;
  if (sub === 0x2e) return `ld ${irl},${h2(next())}`;
  if (sub === 0x34) return `inc ${at()}`;
  if (sub === 0x35) return `dec ${at()}`;
  if (sub === 0x36) { const a = at(); return `ld ${a},${h2(next())}`; }

  if (x === 1) {
    if (z === 6 && y !== 6) return `ld ${R8[y]},${at()}`;
    if (y === 6 && z !== 6) return `ld ${at()},${R8[z]}`;
    return `ld ${reg(y)},${reg(z)}`;
  }
  if (x === 2) {
    if (z === 6) return `${ALU[y]}${at()}`;
    return `${ALU[y]}${reg(z)}`;
  }
  return 'nop'; // unhandled DD/FD -> acts as prefix + plain op
}
