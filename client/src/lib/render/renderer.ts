// WebGL2-Renderer: zeichnet den Ebenenstapel mit exakter Homographie pro Pixel.
//
// Für jeden Bildschirmpixel rechnet der Fragment-Shader mit der inversen Abbildung
// zurück in die Inhaltskoordinate (u,v). Damit ist die Perspektive in jedem Pixel korrekt
// – es gibt keine Knickkante entlang der Diagonalen wie bei zwei affinen Dreiecken.
// Verzerrungsgitter (Mesh) werden als feines Dreiecksnetz mit uv je Eckpunkt gezeichnet.
// Gearbeitet wird mit vormultipliziertem Alpha auf schwarzem Hintergrund.
//
// Effekte (shared/effects.ts) sind eigene Shader-Programme, die bei Bedarf kompiliert werden.
// Effekte mit Rückkopplung zeichnen zuerst in einen eigenen Puffer (Ping-Pong) und werden
// dann wie ein Bild auf die Fläche gelegt.

import { EFFECT_LIB, EFFECT_MAP, type EffectDef } from '../../../../shared/effects.js';
import { invert, squareToQuad, type Mat3 } from '../../../../shared/homography.js';
import { triangleMatrix } from '../../../../shared/mesh.js';
import type { AudioFrame, BlendMode, EffectParams, MaskMode, Quad, Shape } from '../../../../shared/types.js';

const VERT = `#version 300 es
in vec2 aPos; // normierte Ausgabekoordinaten, (0,0) oben links
in vec2 aUv;  // nur beim Mesh: Inhaltskoordinate des Eckpunkts
out vec2 vPos;
out vec2 vUv;
void main() {
  vPos = aPos;
  vUv = aUv;
  gl_Position = vec4(aPos.x * 2.0 - 1.0, 1.0 - aPos.y * 2.0, 0.0, 1.0);
}`;

/** Für Rückkopplungspuffer: ohne y-Spiegelung, damit Schreiben und Lesen dieselbe Ausrichtung haben */
const VERT_FBO = `#version 300 es
in vec2 aPos;
out vec2 vPos;
void main() {
  vPos = aPos;
  gl_Position = vec4(aPos * 2.0 - 1.0, 0.0, 1.0);
}`;

/** Uniforms, die jeder Effekt nutzen darf (müssen vor EFFECT_LIB stehen) */
const EFFECT_UNIFORMS = `
uniform float uTime;
uniform float uAspect;    // Seitenverhältnis der Fläche in Pixeln
uniform float uSeed;
uniform vec4 uAudio;      // Pegel, Bass, Mitten, Höhen (0…1)
uniform float uBeat;      // springt beim Beat auf 1 und fällt ab
uniform float uBeatCount;
uniform float uBpm;
uniform sampler2D uAudioTex; // Zeile 0 Spektrum, 1 Spitzen, 2 Wellenform
`;

function paramUniforms(effect?: EffectDef): string {
  return (effect?.params ?? []).map((p) => `uniform ${p.type === 'color' ? 'vec3' : 'float'} p_${p.id};`).join('\n');
}

/** Gemeinsamer Flächen-Shader; mit Effekt zusätzlich mit dessen Funktion */
function surfaceFrag(effect?: EffectDef): string {
  return `#version 300 es
precision highp float;
in vec2 vPos;
in vec2 vUv;
uniform mat3 uInv;        // Ausgaberaum → Inhalt (u,v)
uniform bool uMesh;       // uv kommt aus dem Dreiecksnetz statt aus uInv
uniform int uShape;       // 0 Viereck · 1 Kreis · 2 Dreieck
uniform sampler2D uTex;
uniform sampler2D uMask;  // Flächenmasken im (u,v)-Raum, Alpha = Sichtbarkeit
uniform bool uHasMask;
uniform int uSource;      // 0 Textur · 1 Farbe · 2 Effekt · 3 nichts (nur Raster)
uniform vec4 uColor;      // vormultipliziert
uniform vec2 uFitScale;   // Einpassung: Texturkoordinate = (uv - 0.5) * uFitScale + 0.5
uniform float uOpacity;
uniform bool uGridOn;
uniform vec4 uGrid;       // Spalten, Zeilen, Linienstärke in Pixeln, Diagonalen (0/1)
uniform vec3 uGridColor;
out vec4 outColor;
${EFFECT_UNIFORMS}
${effect ? `${paramUniforms(effect)}\n${EFFECT_LIB}\n${effect.glsl}` : ''}

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
  vec2 uv;
  if (uMesh) {
    uv = vUv;
  } else {
    vec3 q = uInv * vec3(vPos, 1.0);
    if (q.z <= 0.0) discard;           // Punkt liegt „hinter“ der Ebene
    uv = q.xy / q.z;
  }
  // 1-px-Kantenglättung über die Ableitung von uv – je nach Form
  vec2 fw = max(fwidth(uv), vec2(1e-6));
  float a;
  if (uShape == 1) {
    float d = length(uv - 0.5);
    a = clamp((0.5 - d) / max(fwidth(d), 1e-6) + 0.5, 0.0, 1.0);
  } else if (uShape == 2) {
    float e = uv.y - abs(uv.x - 0.5) * 2.0;    // > 0 innerhalb der Schrägen
    float ea = clamp(e / max(fwidth(e), 1e-6) + 0.5, 0.0, 1.0);
    a = ea * clamp((1.0 - uv.y) / fw.y + 0.5, 0.0, 1.0);
  } else {
    vec2 edge = clamp(uv / fw + 0.5, 0.0, 1.0) * clamp((1.0 - uv) / fw + 0.5, 0.0, 1.0);
    a = edge.x * edge.y;
  }
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

/** Rückkopplungs-Effekt: zeichnet ein Bild in den Puffer; prev(uv) liest das vorige */
function feedbackFrag(effect: EffectDef): string {
  return `#version 300 es
precision highp float;
in vec2 vPos;
uniform sampler2D uPrev;
out vec4 outColor;
${EFFECT_UNIFORMS}
vec4 prev(vec2 uv) { return texture(uPrev, uv); }
${paramUniforms(effect)}
${EFFECT_LIB}
${effect.glsl}
void main() {
  vec4 e = clamp(effect(vPos), 0.0, 1.0);
  outColor = vec4(e.rgb * e.a, e.a);
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
  /** Schlüssel für Rückkopplungspuffer und Mesh-Puffer */
  key: string;
  shape: Shape;
  corners: Quad;
  /** Dreiecksnetz (nur Mesh): Positionen und uv */
  mesh: { pos: Float32Array; uv: Float32Array; version: string } | null;
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

interface Feedback {
  fbo: [WebGLFramebuffer, WebGLFramebuffer];
  tex: [WebGLTexture, WebGLTexture];
  w: number;
  h: number;
  /** Index des zuletzt geschriebenen Puffers */
  cur: 0 | 1;
  frame: number;
}

export class Renderer {
  readonly gl: WebGL2RenderingContext;
  private programs = new Map<string, Program | null>();
  private fbPrograms = new Map<string, Program | null>();
  private maskPass: Program;
  private buffer: WebGLBuffer;
  private meshBuffers = new Map<string, { version: string; pos: WebGLBuffer; uv: WebGLBuffer; count: number }>();
  private feedback = new Map<string, Feedback>();
  private verts = new Float32Array(12);
  private white: WebGLTexture;
  private audioTex: WebGLTexture;
  private audioData = new Uint8Array(128 * 3);
  private audio: AudioFrame | null = null;
  private start = performance.now();
  private frameNo = 0;
  private floatFbo: boolean;

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
    // Halbfließkomma-Puffer: Nachleuchten klingt sauber aus (8 Bit hinterlassen „Geister“)
    this.floatFbo = !!gl.getExtension('EXT_color_buffer_float');
    this.maskPass = createProgram(gl, VERT, MASK_FRAG);
    this.buffer = gl.createBuffer()!;
    this.white = this.createTexture([255, 255, 255, 255]);
    this.audioTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.audioTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.uploadAudioTexture();
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

  /** Neue Audio-Analyse für dieses Bild (null = Stille) */
  setAudio(frame: AudioFrame | null): void {
    this.audio = frame;
    this.uploadAudioTexture();
  }

  private uploadAudioTexture(): void {
    const gl = this.gl;
    const d = this.audioData;
    const f = this.audio;
    d.fill(0);
    for (let i = 0; i < 64; i++) {
      d[i] = Math.round((f?.spectrum[i] ?? 0) * 255);
      d[128 + i] = Math.round((f?.peaks[i] ?? 0) * 255);
    }
    for (let i = 0; i < 128; i++) d[256 + i] = Math.round((((f?.wave[i] ?? 0) + 1) / 2) * 255);
    gl.bindTexture(gl.TEXTURE_2D, this.audioTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 128, 3, 0, gl.RED, gl.UNSIGNED_BYTE, d);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
  }

  /** Programm für einen Effekt (oder das Standardprogramm); null, wenn der Shader nicht kompiliert. */
  private program(effectId: string | null): Program | null {
    const key = effectId ?? '';
    if (this.programs.has(key)) return this.programs.get(key)!;
    let p: Program | null = null;
    try {
      const def = effectId ? EFFECT_MAP.get(effectId) : undefined;
      if (effectId && !def) throw new Error(`Unbekannter Effekt ${effectId}`);
      p = createProgram(this.gl, VERT, surfaceFrag(def));
    } catch (err) {
      console.error(`Shader für ${effectId ?? 'Flächen'} fehlerhaft:`, err);
    }
    this.programs.set(key, p);
    return p;
  }

  private feedbackProgram(def: EffectDef): Program | null {
    if (this.fbPrograms.has(def.id)) return this.fbPrograms.get(def.id)!;
    let p: Program | null = null;
    try {
      p = createProgram(this.gl, VERT_FBO, feedbackFrag(def));
    } catch (err) {
      console.error(`Rückkopplungs-Shader ${def.id} fehlerhaft:`, err);
    }
    this.fbPrograms.set(def.id, p);
    return p;
  }

  /** Allgemeine Effekt-Uniforms (Zeit, Musik, Parameter) setzen */
  private setEffectUniforms(p: Program, item: SurfaceItem, time: number): void {
    const gl = this.gl;
    const u = (name: string) => p.u.get(name) ?? null;
    const a = this.audio;
    gl.uniform1f(u('uTime'), time);
    gl.uniform1f(u('uAspect'), item.aspect);
    gl.uniform1f(u('uSeed'), item.seed);
    gl.uniform4f(u('uAudio'), a?.level ?? 0, a?.bass ?? 0, a?.mid ?? 0, a?.high ?? 0);
    gl.uniform1f(u('uBeat'), a?.beat ?? 0);
    gl.uniform1f(u('uBeatCount'), a?.beatCount ?? 0);
    gl.uniform1f(u('uBpm'), a?.bpm ?? 0);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.audioTex);
    gl.uniform1i(u('uAudioTex'), 2);
    if (item.effect && item.params) {
      const def = EFFECT_MAP.get(item.effect);
      for (const prm of def?.params ?? []) {
        const loc = u(`p_${prm.id}`);
        if (!loc) continue;
        const v = item.params[prm.id] ?? prm.default;
        if (prm.type === 'color') gl.uniform3f(loc, ...hexToRgb(String(v)));
        else gl.uniform1f(loc, Number(v));
      }
    }
  }

  /**
   * Rückkopplungs-Effekt einen Schritt weiterrechnen und die Textur mit dem neuen Bild liefern.
   * Pro Bild und Fläche nur einmal (bei Überblendungen wird die Fläche zweimal gezeichnet).
   */
  private stepFeedback(item: SurfaceItem, def: EffectDef, time: number): WebGLTexture | null {
    const gl = this.gl;
    const prog = this.feedbackProgram(def);
    if (!prog) return null;
    const key = `${item.key}:${def.id}`;
    // Puffergröße an das Seitenverhältnis der Fläche anpassen (lange Seite 768 px)
    const w = Math.round(item.aspect >= 1 ? 768 : 768 * item.aspect);
    const h = Math.round(item.aspect >= 1 ? 768 / item.aspect : 768);
    let fb = this.feedback.get(key);
    if (fb && (Math.abs(fb.w - w) > 32 || Math.abs(fb.h - h) > 32)) {
      this.deleteFeedback(key);
      fb = undefined;
    }
    if (!fb) {
      fb = this.createFeedback(Math.max(16, w), Math.max(16, h));
      this.feedback.set(key, fb);
    }
    if (fb.frame === this.frameNo) return fb.tex[fb.cur];
    fb.frame = this.frameNo;

    const next: 0 | 1 = fb.cur === 0 ? 1 : 0;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb.fbo[next]);
    gl.viewport(0, 0, fb.w, fb.h);
    gl.disable(gl.BLEND);
    gl.useProgram(prog.program);
    this.setRect(0, 0, 1, 1);
    this.bindAttribs(false);
    this.setEffectUniforms(prog, item, time);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, fb.tex[fb.cur]);
    gl.uniform1i(prog.u.get('uPrev') ?? null, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.enable(gl.BLEND);
    fb.cur = next;
    return fb.tex[next];
  }

  private createFeedback(w: number, h: number): Feedback {
    const gl = this.gl;
    const make = (): [WebGLFramebuffer, WebGLTexture] => {
      const tex = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      if (this.floatFbo) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
      else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      const fbo = gl.createFramebuffer()!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      return [fbo, tex];
    };
    const a = make();
    const b = make();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { fbo: [a[0], b[0]], tex: [a[1], b[1]], w, h, cur: 0, frame: -1 };
  }

  private deleteFeedback(key: string): void {
    const fb = this.feedback.get(key);
    if (!fb) return;
    fb.fbo.forEach((f) => this.gl.deleteFramebuffer(f));
    fb.tex.forEach((t) => this.gl.deleteTexture(t));
    this.feedback.delete(key);
  }

  /** Puffer von Flächen freigeben, die keinen Rückkopplungs-Effekt mehr zeigen */
  retainFeedback(keys: Set<string>): void {
    for (const k of [...this.feedback.keys()]) if (!keys.has(k)) this.deleteFeedback(k);
    for (const k of [...this.meshBuffers.keys()]) if (!keys.has(k)) this.dropMesh(k);
  }

  private dropMesh(key: string): void {
    const m = this.meshBuffers.get(key);
    if (!m) return;
    this.gl.deleteBuffer(m.pos);
    this.gl.deleteBuffer(m.uv);
    this.meshBuffers.delete(key);
  }

  /**
   * Zeichnet den Stapel. master: Gesamthelligkeit 0…1 (0 = Blackout).
   */
  draw(items: DrawItem[], master = 1): void {
    const gl = this.gl;
    this.frameNo++;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (items.length === 0 || master <= 0) return;

    gl.enable(gl.BLEND);
    const time = (performance.now() - this.start) / 1000;

    for (const item of items) {
      if (item.kind === 'mask') {
        const mp = this.maskPass;
        gl.useProgram(mp.program);
        this.setRect(0, 0, 1, 1);
        this.bindAttribs(false);
        // Ziel × (1 − Maske) beim Ausschneiden, sonst Ziel × Maske
        if (item.mode === 'subtract') gl.blendFunc(gl.ZERO, gl.ONE_MINUS_SRC_ALPHA);
        else gl.blendFunc(gl.ZERO, gl.SRC_ALPHA);
        gl.uniform1i(mp.u.get('uMask')!, 0);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, item.texture);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        continue;
      }
      this.drawSurface(item, time);
    }

    // Gesamthelligkeit: Ziel × master
    if (master < 1) {
      gl.useProgram(this.maskPass.program);
      this.setRect(0, 0, 1, 1);
      this.bindAttribs(false);
      gl.blendColor(0, 0, 0, master);
      gl.blendFunc(gl.ZERO, gl.CONSTANT_ALPHA);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
  }

  private drawSurface(item: SurfaceItem, time: number): void {
    const gl = this.gl;
    let source = item.source;
    let texture = item.texture;
    let effectId = source === 'effect' ? item.effect : null;
    // Rückkopplungs-Effekte: erst in den Puffer, dann wie ein Bild auftragen
    const def = effectId ? EFFECT_MAP.get(effectId) : undefined;
    if (def?.feedback) {
      texture = this.stepFeedback(item, def, time);
      if (!texture) return;
      source = 'texture';
      effectId = null;
    }

    const sp = this.program(effectId);
    if (!sp) return;
    const isMesh = item.shape === 'mesh' && item.mesh;
    let inv: Mat3 | null = null;
    if (!isMesh) {
      inv = item.shape === 'triangle' ? invert(triangleMatrix(item.corners)) : surfaceInverse(item.corners);
      if (!inv) return;
    }

    gl.useProgram(sp.program);
    let count = 6;
    if (isMesh) {
      count = this.bindMesh(item);
    } else {
      // Begrenzungsrechteck der Fläche zeichnen; der Shader verwirft alles außerhalb
      const pts = item.shape === 'triangle' ? item.corners.slice(0, 3) : item.corners;
      const xs = pts.map((p) => p.x);
      const ys = pts.map((p) => p.y);
      const x0 = Math.max(0, Math.min(...xs));
      const x1 = Math.min(1, Math.max(...xs));
      const y0 = Math.max(0, Math.min(...ys));
      const y1 = Math.min(1, Math.max(...ys));
      if (x1 <= x0 || y1 <= y0) return;
      this.setRect(x0, y0, x1, y1);
      this.bindAttribs(false);
    }

    setBlend(gl, item.blend);
    const u = (name: string) => sp.u.get(name) ?? null;
    gl.uniform1i(u('uMesh'), isMesh ? 1 : 0);
    gl.uniform1i(u('uShape'), item.shape === 'circle' ? 1 : item.shape === 'triangle' ? 2 : 0);
    if (inv) gl.uniformMatrix3fv(u('uInv'), true, inv); // row-major → transpose
    gl.uniform1f(u('uOpacity'), item.opacity);
    // Rückkopplungspuffer liegen „richtig herum“ – Einpassung gilt dort nicht
    gl.uniform2f(u('uFitScale'), def?.feedback ? 1 : item.fitScale[0], def?.feedback ? 1 : item.fitScale[1]);
    gl.uniform1i(u('uSource'), { texture: 0, color: 1, effect: 2, none: 3 }[source]);
    gl.uniform4f(u('uColor'), item.color[0], item.color[1], item.color[2], 1);
    gl.uniform1i(u('uHasMask'), item.mask ? 1 : 0);
    gl.uniform1i(u('uTex'), 0);
    gl.uniform1i(u('uMask'), 1);
    if (item.grid) {
      gl.uniform1i(u('uGridOn'), 1);
      gl.uniform4f(u('uGrid'), item.grid.cols, item.grid.rows, item.grid.thickness, item.grid.diagonals ? 1 : 0);
      gl.uniform3f(u('uGridColor'), ...item.grid.color);
    } else {
      gl.uniform1i(u('uGridOn'), 0);
    }
    if (source === 'effect') this.setEffectUniforms(sp, item, time);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, item.mask ?? this.white);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture ?? this.white);
    gl.drawArrays(gl.TRIANGLES, 0, count);
  }

  /** Dreiecksnetz eines Meshs binden (Puffer werden nur bei Änderung neu geladen) */
  private bindMesh(item: SurfaceItem): number {
    const gl = this.gl;
    const m = item.mesh!;
    let buf = this.meshBuffers.get(item.key);
    if (!buf || buf.version !== m.version) {
      if (buf) this.dropMesh(item.key);
      const pos = gl.createBuffer()!;
      const uv = gl.createBuffer()!;
      gl.bindBuffer(gl.ARRAY_BUFFER, pos);
      gl.bufferData(gl.ARRAY_BUFFER, m.pos, gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, uv);
      gl.bufferData(gl.ARRAY_BUFFER, m.uv, gl.DYNAMIC_DRAW);
      buf = { version: m.version, pos, uv, count: m.pos.length / 2 };
      this.meshBuffers.set(item.key, buf);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, buf.pos);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf.uv);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);
    return buf.count;
  }

  /** Position aus dem Rechteck-Puffer; uv-Attribut aus (konstant 0) */
  private bindAttribs(withUv: boolean): void {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    if (!withUv) {
      gl.disableVertexAttribArray(1);
      gl.vertexAttrib2f(1, 0, 0);
    }
  }

  private setRect(x0: number, y0: number, x1: number, y1: number): void {
    this.verts.set([x0, y0, x1, y0, x0, y1, x0, y1, x1, y0, x1, y1]);
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.buffer);
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

function createProgram(gl: WebGL2RenderingContext, vert: string, frag: string): Program {
  const p = gl.createProgram()!;
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vert));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, frag));
  gl.bindAttribLocation(p, 0, 'aPos');
  gl.bindAttribLocation(p, 1, 'aUv');
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
