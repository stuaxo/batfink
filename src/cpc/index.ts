// Barrel for the CPC hardware model. The whole surface is DOM-free and runs
// unchanged in Node.
export { makeCPC } from './machine';
export type { CPCMachine } from './machine';
export { makeBus } from './ports';
export { emptyRomSet, updateRomPaging } from './rom';
export type { RomSet } from './rom';
export { renderFrame } from './video';
export { runFrame, runUntil } from './frame';
export type { RunCondition, StopReason } from './frame';
export { getState, setState } from './state';
export type { MachineState, CpuState } from './state';
export { snapshotSNA } from './sna';
export { Ay } from './ay';
export { AudioSink } from './audio';
export { CPC_PALETTE } from './palette';
export type { Rgb } from './palette';
export { PIXEL_TABLES } from './pixels';
export { CPC_KEYS, keyByName } from './keyboard';
export * from './constants';
