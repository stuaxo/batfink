// The per-pixel form of the software renderer (../../cpc/video renderView),
// written the way the fragment shader in ./webgl-renderer works. This is the
// reference the GLSL is transcribed from; test/ui/gl/parity.test.ts holds them
// byte-for-byte together against renderView across the example gallery.
//
// Difference from renderView: per-scanline palette only. Mid-line pen writes
// (FrameView.paletteWrites) are a software-renderer refinement; the WebGL path
// renders each scanline from its opening palette (linePens).
import {
  CPC_PALETTE, PIXEL_TABLES, type FrameView,
  BORDER_X, BORDER_Y, WIDTH, HEIGHT, LINES_PER_FRAME, PENS_PER_LINE,
} from '../../cpc';

const P = PENS_PER_LINE;

/** RGB for output pixel (cx, cy), 0 ≤ cx < WIDTH, 0 ≤ cy < HEIGHT. */
export function glPixel(v: FrameView, cx: number, cy: number): [number, number, number] {
  const srcY = cy >> 1; // the picture is line-doubled

  const borderOf = (line: number): [number, number, number] => {
    const c = CPC_PALETTE[v.linePens[(line % LINES_PER_FRAME) * P + 16] & 0x1f];
    return [c[0], c[1], c[2]];
  };

  if (srcY < BORDER_Y) return borderOf(LINES_PER_FRAME - BORDER_Y + srcY);
  if (srcY >= BORDER_Y + 200) return borderOf(200 + (srcY - BORDER_Y - 200));

  const y = srcY - BORDER_Y; // displayed row 0..199
  const lp = y * P;

  const rows = Math.min(v.crtc[6], 25) * 8;
  const inPicture = cx >= BORDER_X && cx < BORDER_X + 640 && y < rows;
  if (!inPicture) {
    const c = CPC_PALETTE[v.linePens[lp + 16] & 0x1f];
    return [c[0], c[1], c[2]];
  }

  const base = (v.crtc[12] & 0x30) << 10;
  const offset = (((v.crtc[12] & 0x03) << 8) | v.crtc[13]) * 2;
  const bytesPerLine = v.crtc[1] * 2;
  const raster = y & 7;
  const lineStart = ((y >> 3) * bytesPerLine + offset) & 0x7ff;

  const dispX = cx - BORDER_X; // 0..639, always 80 bytes of 8 canvas px
  const b = dispX >> 3;
  const dotsPerByte = v.mode === 0 ? 2 : v.mode === 1 ? 4 : 8;
  const dot = Math.floor((dispX & 7) / (8 / dotsPerByte)); // 0..dotsPerByte-1

  const addr = base + raster * 0x800 + ((lineStart + b) & 0x7ff);
  const pen = PIXEL_TABLES[v.mode][v.ram[addr]][dot];
  const c = CPC_PALETTE[v.linePens[lp + pen] & 0x1f];
  return [c[0], c[1], c[2]];
}

/** Fill an RGBA buffer pixel by pixel — the algorithm the shader runs. */
export function renderViewGL(v: FrameView, rgba: Uint8ClampedArray): void {
  for (let cy = 0; cy < HEIGHT; cy++) {
    for (let cx = 0; cx < WIDTH; cx++) {
      const [r, g, bl] = glPixel(v, cx, cy);
      const o = (cy * WIDTH + cx) * 4;
      rgba[o] = r; rgba[o + 1] = g; rgba[o + 2] = bl; rgba[o + 3] = 255;
    }
  }
}
