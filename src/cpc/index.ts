// Barrel for the CPC hardware model. The whole surface is DOM-free and runs
// unchanged in Node.
export { makeCPC } from './machine';
export type { CPCMachine } from './machine';
export { makeBus } from './ports';
export { renderFrame } from './video';
export { runFrame } from './frame';
export { snapshotSNA } from './sna';
export { CPC_PALETTE } from './palette';
export type { Rgb } from './palette';
export { PIXEL_TABLES } from './pixels';
export { CPC_KEYS, keyByName } from './keyboard';
export * from './constants';
