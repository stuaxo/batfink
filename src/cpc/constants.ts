// Amstrad CPC 464 geometry and timing. RAM-only model: firmware ROMs are not
// emulated, so anything that pages a ROM in just reads back 0xFF-filled RAM.

export const BORDER_X = 48; // screen pixels of border either side
export const BORDER_Y = 24; // scanlines of border above and below
export const WIDTH = 640 + BORDER_X * 2; // 736
export const HEIGHT = (200 + BORDER_Y * 2) * 2; // 496

export const CYCLES_PER_LINE = 256;
export const LINES_PER_FRAME = 312;
export const CYCLES_PER_FRAME = CYCLES_PER_LINE * LINES_PER_FRAME; // 79872 @ 4MHz -> 50.08Hz
export const INTERRUPT_LINES = 52;
export const VSYNC_START = 240; // CRTC R7: sync pulse after the displayed rows
export const VSYNC_LINES = 8;

/** Scanline at which runFrame stops, so a rendered frame is always untorn. */
export const RENDER_LINE = 200;

/** 17 palette entries per scanline: pens 0-15 plus the border at index 16. */
export const PENS_PER_LINE = 17;

// CRTC register defaults as the CPC firmware leaves them.
export const CRTC_DEFAULTS: readonly number[] = [63, 40, 46, 0x8e, 38, 0, 25, 30, 0, 7, 0, 0, 0x30, 0, 0, 0, 0, 0];
