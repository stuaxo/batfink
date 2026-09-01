// Expression tokeniser and evaluator for the assembler. Numbers may be written
// &FF / #FF / 0xFF / nnH (hex), %1010 (binary) or decimal; `$` is the current
// address. Operators: unary - + ~, then * / %, + -, << >>, and & | ^.

type Tok =
  | { t: 'num'; v: number }
  | { t: 'id'; v: string }
  | { t: 'op'; v: string };

export interface ExprContext {
  /** value of `$` */
  pc: number;
  /** pass 1: an unknown symbol evaluates to 0 instead of throwing */
  lenient: boolean;
  /** resolve an UPPERCASED symbol name, or undefined if unknown */
  lookup(upperName: string): number | undefined;
}

function tokenize(s: string, pc: number): Tok[] {
  const t: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '&' || c === '#') {
      let j = i + 1, h = '';
      while (j < s.length && /[0-9a-fA-F]/.test(s[j])) h += s[j++];
      if (!h) { t.push({ t: 'op', v: c }); i++; continue; }
      t.push({ t: 'num', v: parseInt(h, 16) }); i = j; continue;
    }
    if (c === '%' && /[01]/.test(s[i + 1] || '')) {
      let j = i + 1, b = '';
      while (j < s.length && /[01]/.test(s[j])) b += s[j++];
      t.push({ t: 'num', v: parseInt(b, 2) }); i = j; continue;
    }
    if (/[0-9]/.test(c)) {
      let j = i, n = '';
      if (c === '0' && (s[i + 1] === 'x' || s[i + 1] === 'X')) {
        j = i + 2; let h = '';
        while (j < s.length && /[0-9a-fA-F]/.test(s[j])) h += s[j++];
        t.push({ t: 'num', v: parseInt(h, 16) }); i = j; continue;
      }
      while (j < s.length && /[0-9a-fA-F]/.test(s[j])) n += s[j++];
      if (s[j] === 'h' || s[j] === 'H') { t.push({ t: 'num', v: parseInt(n, 16) }); i = j + 1; continue; }
      t.push({ t: 'num', v: parseInt(n, 10) }); i = j; continue;
    }
    if (c === "'" || c === '"') {
      const j = i + 1;
      t.push({ t: 'num', v: s.charCodeAt(j) }); i = j + 2; continue;
    }
    if (/[A-Za-z_.@]/.test(c)) {
      let j = i, n = '';
      while (j < s.length && /[A-Za-z0-9_.@]/.test(s[j])) n += s[j++];
      t.push({ t: 'id', v: n }); i = j; continue;
    }
    if (c === '$') { t.push({ t: 'num', v: pc }); i++; continue; }
    if (s.startsWith('<<', i) || s.startsWith('>>', i)) { t.push({ t: 'op', v: s.substr(i, 2) }); i += 2; continue; }
    t.push({ t: 'op', v: c }); i++;
  }
  return t;
}

export function evalExpr(str: string, ctx: ExprContext): number {
  const tk = tokenize(str, ctx.pc);
  let p = 0;
  const peek = (): Tok | undefined => tk[p];

  function primary(): number {
    const x = tk[p];
    if (!x) throw new Error('unexpected end of expression');
    if (x.t === 'num') { p++; return x.v; }
    if (x.t === 'id') {
      p++;
      const found = ctx.lookup(x.v.toUpperCase());
      if (found !== undefined) return found;
      if (ctx.lenient) return 0;
      throw new Error('unknown symbol "' + x.v + '"');
    }
    if (x.v === '(') {
      p++;
      const v = expr();
      const pk = peek();
      if (!pk || pk.t !== 'op' || pk.v !== ')') throw new Error('missing )');
      p++; return v;
    }
    if (x.v === '-' || x.v === '+' || x.v === '~') {
      p++; const v = primary();
      return x.v === '-' ? -v : x.v === '~' ? ~v : v;
    }
    throw new Error('bad token "' + x.v + '"');
  }

  function binop(next: () => number, ops: string[], apply: (op: string, a: number, b: number) => number): number {
    let v = next();
    for (;;) {
      const o = peek();
      if (!o || o.t !== 'op' || !ops.includes(o.v)) break;
      p++;
      v = apply(o.v, v, next());
    }
    return v;
  }

  const mul = () => binop(primary, ['*', '/', '%'], (o, a, b) => (o === '*' ? a * b : o === '/' ? Math.floor(a / b) : a % b));
  const add = () => binop(mul, ['+', '-'], (o, a, b) => (o === '+' ? a + b : a - b));
  const shift = () => binop(add, ['<<', '>>'], (o, a, b) => (o === '<<' ? a << b : a >> b));
  const expr = () => binop(shift, ['&', '|', '^'], (o, a, b) => (o === '&' ? a & b : o === '|' ? a | b : a ^ b));

  const v = expr();
  if (p < tk.length) throw new Error('trailing "' + tk[p].v + '" in expression');
  return v | 0;
}
