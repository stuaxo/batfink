// Two-pass Z80 assembler driver: line parsing, labels, the ORG/EQU/DB/DW/DS/
// ALIGN/END directives, and the pass loop. Expression evaluation lives in
// ./expr and instruction encoding in ./encode; this file wires an Emitter to
// both and collects the output.
import { evalExpr as evalExprCore } from './expr';
import { encodeInstruction, type Emitter } from './encode';

export interface AssembleError {
  line: number;
  message: string;
  text: string;
}

export interface ListingRow {
  line: number;
  addr: number | null;
  bytes: number[];
  text: string;
}

export interface AssembleResult {
  /** 64K image; only the [start, end) range is meaningful. */
  bytes: Uint8Array;
  /** 1 for every address an instruction or directive wrote to. */
  used: Uint8Array;
  start: number;
  end: number;
  symbols: Record<string, number>;
  errors: AssembleError[];
  listing: ListingRow[];
}

type DataItem =
  | { str: true; v: number }
  | { str: false; v: string };

const errMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

// ---------- line splitting (pure) ----------
function splitOperands(s: string): string[] {
  const parts: string[] = [];
  let depth = 0, cur = '', q: string | null = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { cur += c; if (c === q) q = null; continue; }
    if (c === "'" || c === '"') { q = c; cur += c; continue; }
    if (c === '(') depth++;
    if (c === ')') depth--;
    if (c === ',' && depth === 0) { parts.push(cur); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim() !== '' || parts.length) parts.push(cur);
  return parts;
}

function stripComment(s: string): string {
  let q: string | null = null, o = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { o += c; if (c === q) q = null; continue; }
    if (c === "'" || c === '"') { q = c; o += c; continue; }
    if (c === ';') break;
    o += c;
  }
  return o;
}

function dataItems(str: string): DataItem[] {
  const items: DataItem[] = [];
  for (const raw of splitOperands(str)) {
    const s = raw.trim();
    if (!s) continue;
    const m = /^(['"])([\s\S]*)\1$/.exec(s);
    if (m && m[2].length !== 1) {
      for (const ch of m[2]) items.push({ str: true, v: ch.charCodeAt(0) });
    } else {
      items.push({ str: false, v: s });
    }
  }
  return items;
}

const DIRECTIVES = new Set(['ORG', 'EQU', 'DB', 'DEFB', 'BYTE', 'DW', 'DEFW', 'WORD', 'DS', 'DEFS', 'ALIGN', 'END']);

export function assemble(source: string): AssembleResult {
  const out = new Uint8Array(0x10000);
  const used = new Uint8Array(0x10000);
  const symbols: Record<string, number> = Object.create(null);
  const errors: AssembleError[] = [];
  const listing: ListingRow[] = [];
  let pc = 0, minAddr = 0x10000, maxAddr = 0, pass = 1;

  function emit(...bytes: number[]): void {
    for (const b of bytes) {
      if (pc > 0xffff) throw new Error('address overflow');
      if (pass === 2) { out[pc] = b & 0xff; used[pc] = 1; }
      if (pc < minAddr) minAddr = pc;
      pc++;
      if (pc > maxAddr) maxAddr = pc;
    }
  }
  function rel(target: number): number {
    const d = target - (pc + 1);
    if (pass === 2 && (d < -128 || d > 127)) throw new Error('relative jump out of range (' + d + ')');
    return d & 0xff;
  }
  function chk8(v: number): number {
    if (pass === 2 && (v < -128 || v > 255)) throw new Error('value ' + v + ' does not fit in a byte');
    return v & 0xff;
  }
  const evalExpr = (s: string): number =>
    evalExprCore(s, { pc, lenient: pass === 1, lookup: (n) => symbols[n] });

  const emitter: Emitter = {
    emit,
    emitW: (v) => emit(v & 0xff, (v >> 8) & 0xff),
    rel,
    chk8,
    evalExpr,
  };
  const { emitW } = emitter;

  const lines = source.split(/\r?\n/);

  for (pass = 1; pass <= 2; pass++) {
    pc = 0;
    errors.length = 0;
    if (pass === 2) listing.length = 0;

    for (let lineNo = 0; lineNo < lines.length; lineNo++) {
      const raw = lines[lineNo];
      let text = stripComment(raw).replace(/\t/g, ' ');
      if (!text.trim()) {
        if (pass === 2) listing.push({ line: lineNo + 1, addr: null, bytes: [], text: raw });
        continue;
      }
      const startPC = pc;
      try {
        let label: string | null = null;
        let m = /^\s*([A-Za-z_.@][A-Za-z0-9_.@]*)\s*:/.exec(text);
        if (m) {
          label = m[1];
          text = text.slice(m[0].length);
        } else if (!/^\s/.test(text)) {
          m = /^([A-Za-z_.@][A-Za-z0-9_.@]*)(\s+)(\S+)/.exec(text);
          if (m && DIRECTIVES.has(m[3].toUpperCase())) {
            label = m[1];
            text = text.slice(m[1].length);
          }
        }
        text = text.trim();

        let mn = '', rest = '';
        if (text) {
          const sp = text.search(/\s/);
          if (sp < 0) mn = text;
          else { mn = text.slice(0, sp); rest = text.slice(sp + 1); }
        }
        const MN = mn.toUpperCase();

        if (label && MN !== 'EQU' && pass === 1) {
          const key = label.toUpperCase();
          if (key in symbols) throw new Error('duplicate label "' + label + '"');
          symbols[key] = pc;
        }

        if (MN === 'EQU') {
          if (!label) throw new Error('EQU needs a label');
          symbols[label.toUpperCase()] = evalExpr(rest);
        } else if (MN === 'ORG') {
          pc = evalExpr(rest) & 0xffff;
        } else if (MN === 'END') {
          // ignore
        } else if (MN === 'ALIGN') {
          const a = evalExpr(rest);
          while (pc % a) emit(0);
        } else if (MN === 'DB' || MN === 'DEFB' || MN === 'BYTE') {
          for (const it of dataItems(rest)) emit(it.str ? it.v : chk8(evalExpr(it.v)));
        } else if (MN === 'DW' || MN === 'DEFW' || MN === 'WORD') {
          for (const it of dataItems(rest)) emitW(it.str ? it.v : evalExpr(it.v));
        } else if (MN === 'DS' || MN === 'DEFS') {
          const parts = splitOperands(rest);
          const n = evalExpr(parts[0]);
          const fill = parts[1] !== undefined ? evalExpr(parts[1]) : 0;
          for (let i = 0; i < n; i++) emit(fill);
        } else if (MN) {
          encodeInstruction(emitter, mn, splitOperands(rest));
        }

        if (pass === 2) {
          const bytes: number[] = [];
          for (let a = startPC; a < pc; a++) bytes.push(out[a]);
          listing.push({ line: lineNo + 1, addr: bytes.length ? startPC : null, bytes, text: raw });
        }
      } catch (e) {
        errors.push({ line: lineNo + 1, message: errMessage(e), text: raw.trim() });
        if (pass === 2) listing.push({ line: lineNo + 1, addr: null, bytes: [], text: raw });
      }
    }
  }

  return { bytes: out, used, start: minAddr, end: maxAddr, symbols, errors, listing };
}
