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

uniform usampler2D uRam;       // 256x256  ram[addr] = texel(addr&255, addr>>8)
uniform usampler2D uLinePens;  // 17x312   linePens[line*17+pen] = texel(pen, line)
uniform usampler2D uPixTable;  // 256x24   PIXEL_TABLES[mode][byte][dot] = texel(byte, mode*8+dot)
uniform sampler2D  uPalette;   // 32x1     CPC_PALETTE, normalised
uniform int uCrtc1, uCrtc6, uCrtc12, uCrtc13, uMode;

out vec4 outColor;

const int W = ${WIDTH};
const int H = ${HEIGHT};
const int BX = 48;
const int BY = 24;
const int LINES = ${LINES_PER_FRAME};

int linePen(int line, int pen) {
  int l = ((line % LINES) + LINES) % LINES;
  return int(texelFetch(uLinePens, ivec2(pen, l), 0).r);
}
vec4 palOf(int line, int pen) {
  return vec4(texelFetch(uPalette, ivec2(linePen(line, pen) & 31, 0), 0).rgb, 1.0);
}

void main() {
  int cx = int(gl_FragCoord.x);
  int cy = H - 1 - int(gl_FragCoord.y);   // GL is bottom-up; our buffer is top-down
  int srcY = cy >> 1;                     // the picture is line-doubled

  if (srcY < BY) { outColor = palOf(LINES - BY + srcY, 16); return; }
  if (srcY >= BY + 200) { outColor = palOf(200 + (srcY - BY - 200), 16); return; }

  int y = srcY - BY;
  int rows = min(uCrtc6, 25) * 8;
  bool inPic = cx >= BX && cx < BX + 640 && y < rows;
  if (!inPic) { outColor = palOf(y, 16); return; }

  int base = (uCrtc12 & 0x30) << 10;
  int offset = (((uCrtc12 & 0x03) << 8) | uCrtc13) * 2;
  int bytesPerLine = uCrtc1 * 2;
  int raster = y & 7;
  int lineStart = ((y >> 3) * bytesPerLine + offset) & 0x7ff;

  int dispX = cx - BX;
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

    this.u = {};
    for (const n of ['uCrtc1', 'uCrtc6', 'uCrtc12', 'uCrtc13', 'uMode']) {
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
    const m = makeCPC();
    m.reset();
    for (let i = 0; i < m.ram.length; i++) m.ram[i] = (i * 7 + 13) & 0xff;
    for (let i = 0; i < m.linePens.length; i++) m.linePens[i] = (i * 5 + 1) & 0x1f;

    const layouts = [
      { mode: 0, r1: 40, r6: 25, r12: 0x30, r13: 0 },
      { mode: 1, r1: 40, r6: 25, r12: 0x0c, r13: 40 },
      { mode: 2, r1: 32, r6: 20, r12: 0x20, r13: 5 },
    ];
    const gpu = new Uint8Array(WIDTH * HEIGHT * 4);
    const cpu = new Uint8ClampedArray(WIDTH * HEIGHT * 4);

    for (const L of layouts) {
      m.mode = L.mode;
      m.crtc[1] = L.r1; m.crtc[6] = L.r6; m.crtc[12] = L.r12; m.crtc[13] = L.r13;
      this.draw(m);
      this.gl.readPixels(0, 0, WIDTH, HEIGHT, this.gl.RGBA, this.gl.UNSIGNED_BYTE, gpu);
      renderViewGL(frameView(m), cpu);

      for (let row = 0; row < HEIGHT; row++) {
        const g = (HEIGHT - 1 - row) * WIDTH * 4; // readPixels is bottom-up
        const c = row * WIDTH * 4;
        for (let i = 0; i < WIDTH * 4; i++) {
          if (gpu[g + i] !== cpu[c + i]) {
            throw new Error(`self-check mismatch (mode ${L.mode}) at x=${(i >> 2)} y=${row}: ${gpu[g + i]} vs ${cpu[c + i]}`);
          }
        }
      }
    }
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

    gl.uniform1i(this.u.uCrtc1, v.crtc[1]);
    gl.uniform1i(this.u.uCrtc6, v.crtc[6]);
    gl.uniform1i(this.u.uCrtc12, v.crtc[12]);
    gl.uniform1i(this.u.uCrtc13, v.crtc[13]);
    gl.uniform1i(this.u.uMode, v.mode);

    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteProgram(this.prog);
    gl.deleteTexture(this.ram);
    gl.deleteTexture(this.linePens);
  }
}
