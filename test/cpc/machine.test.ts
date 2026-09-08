import { describe, it, expect } from 'vitest';
import { makeCPC, isRam128, isPlus } from '../../src/cpc';

describe('makeCPC kind', () => {
  it('defaults to a CPC 464', () => {
    expect(makeCPC().kind).toBe('cpc464');
  });

  it('records the kind it was built with', () => {
    expect(makeCPC('cpc6128').kind).toBe('cpc6128');
    expect(makeCPC('gx4000').kind).toBe('gx4000');
  });

  it('starts with no cartridge', () => {
    expect(makeCPC('plus464').cart).toBeNull();
  });

  it('isRam128 and isPlus classify the kinds', () => {
    expect(isRam128('cpc464')).toBe(false);
    expect(isRam128('cpc6128')).toBe(true);
    expect(isRam128('plus6128')).toBe(true);
    expect(isRam128('gx4000')).toBe(false);

    expect(isPlus('cpc6128')).toBe(false);
    expect(isPlus('plus464')).toBe(true);
    expect(isPlus('gx4000')).toBe(true);
  });
});
