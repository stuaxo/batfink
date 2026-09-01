// Pixel decode tables: PIXEL_TABLES[mode][byte] -> array of pen numbers,
// left pixel first. Mode 0 packs 2 pixels/byte, mode 1 four, mode 2 eight.
export const PIXEL_TABLES: readonly (readonly number[])[][] = (() => {
  const t: number[][][] = [[], [], []];
  for (let b = 0; b < 256; b++) {
    t[0][b] = [
      ((b & 0x80) >> 7) | ((b & 0x08) >> 2) | ((b & 0x20) >> 3) | ((b & 0x02) << 2),
      ((b & 0x40) >> 6) | ((b & 0x04) >> 1) | ((b & 0x10) >> 2) | ((b & 0x01) << 3),
    ];
    t[1][b] = [
      ((b & 0x80) >> 7) | ((b & 0x08) >> 2),
      ((b & 0x40) >> 6) | ((b & 0x04) >> 1),
      ((b & 0x20) >> 5) | ((b & 0x02)),
      ((b & 0x10) >> 4) | ((b & 0x01) << 1),
    ];
    t[2][b] = [7, 6, 5, 4, 3, 2, 1, 0].map((s) => (b >> s) & 1);
  }
  return t;
})();
