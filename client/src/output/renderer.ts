// WebGL2-Renderer: zeichnet jede Fläche mit exakter Homographie pro Pixel.
//
// Für jeden Bildschirmpixel rechnet der Fragment-Shader mit der inversen Homographie
// zurück in die Inhaltskoordinate (u,v). Damit ist die Perspektive in jedem Pixel korrekt
// – es gibt keine Knickkante entlang der Diagonalen wie bei zwei affinen Dreiecken.

import { invert, squareToQuad, type Mat3 } from '../../../shared/homography.js';
import type { Quad } from '../../../shared/types.js';

const VERT = `#version 300 es
in vec2 aPos; // normierte Ausgabekoordinaten, (0,0) oben links
void main() {
  gl_Position = vec4(aPos.x * 2.0 - 1.0, 1.0 - aPos.y * 2.0, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
uniform mat3 uInv;      // Ausgaberaum → Inhalt (u,v)
uniform vec2 uRes;      // Zeichenpuffer in Pixeln
uniform sampler2D uTex;
uniform float uOpacity;
out vec4 outColor;
void main() {
  vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uRes;
  vec3 q = uInv * vec3(p, 1.0);
  if (q.z <= 0.0) discard;            // Punkt liegt „hinter“ der Ebene
  vec2 uv = q.xy / q.z;
  // 1-px-Kantenglättung über die Ableitung von uv
  vec2 fw = max(fwidth(uv), vec2(1e-6));
  vec2 edge = clamp(uv / fw + 0.5, 0.0, 1.0) * clamp((1.0 - uv) / fw + 0.5, 0.0, 1.0);
  float a = edge.x * edge.y * uOpacity;
  if (a <= 0.0) discard;
  vec4 c = texture(uTex, clamp(uv, 0.0, 1.0));
  outColor = vec4(c.rgb * a, a);       // vormultipliziertes Alpha
}`;

export interface DrawItem {
  corners: Quad;
  texture: WebGLTexture;
  opacity: number;
}

export class Renderer {
  readonly gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private buffer: WebGLBuffer;
  private loc: { pos: number; inv: WebGLUniformLocation; res: WebGLUniformLocation; tex: WebGLUniformLocation; opacity: WebGLUniformLocation };
  private verts = new Float32Array(12);

  constructor(readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      premultipliedAlpha: true,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance',
    });
    if (!gl) throw new Error('WebGL2 wird von diesem Browser nicht unterstützt');
    this.gl = gl;
    this.program = link(gl, VERT, FRAG);
    this.buffer = gl.createBuffer()!;
    const u = (name: string) => gl.getUniformLocation(this.program, name)!;
    this.loc = {
      pos: gl.getAttribLocation(this.program, 'aPos'),
      inv: u('uInv'),
      res: u('uRes'),
      tex: u('uTex'),
      opacity: u('uOpacity'),
    };
  }

  /** Passt den Zeichenpuffer an die Anzeigegröße an. Gibt die Pixelgröße zurück. */
  resize(scale = 1): { width: number; height: number } {
    const dpr = (window.devicePixelRatio || 1) * scale;
    const w = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    return { width: w, height: h };
  }

  createTexture(): WebGLTexture {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
    return tex;
  }

  upload(tex: WebGLTexture, source: TexImageSource, mipmap = false): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    if (mipmap) {
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    }
  }

  deleteTexture(tex: WebGLTexture): void {
    this.gl.deleteTexture(tex);
  }

  draw(items: DrawItem[]): void {
    const gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (items.length === 0) return;

    gl.useProgram(this.program);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.uniform2f(this.loc.res, this.canvas.width, this.canvas.height);
    gl.uniform1i(this.loc.tex, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.enableVertexAttribArray(this.loc.pos);
    gl.vertexAttribPointer(this.loc.pos, 2, gl.FLOAT, false, 0, 0);

    for (const item of items) {
      const inv = surfaceInverse(item.corners);
      if (!inv) continue;
      // Begrenzungsrechteck der Fläche zeichnen; der Shader verwirft alles außerhalb
      const xs = item.corners.map((p) => p.x);
      const ys = item.corners.map((p) => p.y);
      const x0 = Math.max(0, Math.min(...xs));
      const x1 = Math.min(1, Math.max(...xs));
      const y0 = Math.max(0, Math.min(...ys));
      const y1 = Math.min(1, Math.max(...ys));
      if (x1 <= x0 || y1 <= y0) continue;
      this.verts.set([x0, y0, x1, y0, x0, y1, x0, y1, x1, y0, x1, y1]);
      gl.bufferData(gl.ARRAY_BUFFER, this.verts, gl.STREAM_DRAW);
      gl.uniformMatrix3fv(this.loc.inv, true, inv); // row-major → transpose
      gl.uniform1f(this.loc.opacity, item.opacity);
      gl.bindTexture(gl.TEXTURE_2D, item.texture);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
  }
}

/**
 * Inverse Homographie Ausgaberaum → Einheitsquadrat, so skaliert, dass w im
 * Inneren der Fläche positiv ist (der Shader verwirft w ≤ 0).
 */
export function surfaceInverse(corners: Quad): Mat3 | null {
  const h = squareToQuad(corners);
  const inv = h && invert(h);
  if (!inv) return null;
  const cx = (corners[0].x + corners[1].x + corners[2].x + corners[3].x) / 4;
  const cy = (corners[0].y + corners[1].y + corners[2].y + corners[3].y) / 4;
  const w = inv[6] * cx + inv[7] * cy + inv[8];
  return (w < 0 ? inv.map((v) => -v) : inv) as Mat3;
}

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'Shaderfehler');
  return s;
}

function link(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const p = gl.createProgram()!;
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'Linkfehler');
  return p;
}
