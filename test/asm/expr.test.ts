import { describe, it, expect } from 'vitest';
import { evalExpr, type ExprContext } from '../../src/asm/expr';

const ctx = (over: Partial<ExprContext> = {}): ExprContext => ({
  pc: 0,
  lenient: false,
  lookup: () => undefined,
  ...over,
});

describe('expression evaluator', () => {
  it('parses every number form', () => {
    expect(evalExpr('&FF', ctx())).toBe(0xff);
    expect(evalExpr('#1A', ctx())).toBe(0x1a);
    expect(evalExpr('0x0F', ctx())).toBe(0x0f);
    expect(evalExpr('0FFh', ctx())).toBe(0xff);
    expect(evalExpr('%1010', ctx())).toBe(0b1010);
    expect(evalExpr('42', ctx())).toBe(42);
    expect(evalExpr("'A'", ctx())).toBe(65);
  });

  it('honours precedence: mul, then add, then shift, then bitwise', () => {
    expect(evalExpr('2 + 3 * 4', ctx())).toBe(14);
    expect(evalExpr('1 << 3 + 1', ctx())).toBe(16); // 1 << (3 + 1)
    // & | ^ share one left-associative precedence level, below the shifts.
    expect(evalExpr('&FF & &0F | &30', ctx())).toBe(0x3f); // (FF & 0F) | 30
    expect(evalExpr('-(2 + 3)', ctx())).toBe(-5);
    expect(evalExpr('~0 & &FF', ctx())).toBe(0xff);
  });

  it('resolves $ to the supplied pc and symbols via lookup', () => {
    expect(evalExpr('$ + 2', ctx({ pc: 0x4000 }))).toBe(0x4002);
    expect(evalExpr('start + 4', ctx({ lookup: (n) => (n === 'START' ? 0x100 : undefined) }))).toBe(0x104);
  });

  it('is lenient about unknown symbols only when asked', () => {
    expect(evalExpr('missing', ctx({ lenient: true }))).toBe(0);
    expect(() => evalExpr('missing', ctx({ lenient: false }))).toThrow(/unknown symbol/i);
  });

  it('rejects malformed expressions', () => {
    expect(() => evalExpr('(1 + 2', ctx())).toThrow(/missing \)/);
    expect(() => evalExpr('1 2', ctx())).toThrow(/trailing/i);
  });
});
