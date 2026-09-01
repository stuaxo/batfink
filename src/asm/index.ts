// Public surface of the assembler. expr / operands / encode are internals.
export { assemble } from './assembler';
export type { AssembleResult, AssembleError, ListingRow } from './assembler';
export { disassemble } from './disasm';
export type { Decoded } from './disasm';
