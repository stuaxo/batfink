// Hex formatting shared by the debug tools and the UI that drives them.
export const hex = (n: number, digits = 2): string =>
  n.toString(16).toUpperCase().padStart(digits, '0');

/** A 16-bit address in the assembler's `&FFFF` form. */
export const addr16 = (n: number): string => '&' + hex(n & 0xffff, 4);
