// The 32 Gate-Array hardware colour slots mapped to RGB. Index a slot with
// `pen & 0x1F`; each entry is a fixed [r, g, b] triple.
export type Rgb = readonly [number, number, number];

export const CPC_PALETTE: readonly Rgb[] = (() => {
  const L = [0, 128, 255] as const;
  const c = (r: number, g: number, b: number): Rgb => [L[r], L[g], L[b]];
  const N = {
    black: c(0, 0, 0), blue: c(0, 0, 1), brightBlue: c(0, 0, 2),
    red: c(1, 0, 0), magenta: c(1, 0, 1), mauve: c(1, 0, 2),
    brightRed: c(2, 0, 0), purple: c(2, 0, 1), brightMagenta: c(2, 0, 2),
    green: c(0, 1, 0), cyan: c(0, 1, 1), skyBlue: c(0, 1, 2),
    yellow: c(1, 1, 0), white: c(1, 1, 1), pastelBlue: c(1, 1, 2),
    orange: c(2, 1, 0), pink: c(2, 1, 1), pastelMagenta: c(2, 1, 2),
    brightGreen: c(0, 2, 0), seaGreen: c(0, 2, 1), brightCyan: c(0, 2, 2),
    lime: c(1, 2, 0), pastelGreen: c(1, 2, 1), pastelCyan: c(1, 2, 2),
    brightYellow: c(2, 2, 0), pastelYellow: c(2, 2, 1), brightWhite: c(2, 2, 2),
  };
  return [
    N.white, N.white, N.seaGreen, N.pastelYellow, N.blue, N.purple, N.cyan, N.pink,
    N.purple, N.pastelCyan, N.pastelYellow, N.brightWhite, N.brightRed, N.brightMagenta,
    N.orange, N.pastelMagenta, N.lime, N.pastelGreen, N.brightGreen, N.brightCyan,
    N.black, N.brightBlue, N.green, N.skyBlue, N.magenta, N.pastelCyan, N.brightYellow,
    N.brightWhite, N.red, N.mauve, N.yellow, N.pastelBlue,
  ];
})();
