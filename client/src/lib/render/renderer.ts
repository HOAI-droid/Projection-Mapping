// WebGL2-Renderer: zeichnet den Ebenenstapel mit exakter Homographie pro Pixel.
//
// Für jeden Bildschirmpixel rechnet der Fragment-Shader mit der inversen Homographie
// zurück in die Inhaltskoordinate (u,v). Damit ist die Perspektive in jedem Pixel korrekt
// – es gibt keine Knickkante entlang der Diagonalen wie bei zwei affinen Dreiecken.
// Gearbeitet wird mit vormultipliziertem Alpha auf schwarzem Hintergrund.
//
// Effekte (shared/effects.ts) werden als eigene Shader-Programme bei Bedarf kompiliert.

import { EFFECT_LIB, EFFECT_MAP, type EffectDef } from '../../../../shared/effects.js';
import { invert, squareToQuad, type Mat3 } from '../../../../shared/homography.js';
import type { BlendMode, EffectParams, MaskMode, Quad } from '../../../../shared/types.js';

const VERT = `#version 300 es
in vec2 aPos; // normierte Ausgabekoordinaten, (0,0) oben links
out vec2 vPos;
void main() {
  vPos = aPos;
  gl_Position = vec4(aPos.x * 2.0 - 1.0, 1.0 - aPos.y * 2.0, 0.0, 1.0);
}`;

/** Gemeinsamer Flächen-Shader; mit EFFECT-Definition zusätzlich mit Effektfunktion */
function surfaceFrag(effect?: EffectDef): string {
  const uniforms = (effect?.params ?? [])
    .map((p) => `uniform ${p.type === 'color' ? 'vec3' : 'float'} p_${p.id};`)
    .join('\n');
  return `#version 300 es
precision highp float;
in vec2 vPos;
uniform mat3 uInv;        // Ausgaberaum → Inhalt (u,v)
uniform sampler2D uTex;
uniform sampler2D uMask;  // Flächenmasken im (u,v)-Raum, Alpha = Sichtbarkeit
uniform bool uHasMask;
uniform int uSource;      // 0 Textur · 1 Farbe · 2 Effekt · 3 nichts (nur Raster)
uniform vec4 uColor;      // vormultipliziert
uniform vec2 uFitScale;   // Einpassung: Texturkoordinate = (uv - 0.5) * uFitScale + 0.5
uniform float uOpacity;
uniform float uTime;
uniform float uAspect;    // Seitenverhältnis der Fläche in Pixeln
uniform float uSeed;
uniform bool uGridOn;
uniform vec4 uGrid;       // Spalten, Zeilen, Linienstärke in Pixeln, Diagonalen (0/1)
uniform vec3 uGridColor;
out vec4 outColor;
${effect ? `${uniforms}\n${EFFECT_LIB}\n${effect.glsl}` : ''}

// Rasterlinie mit konstanter Breite in Bildschirmpixeln – auch bei starker Verzerrung sichtbar
float gridLine(vec2 uv) {
  vec2 g = uv * uGrid.xy;
  vec2 fw = max(fwidth(g), vec2(1e-6));
  vec2 d = abs(fract(g + 0.5) - 0.5) / fw;
  float line = min(d.x, d.y);
  if (uGrid.w > 0.5) {
    float d1 = abs(uv.x - uv.y) / max(fwidth(uv.x - uv.y), 1e-6);
    float d2 = abs(uv.x + uv.y - 1.0) / max(fwidth(uv.x + uv.y), 1e-6);
    line = min(line, min(d1, d2));
  }
  return 1.0 - clamp(line - uGrid.z * 0.5 + 0.5, 0.0, 1.0);
}

void main() {
  vec3 q = uInv * vec3(vPos, 1.0);
  if (q.z <= 0.0) discard;             // Punkt liegt „hinter“ der Ebene
  vec2 uv = q.xy / q.z;
  // 1-px-Kantenglättung über die Ableitung von uv
  vec2 fw = max(fwidth(uv), vec2(1e-6));
  vec2 edge = clamp(uv / fw + 0.5, 0.0, 1.0) * clamp((1.0 - uv) / fw + 0.5, 0.0, 1.0);
  float a = edge.x * edge.y;
  if (uHasMask) a *= texture(uMask, clamp(uv, 0.0, 1.0)).a;
  if (a <= 0.0) discard;
  vec2 cuv = clamp(uv, 0.0, 1.0);
  vec4 c = vec4(0.0);
  if (uSource == 0) {
    vec2 t = (uv - 0.5) * uFitScale + 0.5;
    // Beim Einpassen bleibt der Rand außerhalb des Bildes leer
    vec2 inside = step(vec2(0.0), t) * step(t, vec2(1.0));
    c = texture(uTex, clamp(t, 0.0, 1.0)) * inside.x * inside.y;
  } else if (uSource == 1) {
    c = uColor;
  }
${effect ? '  else if (uSource == 2) { vec4 e = clamp(effect(cuv), 0.0, 1.0); c = vec4(e.rgb * e.a, e.a); }' : ''}
  c *= uOpacity;
  if (uGridOn) c = mix(c, vec4(uGridColor, 1.0), gridLine(uv));
  outColor = c * a;
}`;
}

/** Masken-Ebene: verrechnet das bisher gezeichnete Bild mit der Maske */
const MASK_FRAG = `#version 300 es
precision highp float;
in vec2 vPos;
uniform sampler2D uMask;
out vec4 outColor;
void main() {
  float m = texture(uMask, vPos).a;
  outColor = vec4(m);
}`;

export interface SurfaceItem {
  kind: 'surface';
  corners: Quad;
  source: 'texture' | 'color' | 'effect' | 'none';
  texture: WebGLTexture | null;
  color: [number, number, number];
  effect: string | null;
  params: EffectParams | null;
  opacity: number;
  blend: BlendMode;
  fitScale: [number, number];
  mask: WebGLTexture | null;
  aspect: number;
  seed: number;
  grid: { cols: number; rows: number; thickness: number; color: [number, number, number]; diagonals: boolean } | null;
}

export interface MaskItem {
  kind: 'mask';
  texture: WebGLTexture;
  /** subtract: Inneres ausschneiden · sonst: nur Inneres behalten */
  mode: MaskMode;
}

export type DrawItem = SurfaceItem | MaskItem;

interface Program {
  program: WebGLProgram;
  u: Map<string, WebGLUniformLocation | null>;
}

export class Renderer {
  readonly gl: WebGL2RenderingContext;
  private programs = new Map<string, Program | null>();
  private maskPass: Program;
  private buffer: WebGLBuffer;
  private verts = new Float32Array(12);
  private white: WebGLTexture;
  private start = performance.now();

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
    this.maskPass = createProgram(gl, MASK_FRAG);
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
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, opts.premultiply ?? true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    if (opts.mipmap) {
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    }
  }

  deleteTexture(tex: WebGLTexture): void {
    this.gl.deleteTexture(tex);
  }

  /** Programm für einen Effekt (oder das Standardprogramm); null, wenn der Shader nicht kompiliert. */
  private program(effectId: string | null): Program | null {
    const key = effectId ?? '';
    if (this.programs.has(key)) return this.programs.get(key)!;
    let p: Program | null = null;
    try {
      const def = effectId ? EFFECT_MAP.get(effectId) : undefined;
      if (effectId && !def) throw new Error(`Unbekannter Effekt ${effectId}`);
      p = createProgram(this.gl, surfaceFrag(def));
    } catch (err) {
      console.error(`Shader für ${effectId ?? 'Flächen'} fehlerhaft:`, err);
    }
    this.programs.set(key, p);
    return p;
  }

  draw(items: DrawItem[]): void {
    const gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (items.length === 0) return;

    gl.enable(gl.BLEND);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const time = (performance.now() - this.start) / 1000;

    for (const item of items) {
      if (item.kind === 'mask') {
        const mp = this.maskPass;
        gl.useProgram(mp.program);
        this.setRect(0, 0, 1, 1);
        // Ziel × (1 − Maske) beim Ausschneiden, sonst Ziel × Maske
        if (item.mode === 'subtract') gl.blendFunc(gl.ZERO, gl.ONE_MINUS_SRC_ALPHA);
        else gl.blendFunc(gl.ZERO, gl.SRC_ALPHA);
        gl.uniform1i(mp.u.get('uMask')!, 0);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, item.texture);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        continue;
      }

      const sp = this.program(item.source === 'effect' ? item.effect : null);
      if (!sp) continue;
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

      gl.useProgram(sp.program);
      this.setRect(x0, y0, x1, y1);
      setBlend(gl, item.blend);
      const u = (name: string) => sp.u.get(name) ?? null;
      gl.uniformMatrix3fv(u('uInv'), true, inv); // row-major → transpose
      gl.uniform1f(u('uOpacity'), item.opacity);
      gl.uniform2f(u('uFitScale'), item.fitScale[0], item.fitScale[1]);
      gl.uniform1i(u('uSource'), { texture: 0, color: 1, effect: 2, none: 3 }[item.source]);
      gl.uniform4f(u('uColor'), item.color[0], item.color[1], item.color[2], 1);
      gl.uniform1i(u('uHasMask'), item.mask ? 1 : 0);
      gl.uniform1f(u('uTime'), time);
      gl.uniform1f(u('uAspect'), item.aspect);
      gl.uniform1f(u('uSeed'), item.seed);
      gl.uniform1i(u('uTex'), 0);
      gl.uniform1i(u('uMask'), 1);
      if (item.grid) {
        gl.uniform1i(u('uGridOn'), 1);
        gl.uniform4f(u('uGrid'), item.grid.cols, item.grid.rows, item.grid.thickness, item.grid.diagonals ? 1 : 0);
        gl.uniform3f(u('uGridColor'), ...item.grid.color);
      } else {
        gl.uniform1i(u('uGridOn'), 0);
      }
      if (item.source === 'effect' && item.effect && item.params) {
        const def = EFFECT_MAP.get(item.effect);
        for (const p of def?.params ?? []) {
          const loc = u(`p_${p.id}`);
          const v = item.params[p.id] ?? p.default;
          if (p.type === 'color') gl.uniform3f(loc, ...hexToRgb(String(v)));
          else gl.uniform1f(loc, Number(v));
        }
      }
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, item.mask ?? this.white);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, item.texture ?? this.white);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
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

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16) || 0;
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
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

function createProgram(gl: WebGL2RenderingContext, frag: string): Program {
  const p = gl.createProgram()!;
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, VERT));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, frag));
  gl.bindAttribLocation(p, 0, 'aPos');
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'Linkfehler');
  const u = new Map<string, WebGLUniformLocation | null>();
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS) as number;
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(p, i);
    if (info) u.set(info.name, gl.getUniformLocation(p, info.name));
  }
  return { program: p, u };
}
