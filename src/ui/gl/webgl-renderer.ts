// WebGL2 screen renderer: the CRTC fetch, pixel decode and palette lookup run
// once per output pixel in a fragment shader, in one draw call. The shader is a
// direct transcription of glPixel in ./pixel — on construction we render a test
// frame both ways and bail to the software renderer if they disagree, so a bad
// driver or a transcription slip degrades to correct-but-slower, never garbage.
import {
  makeCPC, frameView, PIXEL_TABLES, CPC_PALETTE, type CPCMachine,
  WIDTH, HEIGHT, LINES_PER_FRAME, PENS_PER_LINE,
} from '../../cpc';
import type { Renderer } from '../renderer';
import { renderViewGL } from './pixel';

const VERT = `#version 300 es
void main() {
  // fullscreen triangle
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float; precision highp int;
precision highp usampler2D; precision highp sampler2D;

uniform usampler2D uRam;        // 256x256  ram[addr] = texel(addr&255, addr>>8)
uniform usampler2D uLinePens;   // 17x312   linePens[line*17+pen] = texel(pen, line)
uniform usampler2D uLinePal12;  // 17x312   Plus 12-bit screen palette, (R<<8)|(G<<4)|B
uniform usampler2D uPixTable;   // 256x24   PIXEL_TABLES[mode][byte][dot] = texel(byte, mode*8+dot)
uniform sampler2D  uPalette;    // 32x1     CPC_PALETTE, normalised
uniform usampler2D uSprData;    // 256x16   sprite pixel data, texel(row*16+col, s)
uniform usampler2D uSprAttr;    // 8x16     sprite attributes, texel(byte, s)
uniform usampler2D uPal12;      // 32x1     full 12-bit palette (sprite inks 16-31)
uniform int uCrtc1, uCrtc6, uCrtc12, uCrtc13, uMode, uPlus, uHscroll, uVscroll;

out vec4 outColor;

const int W = ${WIDTH};
const int H = ${HEIGHT};
const int BX = 48;
const int BY = 24;
const int LINES = ${LINES_PER_FRAME};
const int MAG[4] = int[4](0, 1, 2, 4);

vec4 col12(uint c) {
  return vec4(vec3(uvec3(c >> 8u, c >> 4u, c) & 15u) * (17.0 / 255.0), 1.0);
}

/** Top-most sprite pixel over picture (cx, cy) as a packed 12-bit colour, or -1. */
int spritePix(int cx, int cy) {
  if (uPlus == 0) return -1;
  int dx = cx - BX;
  int dy = (cy >> 1) - BY;
  if (dx < 0 || dx >= 640 || dy < 0 || dy >= 200) return -1;
  for (int s = 0; s < 16; s++) {
    int mag = int(texelFetch(uSprAttr, ivec2(4, s), 0).r);
    int mx = MAG[mag & 3];
    int my = MAG[(mag >> 2) & 3];
    if (mx == 0 || my == 0) continue;
    int x = int(texelFetch(uSprAttr, ivec2(0, s), 0).r) | (int(texelFetch(uSprAttr, ivec2(1, s), 0).r) << 8);
    int y = int(texelFetch(uSprAttr, ivec2(2, s), 0).r) | (int(texelFetch(uSprAttr, ivec2(3, s), 0).r) << 8);
    if (x >= 0x8000) x -= 0x10000;
    if (y >= 0x8000) y -= 0x10000;
    int px = dx - x;
    int py = dy - y;
    if (px < 0 || px >= 16 * mx || py < 0 || py >= 16 * my) continue;
    int pen = int(texelFetch(uSprData, ivec2((py / my) * 16 + (px / mx), s), 0).r) & 15;
    if (pen == 0) continue;
    return int(texelFetch(uPal12, ivec2(16 + pen, 0), 0).r);
  }
  return -1;
}

vec4 palOf(int line, int pen) {
  int l = ((line % LINES) + LINES) % LINES;
  if (uPlus == 1) return col12(texelFetch(uLinePal12, ivec2(pen, l), 0).r);
  int idx = int(texelFetch(uLinePens, ivec2(pen, l), 0).r) & 31;
  return vec4(texelFetch(uPalette, ivec2(idx, 0), 0).rgb, 1.0);
}

void main() {
  int cx = int(gl_FragCoord.x);
  int cy = H - 1 - int(gl_FragCoord.y);   // GL is bottom-up; our buffer is top-down

  int sp = spritePix(cx, cy);
  if (sp >= 0) { outColor = col12(uint(sp)); return; }

  int srcY = cy >> 1;                     // the picture is line-doubled

  if (srcY < BY) { outColor = palOf(LINES - BY + srcY, 16); return; }
  if (srcY >= BY + 200) { outColor = palOf(200 + (srcY - BY - 200), 16); return; }

  int y = srcY - BY;
  int rows = min(uCrtc6, 25) * 8;
  if (cx < BX || cx >= BX + 640 || y >= rows) { outColor = palOf(y, 16); return; }

  int dispX = cx - BX - uHscroll;   // soft scroll: shift the picture right/down
  int sy = y - uVscroll;
  if (dispX < 0 || sy < 0) { outColor = palOf(y, 16); return; }

  int base = (uCrtc12 & 0x30) << 10;
  int offset = (((uCrtc12 & 0x03) << 8) | uCrtc13) * 2;
  int bytesPerLine = uCrtc1 * 2;
  int raster = sy & 7;
  int lineStart = ((sy >> 3) * bytesPerLine + offset) & 0x7ff;

  int b = dispX >> 3;
  int dotsPerByte = uMode == 0 ? 2 : (uMode == 1 ? 4 : 8);
  int dot = (dispX & 7) / (8 / dotsPerByte);

  int addr = base + raster * 0x800 + ((lineStart + b) & 0x7ff);
  uint sb = texelFetch(uRam, ivec2(addr & 255, (addr >> 8) & 255), 0).r;
  int pen = int(texelFetch(uPixTable, ivec2(int(sb), uMode * 8 + dot), 0).r);

  outColor = palOf(y, pen);
}`;

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    throw new Error('shader: ' + gl.getShaderInfoLog(sh));
  }
  return sh;
}

/** PIXEL_TABLES flattened to a 256 x 24 R8UI texture. */
const pixTableData = (() => {
  const d = new Uint8Array(256 * 24);
  for (let mode = 0; mode < 3; mode++) {
    for (let byte = 0; byte < 256; byte++) {
      const pens = PIXEL_TABLES[mode][byte];
      for (let dot = 0; dot < pens.length; dot++) d[(mode * 8 + dot) * 256 + byte] = pens[dot];
    }
  }
  return d;
})();

const paletteData = (() => {
  const d = new Uint8Array(32 * 4);
  for (let i = 0; i < 32; i++) {
    const c = CPC_PALETTE[i];
    d[i * 4] = c[0]; d[i * 4 + 1] = c[1]; d[i * 4 + 2] = c[2]; d[i * 4 + 3] = 255;
  }
  return d;
})();

export class WebGLRenderer implements Renderer {
  private readonly gl: WebGL2RenderingContext;
  private readonly prog: WebGLProgram;
  private readonly ram: WebGLTexture;
  private readonly linePens: WebGLTexture;
  private readonly linePal12: WebGLTexture;
  private readonly sprData: WebGLTexture;
  private readonly sprAttr: WebGLTexture;
  private readonly pal12: WebGLTexture;
  private readonly u: Record<string, WebGLUniformLocation | null>;

  constructor(canvas: HTMLCanvasElement, opts: { selfCheck?: boolean } = {}) {
    const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true, antialias: false });
    if (!gl || typeof gl.createShader !== 'function') throw new Error('no webgl2');
    this.gl = gl;
    canvas.width = WIDTH;
    canvas.height = HEIGHT;

    this.prog = gl.createProgram()!;
    gl.attachShader(this.prog, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(this.prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(this.prog);
    if (!gl.getProgramParameter(this.prog, gl.LINK_STATUS)) {
      throw new Error('link: ' + gl.getProgramInfoLog(this.prog));
    }
    gl.useProgram(this.prog);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);

    const mkTex = (unit: number, name: string) => {
      const t = gl.createTexture()!;
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.uniform1i(gl.getUniformLocation(this.prog, name), unit);
      return t;
    };
    const r8ui = (w: number, h: number, data: Uint8Array | null) =>
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8UI, w, h, 0, gl.RED_INTEGER, gl.UNSIGNED_BYTE, data);

    this.ram = mkTex(0, 'uRam');
    r8ui(256, 256, null);
    this.linePens = mkTex(1, 'uLinePens');
    r8ui(PENS_PER_LINE, LINES_PER_FRAME, null);
    mkTex(2, 'uPixTable');
    r8ui(256, 24, pixTableData);
    mkTex(3, 'uPalette');
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 32, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, paletteData);
    this.linePal12 = mkTex(4, 'uLinePal12');
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16UI, PENS_PER_LINE, LINES_PER_FRAME, 0, gl.RED_INTEGER, gl.UNSIGNED_SHORT, null);
    this.sprData = mkTex(5, 'uSprData');
    r8ui(256, 16, null);
    this.sprAttr = mkTex(6, 'uSprAttr');
    r8ui(8, 16, null);
    this.pal12 = mkTex(7, 'uPal12');
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16UI, 32, 1, 0, gl.RED_INTEGER, gl.UNSIGNED_SHORT, null);

    this.u = {};
    for (const n of ['uCrtc1', 'uCrtc6', 'uCrtc12', 'uCrtc13', 'uMode', 'uPlus', 'uHscroll', 'uVscroll']) {
      this.u[n] = gl.getUniformLocation(this.prog, n);
    }
    gl.bindVertexArray(gl.createVertexArray());
    gl.viewport(0, 0, WIDTH, HEIGHT);

    if (opts.selfCheck !== false) this.selfCheck();
  }

  /** Render synthetic frames on the GPU and off it; throw if any pixel diverges,
   *  so createRenderer falls back to software. Covers every mode and a couple of
   *  CRTC layouts — this is the only guard on the transcribed shader. */
  private selfCheck(): void {
    const gpu = new Uint8Array(WIDTH * HEIGHT * 4);
    const cpu = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
    const compare = (m: CPCMachine, tag: string) => {
      this.draw(m);
      this.gl.readPixels(0, 0, WIDTH, HEIGHT, this.gl.RGBA, this.gl.UNSIGNED_BYTE, gpu);
      renderViewGL(frameView(m), cpu);
      for (let row = 0; row < HEIGHT; row++) {
        const g = (HEIGHT - 1 - row) * WIDTH * 4; // readPixels is bottom-up
        const c = row * WIDTH * 4;
        for (let i = 0; i < WIDTH * 4; i++) {
          if (gpu[g + i] !== cpu[c + i]) {
            throw new Error(`self-check mismatch (${tag}) at x=${i >> 2} y=${row}: ${gpu[g + i]} vs ${cpu[c + i]}`);
          }
        }
      }
    };

    const m = makeCPC();
    m.reset();
    for (let i = 0; i < m.ram.length; i++) m.ram[i] = (i * 7 + 13) & 0xff;
    for (let i = 0; i < m.linePens.length; i++) m.linePens[i] = (i * 5 + 1) & 0x1f;
    for (const L of [
      { mode: 0, r1: 40, r6: 25, r12: 0x30, r13: 0 },
      { mode: 1, r1: 40, r6: 25, r12: 0x0c, r13: 40 },
      { mode: 2, r1: 32, r6: 20, r12: 0x20, r13: 5 },
    ]) {
      m.mode = L.mode;
      m.crtc[1] = L.r1; m.crtc[6] = L.r6; m.crtc[12] = L.r12; m.crtc[13] = L.r13;
      compare(m, `mode ${L.mode}`);
    }

    // Plus: the 12-bit palette and a couple of sprites
    const pm = makeCPC('gx4000');
    pm.reset();
    pm.mode = 1;
    for (let i = 0; i < pm.ram.length; i++) pm.ram[i] = (i * 11 + 5) & 0xff;
    for (let i = 0; i < pm.linePal12.length; i++) pm.linePal12[i] = (i * 37 + 7) & 0xfff;
    pm.crtc[1] = 40; pm.crtc[6] = 25; pm.crtc[12] = 0x30; pm.crtc[13] = 0;
    const asic = pm.asic!;
    for (let i = 0; i < asic.pal12.length; i++) asic.pal12[i] = (i * 111 + 9) & 0xfff;
    for (let i = 0; i < 16 * 256; i++) asic.regs[i] = i & 0x0f;      // sprite pixels
    asic.regs[0x2000 + 4] = 0x05; asic.regs[0x2000 + 0] = 30; asic.regs[0x2000 + 2] = 40; // sprite 0: 1x2 mag at (30,40)
    asic.regs[0x2000 + 8 + 4] = 0x0a; asic.regs[0x2000 + 8 + 0] = 200; asic.regs[0x2000 + 8 + 2] = 100; // sprite 1: 2x4 mag
    asic.regs[0x2804] = (5 << 4) | 11; // SSCR: hscroll 11, vscroll 5
    compare(pm, 'plus');
  }

  draw(m: CPCMachine): void {
    const gl = this.gl;
    const v = frameView(m);
    gl.useProgram(this.prog);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.ram);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 256, 256, gl.RED_INTEGER, gl.UNSIGNED_BYTE, v.ram);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.linePens);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, PENS_PER_LINE, LINES_PER_FRAME, gl.RED_INTEGER, gl.UNSIGNED_BYTE, v.linePens);

    const plus = v.linePal12 != null;
    if (plus) {
      gl.activeTexture(gl.TEXTURE4);
      gl.bindTexture(gl.TEXTURE_2D, this.linePal12);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, PENS_PER_LINE, LINES_PER_FRAME, gl.RED_INTEGER, gl.UNSIGNED_SHORT, v.linePal12);
      gl.activeTexture(gl.TEXTURE5);
      gl.bindTexture(gl.TEXTURE_2D, this.sprData);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 256, 16, gl.RED_INTEGER, gl.UNSIGNED_BYTE, v.spriteData!);
      gl.activeTexture(gl.TEXTURE6);
      gl.bindTexture(gl.TEXTURE_2D, this.sprAttr);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 8, 16, gl.RED_INTEGER, gl.UNSIGNED_BYTE, v.spriteAttr!);
      gl.activeTexture(gl.TEXTURE7);
      gl.bindTexture(gl.TEXTURE_2D, this.pal12);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 32, 1, gl.RED_INTEGER, gl.UNSIGNED_SHORT, v.spritePal12!);
    }

    gl.uniform1i(this.u.uCrtc1, v.crtc[1]);
    gl.uniform1i(this.u.uCrtc6, v.crtc[6]);
    gl.uniform1i(this.u.uCrtc12, v.crtc[12]);
    gl.uniform1i(this.u.uCrtc13, v.crtc[13]);
    gl.uniform1i(this.u.uMode, v.mode);
    gl.uniform1i(this.u.uPlus, plus ? 1 : 0);
    gl.uniform1i(this.u.uHscroll, v.hscroll);
    gl.uniform1i(this.u.uVscroll, v.vscroll);

    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteProgram(this.prog);
    gl.deleteTexture(this.ram);
    gl.deleteTexture(this.linePens);
    gl.deleteTexture(this.linePal12);
    gl.deleteTexture(this.sprData);
    gl.deleteTexture(this.sprAttr);
    gl.deleteTexture(this.pal12);
  }
}
