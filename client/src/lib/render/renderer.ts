// WebGL2-Renderer: zeichnet jede Fläche mit exakter Homographie pro Pixel.
//
// Für jeden Bildschirmpixel rechnet der Fragment-Shader mit der inversen Homographie
// zurück in die Inhaltskoordinate (u,v). Damit ist die Perspektive in jedem Pixel korrekt
// – es gibt keine Knickkante entlang der Diagonalen wie bei zwei affinen Dreiecken.
// Die Ausgabe arbeitet mit vormultipliziertem Alpha auf schwarzem Hintergrund.

import { invert, squareToQuad, type Mat3 } from '../../../../shared/homography.js';
import type { BlendMode, Quad } from '../../../../shared/types.js';

const VERT = `#version 300 es
in vec2 aPos; // normierte Ausgabekoordinaten, (0,0) oben links
out vec2 vPos;
void main() {
  vPos = aPos;
  gl_Position = vec4(aPos.x * 2.0 - 1.0, 1.0 - aPos.y * 2.0, 0.0, 1.0);
}`;

const SURFACE_FRAG = `#version 300 es
precision highp float;
in vec2 vPos;
uniform mat3 uInv;        // Ausgaberaum → Inhalt (u,v)
uniform sampler2D uTex;
uniform sampler2D uMask;  // Flächenmaske im (u,v)-Raum, Alpha = Sichtbarkeit
uniform bool uHasMask;
uniform bool uUseColor;
uniform vec4 uColor;      // vormultipliziert
uniform vec2 uFitScale;   // Einpassung: Texturkoordinate = (uv - 0.5) * uFitScale + 0.5
uniform float uOpacity;
out vec4 outColor;
void main() {
  vec3 q = uInv * vec3(vPos, 1.0);
  if (q.z <= 0.0) discard;             // Punkt liegt „hinter“ der Ebene
  vec2 uv = q.xy / q.z;
  // 1-px-Kantenglättung über die Ableitung von uv
  vec2 fw = max(fwidth(uv), vec2(1e-6));
  vec2 edge = clamp(uv / fw + 0.5, 0.0, 1.0) * clamp((1.0 - uv) / fw + 0.5, 0.0, 1.0);
  float a = edge.x * edge.y * uOpacity;
  if (uHasMask) a *= texture(uMask, clamp(uv, 0.0, 1.0)).a;
  if (a <= 0.0) discard;
  vec4 c;
  if (uUseColor) {
    c = uColor;
  } else {
    vec2 t = (uv - 0.5) * uFitScale + 0.5;
    // Beim Einpassen bleibt der Rand außerhalb des Bildes leer
    vec2 inside = step(vec2(0.0), t) * step(t, vec2(1.0));
    c = texture(uTex, clamp(t, 0.0, 1.0)) * inside.x * inside.y;
  }
  outColor = c * a;
}`;

/** Globale Maske: multipliziert das bisher gezeichnete Bild mit der Maske. */
const MASK_FRAG = `#version 300 es
precision highp float;
in vec2 vPos;
uniform sampler2D uMask;
out vec4 outColor;
void main() {
  float m = texture(uMask, vPos).a;
  outColor = vec4(m);
}`;

export interface DrawItem {
  corners: Quad;
  /** null → Farbe zeichnen */
  texture: WebGLTexture | null;
  color: [number, number, number];
  opacity: number;
  blend: BlendMode;
  fitScale: [number, number];
  mask: WebGLTexture | null;
}

interface Program {
  program: WebGLProgram;
  pos: number;
  u: Record<string, WebGLUniformLocation | null>;
}

export class Renderer {
  readonly gl: WebGL2RenderingContext;
  private surface: Program;
  private maskPass: Program;
  private buffer: WebGLBuffer;
  private verts = new Float32Array(12);
  private white: WebGLTexture;

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
    this.surface = createProgram(gl, SURFACE_FRAG, [
      'uInv', 'uTex', 'uMask', 'uHasMask', 'uUseColor', 'uColor', 'uFitScale', 'uOpacity',
    ]);
    this.maskPass = createProgram(gl, MASK_FRAG, ['uMask']);
    this.buffer = gl.createBuffer()!;
    this.white = this.createTexture([255, 255, 255, 255]);
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

  createTexture(pixel: [number, number, number, number] = [0, 0, 0, 0]): WebGLTexture {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(pixel));
    return tex;
  }

  /**
   * Lädt ein Bild in die Textur. premultiply für Quellen mit Transparenz (Canvas);
   * Videos sind deckend – dort abschalten, damit Chrome den schnellen GPU-Pfad nutzt.
   * ImageBitmaps bringen ihre eigene Einstellung mit (createImageBitmap).
   */
  upload(tex: WebGLTexture, source: TexImageSource, opts: { mipmap?: boolean; premultiply?: boolean } = {}): void {
    const gl = this.gl;
    const mipmap = opts.mipmap ?? false;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, opts.premultiply ?? true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    if (mipmap) {
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    }
  }

  deleteTexture(tex: WebGLTexture): void {
    this.gl.deleteTexture(tex);
  }

  draw(items: DrawItem[], globalMask: WebGLTexture | null): void {
    const gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (items.length === 0) return;

    gl.enable(gl.BLEND);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);

    const sp = this.surface;
    gl.useProgram(sp.program);
    this.bindPos(sp);
    gl.uniform1i(sp.u.uTex!, 0);
    gl.uniform1i(sp.u.uMask!, 1);

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
      this.setRect(x0, y0, x1, y1);

      setBlend(gl, item.blend);
      gl.uniformMatrix3fv(sp.u.uInv!, true, inv); // row-major → transpose
      gl.uniform1f(sp.u.uOpacity!, item.opacity);
      gl.uniform2f(sp.u.uFitScale!, item.fitScale[0], item.fitScale[1]);
      gl.uniform1i(sp.u.uUseColor!, item.texture ? 0 : 1);
      gl.uniform4f(sp.u.uColor!, item.color[0], item.color[1], item.color[2], 1);
      gl.uniform1i(sp.u.uHasMask!, item.mask ? 1 : 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, item.mask ?? this.white);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, item.texture ?? this.white);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    if (globalMask) {
      const mp = this.maskPass;
      gl.useProgram(mp.program);
      this.bindPos(mp);
      this.setRect(0, 0, 1, 1);
      gl.blendFunc(gl.ZERO, gl.SRC_ALPHA); // Ziel × Maske
      gl.uniform1i(mp.u.uMask!, 0);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, globalMask);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
  }

  private bindPos(p: Program): void {
    const gl = this.gl;
    gl.enableVertexAttribArray(p.pos);
    gl.vertexAttribPointer(p.pos, 2, gl.FLOAT, false, 0, 0);
  }

  private setRect(x0: number, y0: number, x1: number, y1: number): void {
    this.verts.set([x0, y0, x1, y0, x0, y1, x0, y1, x1, y0, x1, y1]);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, this.verts, this.gl.STREAM_DRAW);
  }
}

/** Mischmodi für vormultipliziertes Alpha */
function setBlend(gl: WebGL2RenderingContext, mode: BlendMode): void {
  switch (mode) {
    case 'add':
      gl.blendFunc(gl.ONE, gl.ONE);
      break;
    case 'screen':
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_COLOR);
      break;
    case 'multiply':
      // Ergebnis = Quelle × Ziel + Ziel × (1 − Quell-Alpha)
      gl.blendFunc(gl.DST_COLOR, gl.ONE_MINUS_SRC_ALPHA);
      break;
    default:
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
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

function createProgram(gl: WebGL2RenderingContext, frag: string, uniforms: string[]): Program {
  const p = gl.createProgram()!;
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, VERT));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, frag));
  gl.bindAttribLocation(p, 0, 'aPos');
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'Linkfehler');
  const u: Record<string, WebGLUniformLocation | null> = {};
  for (const name of uniforms) u[name] = gl.getUniformLocation(p, name);
  return { program: p, pos: 0, u };
}
