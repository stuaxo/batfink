// The page heading, drawn with the same 8x8 font the demo uses so it changes
// when you edit the font in the listing.
export function drawWordmark(canvas: HTMLCanvasElement, fontBytes: ArrayLike<number>): void {
  const text = 'AMSTRAD CPC 464';
  const s = Math.max(2, Math.min(4, Math.floor(Math.min(window.innerWidth - 40, 1180) / (text.length * 8))));
  canvas.width = text.length * 8 * s + s * 2;
  canvas.height = 8 * s + s * 2;
  const g = canvas.getContext('2d');
  if (!g) return;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 32 || code > 90) continue;
    const base = (code - 32) * 8;
    for (let row = 0; row < 8; row++) {
      const bits = fontBytes[base + row];
      for (let col = 0; col < 8; col++) {
        if (!(bits & (0x80 >> col))) continue;
        g.fillStyle = 'rgba(0,0,0,.55)';
        g.fillRect((i * 8 + col) * s + s * 1.5, row * s + s * 1.5, s, s);
        g.fillStyle = row < 3 ? '#ffff00' : row < 6 ? '#ff8000' : '#ff0000';
        g.fillRect((i * 8 + col) * s, row * s, s, s);
      }
    }
  }
}
