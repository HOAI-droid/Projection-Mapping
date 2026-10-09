// Effekt-Bibliothek: generative Inhalte als GLSL-Fragment-Shader (ähnlich den
// „Materials“ in MadMapper). Ein Effekt ist eine Funktion
//
//   vec4 effect(vec2 uv)   // uv: 0…1 auf der Fläche, (0,0) oben links → Farbe + Alpha
//
// Zur Verfügung stehen: uTime (Sekunden), uAspect (Breite/Höhe der Fläche in Pixeln),
// uSeed (0…1, pro Fläche verschieden), die Hilfsfunktionen aus EFFECT_LIB und je
// Parameter eine Uniform p_<id> (float; Farben als vec3; Auswahl als float-Index).
//
// Musik: uAudio = (Pegel, Bass, Mitten, Höhen), uBeat (Puls 1 → 0), uBeatCount, uBpm,
// spectrum(x), peakAt(x) und waveAt(x) für x = 0…1 (Frequenz bzw. Zeit).
//
// Rückkopplung (feedback: true): Der Effekt zeichnet in einen eigenen Puffer und kann mit
// prev(uv) das vorige Bild lesen – so entstehen die typischen Milkdrop-Schlieren und Tunnel.
//
// Neuen Effekt ergänzen: Eintrag in EFFECTS anlegen – Regler in der Steuerung,
// Prüfung auf dem Server und Shader-Aufbau entstehen automatisch.

export type EffectParam =
  | { id: string; label: string; type: 'float'; min: number; max: number; step: number; default: number; unit?: string }
  | { id: string; label: string; type: 'color'; default: string }
  | { id: string; label: string; type: 'select'; options: string[]; default: number };

export type EffectCategory =
  | 'Musik'
  | 'Licht'
  | 'Disco & Party'
  | 'Kontur'
  | 'Natur'
  | 'Muster'
  | 'Farbe'
  | 'Digital'
  | 'Architektur';

export interface EffectDef {
  id: string;
  name: string;
  category: EffectCategory;
  icon: string;
  description: string;
  /** Hinweis, der in der Steuerung angezeigt wird (z. B. Fotosensibilität) */
  warning?: string;
  /** reagiert von sich aus auf Musik */
  audio?: boolean;
  /** nutzt prev(uv): das vorige Bild (Milkdrop-artige Rückkopplung) */
  feedback?: boolean;
  params: EffectParam[];
  glsl: string;
}

export const EFFECT_CATEGORIES: EffectCategory[] = [
  'Musik',
  'Licht',
  'Disco & Party',
  'Kontur',
  'Natur',
  'Muster',
  'Farbe',
  'Digital',
  'Architektur',
];

const STROBE_WARNING =
  'Achtung: Blitzlicht kann bei fotosensiblen Menschen epileptische Anfälle auslösen. Frequenz ist auf 12 Hz begrenzt.';

const speed = (def = 1, max = 4): EffectParam => ({
  id: 'speed',
  label: 'Tempo',
  type: 'float',
  min: 0,
  max,
  step: 0.01,
  default: def,
});

/** Hilfsfunktionen, die jedem Effekt-Shader vorangestellt werden */
export const EFFECT_LIB = /* glsl */ `
#define PI 3.14159265359
#define TAU 6.28318530718
float hash11(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
float hash21(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 hash22(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x), mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.02 + 17.0; a *= 0.5; } return v; }
vec3 hsv2rgb(vec3 c) { vec3 p = abs(fract(c.xxx + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0); return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y); }
mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
// Position entlang des Umfangs (0…1, im Uhrzeigersinn ab oben links) und Abstand zum Rand
// – beides in Einheiten der Flächenhöhe, damit Linien überall gleich dick sind.
vec2 perimeter(vec2 uv) {
  float A = uAspect;
  float dT = uv.y, dR = (1.0 - uv.x) * A, dB = 1.0 - uv.y, dL = uv.x * A;
  float d = min(min(dT, dR), min(dB, dL));
  float s;
  if (d == dT) s = uv.x * A;
  else if (d == dR) s = A + uv.y;
  else if (d == dB) s = A + 1.0 + (1.0 - uv.x) * A;
  else s = 2.0 * A + 1.0 + (1.0 - uv.y);
  return vec2(s / (2.0 * A + 2.0), d);
}
// Bildpunkt mit gleichem Maßstab in x und y (Höhe = 1)
vec2 aspectUv(vec2 uv) { return vec2(uv.x * uAspect, uv.y); }
// Musik: 64 Frequenzbänder (x = 0 tief … 1 hoch), fallende Spitzen und Wellenform (−1…1)
float spectrum(float x) { return texture(uAudioTex, vec2((clamp(x, 0.0, 1.0) * 63.0 + 0.5) / 128.0, 0.5 / 3.0)).r; }
float peakAt(float x) { return texture(uAudioTex, vec2((clamp(x, 0.0, 1.0) * 63.0 + 0.5) / 128.0, 1.5 / 3.0)).r; }
float waveAt(float x) { return texture(uAudioTex, vec2((clamp(x, 0.0, 1.0) * 127.0 + 0.5) / 128.0, 2.5 / 3.0)).r * 2.0 - 1.0; }
`;

const SYNC: EffectParam = { id: 'sync', label: 'Takt', type: 'select', options: ['Frequenz', 'Beat der Musik'], default: 0 };

export const EFFECTS: EffectDef[] = [
  // ----------------------------------------------------------------- Musik
  {
    id: 'spectrum',
    name: 'Spektrum-Analyzer',
    category: 'Musik',
    icon: '📶',
    audio: true,
    description: 'Der klassische Winamp-Analyzer: Frequenzbalken mit fallenden Spitzen.',
    params: [
      { id: 'bars', label: 'Balken', type: 'float', min: 8, max: 64, step: 1, default: 32 },
      { id: 'gap', label: 'Abstand', type: 'float', min: 0, max: 0.7, step: 0.01, default: 0.2 },
      { id: 'style', label: 'Farben', type: 'select', options: ['Winamp', 'Regenbogen', 'Einfarbig'], default: 0 },
      { id: 'peaks', label: 'Spitzen', type: 'select', options: ['an', 'aus'], default: 0 },
      { id: 'layout', label: 'Anordnung', type: 'select', options: ['unten', 'gespiegelt', 'oben'], default: 0 },
      { id: 'color', label: 'Farbe', type: 'color', default: '#22d3ee' },
    ],
    glsl: `vec4 effect(vec2 uv) {
  float x = uv.x * p_bars;
  float id = floor(x), fx = fract(x);
  float inBar = step(p_gap * 0.5, fx) * step(fx, 1.0 - p_gap * 0.5);
  float xs = (id + 0.5) / p_bars;
  float v = spectrum(xs), pk = peakAt(xs);
  float y = 1.0 - uv.y;
  if (p_layout > 1.5) y = uv.y;
  else if (p_layout > 0.5) y = abs(uv.y - 0.5) * 2.0;
  float bar = step(y, v) * inBar;
  if (p_style < 0.5) bar *= step(0.22, fract(y * 28.0)); // LED-Segmente
  float cap = inBar * step(abs(y - pk - 0.012), 0.008) * step(p_peaks, 0.5) * step(0.02, pk);
  vec3 c;
  if (p_style < 0.5) c = mix(vec3(0.15, 0.85, 0.1), mix(vec3(0.95, 0.85, 0.1), vec3(0.95, 0.15, 0.1), smoothstep(0.65, 0.95, y)), smoothstep(0.3, 0.7, y));
  else if (p_style < 1.5) c = hsv2rgb(vec3(xs * 0.85 + uTime * 0.05, 0.9, 1.0));
  else c = p_color;
  return vec4(mix(c, vec3(1.0), cap), max(bar, cap));
}`,
  },
  {
    id: 'scope',
    name: 'Oszilloskop',
    category: 'Musik',
    icon: '〽',
    audio: true,
    description: 'Die Wellenform der Musik als leuchtende Linie – gerade, gespiegelt oder als Kreis.',
    params: [
      { id: 'mode', label: 'Form', type: 'select', options: ['Linie', 'Doppelt', 'Kreis'], default: 0 },
      { id: 'amp', label: 'Ausschlag', type: 'float', min: 0.2, max: 3, step: 0.01, default: 1 },
      { id: 'width', label: 'Linienbreite', type: 'float', min: 0.002, max: 0.05, step: 0.001, default: 0.008 },
      { id: 'glow', label: 'Leuchten', type: 'float', min: 0, max: 0.15, step: 0.001, default: 0.04 },
      { id: 'color', label: 'Farbe', type: 'color', default: '#4ade80' },
      { id: 'rainbow', label: 'Bunt', type: 'float', min: 0, max: 1, step: 0.01, default: 0 },
    ],
    glsl: `vec4 effect(vec2 uv) {
  float d;
  float hueX = uv.x;
  if (p_mode > 1.5) {
    vec2 c = aspectUv(uv) - vec2(uAspect * 0.5, 0.5);
    float a = atan(c.y, c.x) / TAU + 0.5;
    float r = 0.28 + waveAt(a) * 0.12 * p_amp + uAudio.y * 0.04;
    d = abs(length(c) - r);
    hueX = a;
  } else {
    float w = waveAt(uv.x) * 0.35 * p_amp;
    d = abs(uv.y - (0.5 - w));
    if (p_mode > 0.5) d = min(abs(uv.y - (0.3 - w * 0.6)), abs(uv.y - (0.7 + w * 0.6)));
  }
  float core = 1.0 - smoothstep(p_width * 0.5, p_width, d);
  float halo = exp(-max(d - p_width, 0.0) / max(p_glow, 1e-3) * 2.5) * step(1e-4, p_glow) * 0.7;
  vec3 c = mix(p_color, hsv2rgb(vec3(hueX + uTime * 0.1, 0.85, 1.0)), p_rainbow);
  return vec4(mix(c, vec3(1.0), core * 0.4), clamp(core + halo, 0.0, 1.0) * (0.5 + 0.5 * uAudio.x + 0.3));
}`,
  },
  {
    id: 'radial',
    name: 'Kreis-Spektrum',
    category: 'Musik',
    icon: '🌀',
    audio: true,
    description: 'Frequenzbalken strahlen kreisförmig aus einer pulsierenden Mitte.',
    params: [
      { id: 'bars', label: 'Balken', type: 'float', min: 16, max: 128, step: 1, default: 72 },
      { id: 'inner', label: 'Innenradius', type: 'float', min: 0.05, max: 0.4, step: 0.01, default: 0.17 },
      { id: 'length', label: 'Länge', type: 'float', min: 0.05, max: 0.6, step: 0.01, default: 0.28 },
      speed(0.3, 2),
      { id: 'color', label: 'Farbe', type: 'color', default: '#a78bfa' },
      { id: 'rainbow', label: 'Bunt', type: 'float', min: 0, max: 1, step: 0.01, default: 0.8 },
    ],
    glsl: `vec4 effect(vec2 uv) {
  vec2 p = aspectUv(uv) - vec2(uAspect * 0.5, 0.5);
  float r = length(p);
  float a = fract(atan(p.y, p.x) / TAU + 0.5 + uTime * p_speed * 0.05);
  float id = floor(a * p_bars);
  float xs = abs((id + 0.5) / p_bars * 2.0 - 1.0);
  float v = spectrum(xs);
  float inner = p_inner * (1.0 + uAudio.y * 0.25);
  float bar = step(inner, r) * step(r, inner + 0.005 + v * p_length) * step(0.2, fract(a * p_bars));
  float ring = smoothstep(0.006, 0.0, abs(r - inner));
  float core = smoothstep(inner, inner * 0.2, r) * uBeat * 0.7;
  vec3 c = mix(p_color, hsv2rgb(vec3(xs * 0.7 + uTime * 0.05, 0.85, 1.0)), p_rainbow);
  return vec4(c, clamp(bar + ring + core, 0.0, 1.0));
}`,
  },
  {
    id: 'milktunnel',
    name: 'Milkdrop: Wellentunnel',
    category: 'Musik',
    icon: '🌌',
    audio: true,
    feedback: true,
    description: 'Die Wellenform zieht farbige Schlieren in einen drehenden Tunnel – wie in Winamps Milkdrop.',
    params: [
      { id: 'zoom', label: 'Sog', type: 'float', min: 0, max: 1, step: 0.01, default: 0.5 },
      { id: 'spin', label: 'Drehung', type: 'float', min: -1, max: 1, step: 0.01, default: 0.3 },
      { id: 'decay', label: 'Nachleuchten', type: 'float', min: 0.8, max: 0.995, step: 0.001, default: 0.96 },
      { id: 'amp', label: 'Ausschlag', type: 'float', min: 0.2, max: 3, step: 0.01, default: 1 },
      { id: 'react', label: 'Reaktion', type: 'float', min: 0, max: 2, step: 0.01, default: 1 },
    ],
    glsl: `vec4 effect(vec2 uv) {
  vec2 c = uv - 0.5;
  c.x *= uAspect;
  float zoom = 1.0 - 0.04 * p_zoom - uAudio.y * 0.035 * p_react;
  float ang = 0.012 * p_spin + uAudio.z * 0.02 * p_react * sign(p_spin + 1e-4);
  vec2 q = rot(ang) * c * zoom;
  q.x /= uAspect;
  vec3 col = prev(q + 0.5).rgb * p_decay;
  float y = 0.5 + waveAt(uv.x) * 0.22 * p_amp;
  float line = smoothstep(0.01, 0.0, abs(uv.y - y));
  vec3 wc = hsv2rgb(vec3(uTime * 0.07 + uv.x * 0.4, 0.8, 1.0));
  col = max(col - 0.003, 0.0) + wc * line * (0.5 + uAudio.x + uBeat * 0.5);
  return vec4(col, 1.0);
}`,
  },
  {
    id: 'milkswirl',
    name: 'Milkdrop: Farbwirbel',
    category: 'Musik',
    icon: '🍥',
    audio: true,
    feedback: true,
    description: 'Wirbelnde Farbströme, die bei jedem Bass-Schlag neue Farbe bekommen.',
    params: [
      { id: 'swirl', label: 'Wirbel', type: 'float', min: -2, max: 2, step: 0.01, default: 1 },
      { id: 'warp', label: 'Verwirbelung', type: 'float', min: 0, max: 3, step: 0.01, default: 1 },
      { id: 'decay', label: 'Nachleuchten', type: 'float', min: 0.8, max: 0.995, step: 0.001, default: 0.975 },
      { id: 'react', label: 'Reaktion', type: 'float', min: 0, max: 2, step: 0.01, default: 1 },
    ],
    glsl: `vec4 effect(vec2 uv) {
  vec2 c = uv - 0.5;
  c.x *= uAspect;
  float r = length(c);
  float a = 0.03 * p_swirl * (1.0 - min(r, 1.0)) + uAudio.y * 0.02 * p_react;
  vec2 q = rot(a) * c * (0.988 - uBeat * 0.025 * p_react);
  q.x /= uAspect;
  q += (vec2(noise(uv * 4.0 + uTime * 0.3), noise(uv * 4.0 - uTime * 0.3 + 7.0)) - 0.5) * 0.006 * p_warp;
  vec3 col = prev(q + 0.5).rgb * p_decay;
  vec2 src = 0.18 * vec2(sin(uTime * 0.7), cos(uTime * 0.9)) * vec2(uAspect, 1.0);
  float blob = smoothstep(0.06 + uAudio.y * 0.1, 0.0, length(c - src));
  col += hsv2rgb(vec3(uTime * 0.05 + uBeatCount * 0.08, 0.9, 1.0)) * blob * (0.25 + uBeat * p_react);
  return vec4(max(col - 0.002, 0.0), 1.0);
}`,
  },
  {
    id: 'beatrings',
    name: 'Beat-Ringe',
    category: 'Musik',
    icon: '⭕',
    audio: true,
    feedback: true,
    description: 'Jeder Beat schickt einen farbigen Ring nach außen.',
    params: [
      speed(1, 3),
      { id: 'decay', label: 'Nachleuchten', type: 'float', min: 0.8, max: 0.99, step: 0.001, default: 0.95 },
      { id: 'width', label: 'Ringbreite', type: 'float', min: 0.003, max: 0.05, step: 0.001, default: 0.012 },
    ],
    glsl: `vec4 effect(vec2 uv) {
  vec2 c = uv - 0.5;
  c.x *= uAspect;
  vec2 q = c * (1.0 - 0.02 * p_speed);
  q.x /= uAspect;
  vec3 col = prev(q + 0.5).rgb * p_decay;
  float r = length(c);
  float ring = smoothstep(p_width, 0.0, abs(r - 0.06)) * smoothstep(0.35, 0.9, uBeat);
  col += hsv2rgb(vec3(uBeatCount * 0.13, 0.85, 1.0)) * ring * 1.5;
  col += hsv2rgb(vec3(uBeatCount * 0.13 + 0.5, 0.6, 1.0)) * smoothstep(0.05, 0.0, r) * uAudio.y * 0.4;
  return vec4(max(col - 0.002, 0.0), 1.0);
}`,
  },
  {
    id: 'waterfall',
    name: 'Spektrum-Wasserfall',
    category: 'Musik',
    icon: '🎚',
    audio: true,
    feedback: true,
    description: 'Das Spektrum läuft als leuchtende Landschaft nach unten.',
    params: [
      speed(1, 4),
      { id: 'palette', label: 'Farben', type: 'select', options: ['Glut', 'Eis', 'Regenbogen'], default: 0 },
    ],
    glsl: `vec4 effect(vec2 uv) {
  float rowH = 0.004 * max(p_speed, 0.05);
  if (uv.y > rowH) return vec4(prev(uv - vec2(0.0, rowH)).rgb * 0.995, 1.0);
  float v = spectrum(uv.x);
  vec3 c;
  if (p_palette < 0.5) c = vec3(v * 1.5, v * v * 1.2, v * v * v * 0.8);
  else if (p_palette < 1.5) c = vec3(v * v * 0.6, v * 1.1, v * 1.6);
  else c = hsv2rgb(vec3(0.7 - v * 0.7, 0.9, v * 1.3));
  return vec4(c, 1.0);
}`,
  },
  {
    id: 'laser',
    name: 'Laser-Show',
    category: 'Musik',
    icon: '🔺',
    audio: true,
    description: 'Fächer aus Laserstrahlen, die zur Musik schwenken und auf den Beat aufblitzen.',
    params: [
      { id: 'count', label: 'Strahlen', type: 'float', min: 1, max: 12, step: 1, default: 7 },
      { id: 'spread', label: 'Fächer', type: 'float', min: 0.1, max: 3, step: 0.01, default: 1.6 },
      speed(1, 4),
      { id: 'width', label: 'Breite', type: 'float', min: 0.001, max: 0.03, step: 0.001, default: 0.004 },
      { id: 'color', label: 'Farbe', type: 'color', default: '#22ff55' },
      { id: 'rainbow', label: 'Bunt', type: 'float', min: 0, max: 1, step: 0.01, default: 0.3 },
    ],
    glsl: `vec4 effect(vec2 uv) {
  vec2 p = vec2((uv.x - 0.5) * uAspect, 1.0 - uv.y + 0.02);
  vec3 acc = vec3(0.0);
  for (int i = 0; i < 12; i++) {
    float fi = float(i);
    if (fi >= p_count) break;
    float base = p_count > 1.0 ? fi / (p_count - 1.0) - 0.5 : 0.0;
    float ang = base * p_spread + sin(uTime * p_speed * 0.8 + fi * 0.7) * (0.15 + uAudio.z * 0.5);
    vec2 dir = vec2(sin(ang), cos(ang));
    float d = abs(dot(p, vec2(dir.y, -dir.x)));
    float beam = smoothstep(p_width * 3.0, 0.0, d) * step(0.0, dot(p, dir));
    vec3 c = mix(p_color, hsv2rgb(vec3(fi / p_count + uBeatCount * 0.1, 0.9, 1.0)), p_rainbow);
    acc += c * (beam + smoothstep(p_width, 0.0, d) * step(0.0, dot(p, dir)));
  }
  acc *= 0.35 + 0.5 * uAudio.x + uBeat * 0.8;
  float a = clamp(max(acc.r, max(acc.g, acc.b)), 0.0, 1.0);
  return vec4(acc / max(a, 1e-4), a);
}`,
  },
  {
    id: 'basspulse',
    name: 'Bass-Puls',
    category: 'Musik',
    icon: '🔊',
    audio: true,
    description: 'Die ganze Fläche leuchtet mit dem Bass und blitzt beim Beat – perfekt für Objekte.',
    params: [
      { id: 'color', label: 'Farbe', type: 'color', default: '#ff2a6d' },
      { id: 'min', label: 'Grundhelligkeit', type: 'float', min: 0, max: 0.6, step: 0.01, default: 0.05 },
      { id: 'curve', label: 'Härte', type: 'float', min: 0.5, max: 4, step: 0.01, default: 1.5 },
      { id: 'flash', label: 'Beat-Blitz', type: 'float', min: 0, max: 1, step: 0.01, default: 0.5 },
      { id: 'cycle', label: 'Farbwechsel auf Beat', type: 'float', min: 0, max: 1, step: 0.01, default: 0 },
    ],
    glsl: `vec4 effect(vec2 uv) {
  float a = mix(p_min, 1.0, pow(uAudio.y, p_curve)) + uBeat * p_flash;
  vec3 c = mix(p_color, hsv2rgb(vec3(hash11(uBeatCount * 3.1), 0.85, 1.0)), p_cycle);
  return vec4(mix(c, vec3(1.0), uBeat * p_flash * 0.5), clamp(a, 0.0, 1.0));
}`,
  },
  {
    id: 'meters',
    name: 'Pegel-Balken',
    category: 'Musik',
    icon: '🎛',
    audio: true,
    description: 'Vier LED-Balken für Pegel, Bass, Mitten und Höhen.',
    params: [
      { id: 'dir', label: 'Richtung', type: 'select', options: ['senkrecht', 'waagerecht'], default: 0 },
      { id: 'segments', label: 'Segmente', type: 'float', min: 4, max: 40, step: 1, default: 16 },
    ],
    glsl: `vec4 effect(vec2 uv) {
  vec2 p = p_dir > 0.5 ? vec2(uv.y, uv.x) : vec2(uv.x, 1.0 - uv.y);
  float id = floor(p.x * 4.0);
  float fx = fract(p.x * 4.0);
  float v = id < 0.5 ? uAudio.x : id < 1.5 ? uAudio.y : id < 2.5 ? uAudio.z : uAudio.w;
  float seg = floor(p.y * p_segments) / p_segments;
  float on = step(seg, v - 0.001) * step(0.1, fx) * step(fx, 0.9) * step(0.15, fract(p.y * p_segments));
  vec3 c = mix(vec3(0.15, 0.9, 0.2), mix(vec3(1.0, 0.85, 0.1), vec3(1.0, 0.15, 0.1), step(0.85, seg)), step(0.6, seg));
  return vec4(c, mix(0.08, 1.0, on) * step(0.1, fx) * step(fx, 0.9) * step(0.15, fract(p.y * p_segments)));
}`,
  },

  // ---------------------------------------------------------------- Licht
  {
    id: 'strobe',
    name: 'Stroboskop',
    category: 'Licht',
    icon: '⚡',
    description: 'Harte Lichtblitze in einstellbarer Frequenz.',
    warning: STROBE_WARNING,
    params: [
      { id: 'freq', label: 'Frequenz', type: 'float', min: 0.5, max: 12, step: 0.1, default: 4, unit: 'Hz' },
      { id: 'duty', label: 'Blitzlänge', type: 'float', min: 0.05, max: 0.6, step: 0.01, default: 0.15 },
      { id: 'color', label: 'Farbe', type: 'color', default: '#ffffff' },
      SYNC,
    ],
    glsl: `vec4 effect(vec2 uv) {
  float on = step(fract(uTime * p_freq), p_duty);
  // Beat-Modus: Blitz bei jedem Schlag, Länge über „Blitzlänge“
  if (p_sync > 0.5) on = step(pow(0.86, 1.0 + p_duty * 25.0), uBeat);
  return vec4(p_color, on);
}`,
  },
  {
    id: 'pulse',
    name: 'Pulsieren',
    category: 'Licht',
    icon: '💗',
    description: 'Weiches Ein- und Ausblenden im Takt (BPM).',
    params: [
      { id: 'bpm', label: 'Takt', type: 'float', min: 10, max: 200, step: 1, default: 60, unit: 'BPM' },
      { id: 'min', label: 'Minimum', type: 'float', min: 0, max: 1, step: 0.01, default: 0.05 },
      { id: 'sharp', label: 'Härte', type: 'float', min: 0, max: 1, step: 0.01, default: 0.3 },
      { id: 'color', label: 'Farbe', type: 'color', default: '#ff2a6d' },
      SYNC,
    ],
    glsl: `vec4 effect(vec2 uv) {
  float ph = fract(uTime * p_bpm / 60.0);
  float w = 0.5 + 0.5 * cos(ph * TAU);
  w = pow(w, 1.0 + p_sharp * 8.0);
  if (p_sync > 0.5) w = pow(uBeat, 0.5 + p_sharp * 3.0);
  return vec4(p_color, mix(p_min, 1.0, w));
}`,
  },
  {
    id: 'beams',
    name: 'Lichtkegel',
    category: 'Licht',
    icon: '🔦',
    description: 'Schwenkende Scheinwerfer-Strahlen wie Moving Heads.',
    params: [
      { id: 'count', label: 'Anzahl', type: 'float', min: 1, max: 8, step: 1, default: 3 },
      speed(0.6, 3),
      { id: 'width', label: 'Breite', type: 'float', min: 0.02, max: 0.5, step: 0.01, default: 0.12 },
      { id: 'swing', label: 'Schwenk', type: 'float', min: 0, max: 1.4, step: 0.01, default: 0.7 },
      { id: 'color', label: 'Farbe', type: 'color', default: '#e0f2ff' },
      { id: 'rainbow', label: 'Bunt', type: 'float', min: 0, max: 1, step: 0.01, default: 0 },
    ],
    glsl: `vec4 effect(vec2 uv) {
  vec2 p = vec2((uv.x - 0.5) * uAspect, 1.0 - uv.y);
  vec3 acc = vec3(0.0);
  for (int i = 0; i < 8; i++) {
    float fi = float(i);
    if (fi >= p_count) break;
    float bx = ((fi + 0.5) / p_count - 0.5) * uAspect;
    vec2 d = p - vec2(bx, -0.05);
    float ang = atan(d.x, d.y);
    float target = p_swing * sin(uTime * p_speed * (0.8 + 0.23 * fi) + fi * 1.7);
    float beam = smoothstep(p_width, p_width * 0.25, abs(ang - target));
    beam *= smoothstep(1.8, 0.1, length(d));
    vec3 c = mix(p_color, hsv2rgb(vec3(fi / p_count + uTime * 0.05, 0.85, 1.0)), p_rainbow);
    acc += c * beam;
  }
  float a = clamp(max(acc.r, max(acc.g, acc.b)), 0.0, 1.0);
  return vec4(acc / max(a, 1e-4), a);
}`,
  },
  {
    id: 'sweep',
    name: 'Lichtwelle',
    category: 'Licht',
    icon: '🌊',
    description: 'Ein heller Lichtstreifen wandert über die Fläche.',
    params: [
      speed(0.5, 3),
      { id: 'angle', label: 'Richtung', type: 'float', min: 0, max: 360, step: 1, default: 0, unit: '°' },
      { id: 'width', label: 'Breite', type: 'float', min: 0.02, max: 0.8, step: 0.01, default: 0.15 },
      { id: 'color', label: 'Farbe', type: 'color', default: '#ffffff' },
    ],
    glsl: `vec4 effect(vec2 uv) {
  vec2 dir = vec2(cos(radians(p_angle)), sin(radians(p_angle)));
  float x = dot(uv - 0.5, dir) + 0.5;
  float pos = fract(uTime * p_speed * 0.5) * (1.0 + 2.0 * p_width) - p_width;
  float a = smoothstep(p_width, 0.0, abs(x - pos));
  return vec4(p_color, a);
}`,
  },

  // ---------------------------------------------------------- Disco & Party
  {
    id: 'colorstrobe',
    name: 'Farb-Strobe',
    category: 'Disco & Party',
    icon: '🌈',
    description: 'Blitze in zufälligen, kräftigen Farben.',
    warning: STROBE_WARNING,
    params: [
      { id: 'freq', label: 'Frequenz', type: 'float', min: 0.5, max: 12, step: 0.1, default: 3, unit: 'Hz' },
      { id: 'duty', label: 'Blitzlänge', type: 'float', min: 0.05, max: 1, step: 0.01, default: 0.5 },
      { id: 'sat', label: 'Sättigung', type: 'float', min: 0, max: 1, step: 0.01, default: 1 },
      SYNC,
    ],
    glsl: `vec4 effect(vec2 uv) {
  float k = floor(uTime * p_freq);
  float on = step(fract(uTime * p_freq), p_duty);
  // Beat-Modus: neue Farbe bei jedem Schlag
  if (p_sync > 0.5) { k = uBeatCount; on = step(pow(0.86, 1.0 + p_duty * 25.0), uBeat); }
  vec3 c = hsv2rgb(vec3(hash11(k * 1.73 + uSeed * 91.0), p_sat, 1.0));
  return vec4(c, on);
}`,
  },
  {
    id: 'discoball',
    name: 'Discokugel',
    category: 'Disco & Party',
    icon: '🪩',
    description: 'Wandernde, funkelnde Lichtpunkte wie von einer Spiegelkugel.',
    params: [
      { id: 'density', label: 'Dichte', type: 'float', min: 4, max: 60, step: 1, default: 22 },
      speed(0.5, 3),
      { id: 'size', label: 'Punktgröße', type: 'float', min: 0.1, max: 1, step: 0.01, default: 0.45 },
      { id: 'color', label: 'Farbe', type: 'color', default: '#ffffff' },
      { id: 'rainbow', label: 'Bunt', type: 'float', min: 0, max: 1, step: 0.01, default: 0.3 },
    ],
    glsl: `vec4 effect(vec2 uv) {
  vec2 q = rot(0.35) * aspectUv(uv) * p_density * 0.25;
  q.x += uTime * p_speed;
  vec2 id = floor(q), f = fract(q) - 0.5;
  float h = hash21(id + uSeed * 13.0);
  vec2 off = (hash22(id) - 0.5) * 0.5;
  float r = p_size * (0.12 + 0.2 * h);
  float dotv = smoothstep(r, r * 0.35, length(f - off));
  float tw = 0.4 + 0.6 * sin(uTime * (2.0 + h * 5.0) + h * TAU) * 0.5 + 0.3;
  vec3 c = mix(p_color, hsv2rgb(vec3(h + uTime * 0.07, 0.75, 1.0)), p_rainbow);
  return vec4(c, clamp(dotv * tw * step(0.3, h), 0.0, 1.0));
}`,
  },
  {
    id: 'spots',
    name: 'Disco-Spots',
    category: 'Disco & Party',
    icon: '🎆',
    description: 'Bunte, umherwandernde Scheinwerferkegel.',
    params: [
      { id: 'count', label: 'Anzahl', type: 'float', min: 1, max: 8, step: 1, default: 4 },
      speed(0.7, 3),
      { id: 'size', label: 'Größe', type: 'float', min: 0.05, max: 0.8, step: 0.01, default: 0.25 },
      { id: 'soft', label: 'Weichheit', type: 'float', min: 0, max: 1, step: 0.01, default: 0.5 },
    ],
    glsl: `vec4 effect(vec2 uv) {
  vec2 p = aspectUv(uv);
  vec3 acc = vec3(0.0);
  for (int i = 0; i < 8; i++) {
    float fi = float(i);
    if (fi >= p_count) break;
    vec2 c = vec2(0.5 * uAspect + 0.45 * uAspect * sin(uTime * p_speed * (0.7 + 0.13 * fi) + fi * 2.1),
                  0.5 + 0.45 * cos(uTime * p_speed * (0.9 + 0.11 * fi) + fi * 1.3));
    float s = smoothstep(p_size, p_size * (1.0 - p_soft * 0.95), length(p - c));
    acc += hsv2rgb(vec3(fi / p_count + uTime * 0.05, 0.9, 1.0)) * s;
  }
  float a = clamp(max(acc.r, max(acc.g, acc.b)), 0.0, 1.0);
  return vec4(acc / max(a, 1e-4), a);
}`,
  },
  {
    id: 'equalizer',
    name: 'Equalizer',
    category: 'Disco & Party',
    icon: '📊',
    description: 'Hüpfende Balken wie bei einer Musikanlage.',
    params: [
      { id: 'bars', label: 'Balken', type: 'float', min: 3, max: 48, step: 1, default: 16 },
      speed(1, 4),
      { id: 'gap', label: 'Abstand', type: 'float', min: 0, max: 0.8, step: 0.01, default: 0.2 },
      { id: 'rainbow', label: 'Bunt', type: 'float', min: 0, max: 1, step: 0.01, default: 1 },
      { id: 'color', label: 'Farbe', type: 'color', default: '#22d3ee' },
    ],
    glsl: `vec4 effect(vec2 uv) {
  float x = uv.x * p_bars;
  float id = floor(x);
  float inBar = step(p_gap * 0.5, fract(x)) * step(fract(x), 1.0 - p_gap * 0.5);
  float t = uTime * p_speed;
  float h = 0.15 + 0.85 * abs(sin(t * (1.3 + hash11(id) * 2.0) + id * 0.7)) * (0.5 + 0.5 * noise(vec2(id, t)));
  float y = 1.0 - uv.y;
  float on = step(y, h) * inBar;
  // Segmente wie bei LED-Anzeigen
  on *= step(0.25, fract(y * 24.0));
  vec3 c = mix(p_color, hsv2rgb(vec3(0.33 - y * 0.33, 1.0, 1.0)), p_rainbow);
  return vec4(c, on);
}`,
  },
  {
    id: 'confetti',
    name: 'Konfetti',
    category: 'Disco & Party',
    icon: '🎉',
    description: 'Bunte Schnipsel rieseln herab.',
    params: [
      { id: 'density', label: 'Dichte', type: 'float', min: 4, max: 40, step: 1, default: 14 },
      speed(0.6, 3),
      { id: 'size', label: 'Größe', type: 'float', min: 0.1, max: 1, step: 0.01, default: 0.4 },
    ],
    glsl: `vec4 effect(vec2 uv) {
  vec2 p = aspectUv(uv) * p_density;
  vec4 col = vec4(0.0);
  for (int layer = 0; layer < 3; layer++) {
    float fl = float(layer);
    vec2 q = p * (1.0 + fl * 0.35);
    float colId = floor(q.x);
    q.y -= uTime * p_speed * (2.0 + hash11(colId + fl * 7.0) * 2.0);
    vec2 id = floor(q), f = fract(q) - 0.5;
    float h = hash21(id + fl * 31.0);
    if (h < 0.55) continue;
    f = rot(uTime * (h - 0.5) * 8.0 + h * 6.0) * (f - (hash22(id) - 0.5) * 0.4);
    float s = p_size * 0.35;
    float r = step(abs(f.x), s) * step(abs(f.y), s * 0.45);
    if (r > 0.0) col = vec4(hsv2rgb(vec3(h * 7.0, 0.85, 1.0)), 1.0);
  }
  return col;
}`,
  },

  // ---------------------------------------------------------------- Kontur
  {
    id: 'edgechase',
    name: 'Kantenlauf',
    category: 'Kontur',
    icon: '🔲',
    description: 'Licht fährt die Umrisslinie der Fläche entlang – der klassische Mapping-Effekt.',
    params: [
      { id: 'color', label: 'Farbe', type: 'color', default: '#22d3ee' },
      speed(0.5, 3),
      { id: 'count', label: 'Anzahl', type: 'float', min: 1, max: 8, step: 1, default: 1 },
      { id: 'length', label: 'Schweiflänge', type: 'float', min: 0.02, max: 0.9, step: 0.01, default: 0.25 },
      { id: 'width', label: 'Linienbreite', type: 'float', min: 0.005, max: 0.2, step: 0.001, default: 0.025 },
      { id: 'glow', label: 'Leuchten', type: 'float', min: 0, max: 0.2, step: 0.001, default: 0.03 },
      { id: 'base', label: 'Grundlinie', type: 'float', min: 0, max: 1, step: 0.01, default: 0.08 },
    ],
    glsl: `vec4 effect(vec2 uv) {
  vec2 pd = perimeter(uv);
  float head = fract(uTime * p_speed * 0.25);
  float b = fract((head - pd.x) * p_count);
  float trail = 1.0 - smoothstep(0.0, min(0.999, p_length), b);
  trail = pow(trail, 1.5);
  float line = 1.0 - smoothstep(p_width, p_width + p_glow + 0.002, pd.y);
  return vec4(p_color, clamp(max(trail, p_base) * line, 0.0, 1.0));
}`,
  },
  {
    id: 'marquee',
    name: 'Lauflicht',
    category: 'Kontur',
    icon: '💡',
    description: 'Glühbirnen entlang des Randes, die im Kreis laufen – wie an einem Kinoschild.',
    params: [
      { id: 'bulbs', label: 'Birnen', type: 'float', min: 8, max: 160, step: 1, default: 48 },
      speed(1, 4),
      { id: 'size', label: 'Größe', type: 'float', min: 0.005, max: 0.08, step: 0.001, default: 0.022 },
      { id: 'pattern', label: 'Muster', type: 'select', options: ['jede 3.', 'jede 2.', 'Welle', 'Zufall'], default: 0 },
      { id: 'color', label: 'Farbe', type: 'color', default: '#ffd27a' },
    ],
    glsl: `vec4 effect(vec2 uv) {
  vec2 pd = perimeter(uv);
  float N = p_bulbs;
  float seg = (2.0 * uAspect + 2.0) / N;
  float x = pd.x * N;
  float id = floor(x);
  vec2 local = vec2((fract(x) - 0.5) * seg, pd.y - p_size * 1.4);
  float bulb = smoothstep(p_size, p_size * 0.5, length(local));
  float t = uTime * p_speed * 4.0;
  float on;
  if (p_pattern < 0.5) on = mod(id + floor(t), 3.0) < 1.0 ? 1.0 : 0.12;
  else if (p_pattern < 1.5) on = mod(id + floor(t), 2.0) < 1.0 ? 1.0 : 0.12;
  else if (p_pattern < 2.5) on = 0.15 + 0.85 * pow(0.5 + 0.5 * sin(id * 0.5 - t), 3.0);
  else on = step(0.5, hash11(id + floor(t) * 13.0)) * 0.88 + 0.12;
  return vec4(p_color, bulb * on);
}`,
  },
  {
    id: 'outline',
    name: 'Neon-Rahmen',
    category: 'Kontur',
    icon: '🟪',
    description: 'Leuchtender Neonrahmen mit Farbwechsel und Flackern.',
    params: [
      { id: 'color', label: 'Farbe', type: 'color', default: '#ff2bd6' },
      { id: 'width', label: 'Linienbreite', type: 'float', min: 0.003, max: 0.15, step: 0.001, default: 0.02 },
      { id: 'glow', label: 'Leuchten', type: 'float', min: 0, max: 0.3, step: 0.001, default: 0.06 },
      { id: 'cycle', label: 'Farbwechsel', type: 'float', min: 0, max: 1, step: 0.01, default: 0 },
      { id: 'flicker', label: 'Flackern', type: 'float', min: 0, max: 1, step: 0.01, default: 0.1 },
    ],
    glsl: `vec4 effect(vec2 uv) {
  float d = perimeter(uv).y;
  float core = 1.0 - smoothstep(p_width * 0.6, p_width, d);
  float halo = exp(-max(d - p_width, 0.0) / max(p_glow, 1e-3) * 2.0) * 0.6 * step(0.0001, p_glow);
  float fl = 1.0 - p_flicker * step(0.92, noise(vec2(uTime * 18.0, uSeed * 10.0)));
  vec3 c = mix(p_color, hsv2rgb(vec3(uTime * 0.1 + perimeter(uv).x, 0.9, 1.0)), p_cycle);
  return vec4(mix(c, vec3(1.0), core * 0.35), clamp((core + halo) * fl, 0.0, 1.0));
}`,
  },

  // ----------------------------------------------------------------- Natur
  {
    id: 'fire',
    name: 'Feuer',
    category: 'Natur',
    icon: '🔥',
    description: 'Lodernde Flammen, die von unten aufsteigen.',
    params: [
      speed(1, 3),
      { id: 'height', label: 'Höhe', type: 'float', min: 0.2, max: 1.5, step: 0.01, default: 0.75 },
      { id: 'intensity', label: 'Stärke', type: 'float', min: 0.2, max: 2, step: 0.01, default: 1 },
      { id: 'scale', label: 'Größe', type: 'float', min: 0.5, max: 4, step: 0.01, default: 1.5 },
      { id: 'tint', label: 'Farbton', type: 'select', options: ['Orange', 'Blau', 'Grün', 'Lila'], default: 0 },
    ],
    glsl: `vec4 effect(vec2 uv) {
  vec2 p = vec2(uv.x * uAspect, 1.0 - uv.y);
  float t = uTime * p_speed;
  vec2 q = p * p_scale * 2.0;
  float n = fbm(vec2(q.x * 1.4, q.y - t * 1.6) + uSeed * 10.0);
  float n2 = fbm(vec2(q.x * 3.0 + 5.0, q.y * 2.0 - t * 2.8));
  float f = n * 0.7 + n2 * 0.4;
  float h = p.y / p_height;
  float flame = clamp(f * 1.7 - h * 1.25 + 0.15, 0.0, 1.0);
  flame = pow(flame, 1.4) * p_intensity;
  vec3 c1 = vec3(0.75, 0.05, 0.0), c2 = vec3(1.0, 0.5, 0.05), c3 = vec3(1.0, 0.95, 0.65);
  if (p_tint > 2.5) { c1 = vec3(0.3, 0.0, 0.6); c2 = vec3(0.7, 0.2, 1.0); c3 = vec3(1.0, 0.8, 1.0); }
  else if (p_tint > 1.5) { c1 = vec3(0.0, 0.35, 0.05); c2 = vec3(0.2, 0.9, 0.2); c3 = vec3(0.85, 1.0, 0.7); }
  else if (p_tint > 0.5) { c1 = vec3(0.0, 0.05, 0.6); c2 = vec3(0.1, 0.5, 1.0); c3 = vec3(0.8, 0.95, 1.0); }
  vec3 col = mix(c1, c2, smoothstep(0.15, 0.55, flame));
  col = mix(col, c3, smoothstep(0.6, 1.0, flame));
  return vec4(col, clamp(smoothstep(0.02, 0.35, flame), 0.0, 1.0));
}`,
  },
  {
    id: 'water',
    name: 'Wasser',
    category: 'Natur',
    icon: '💧',
    description: 'Lichtspiel wie am Grund eines Schwimmbads (Kaustik).',
    params: [
      speed(0.5, 3),
      { id: 'scale', label: 'Größe', type: 'float', min: 0.3, max: 6, step: 0.01, default: 1 },
      { id: 'color', label: 'Farbe', type: 'color', default: '#2bb3ff' },
      { id: 'bright', label: 'Helligkeit', type: 'float', min: 0.2, max: 2, step: 0.01, default: 1 },
    ],
    glsl: `vec4 effect(vec2 uv) {
  // Klassische „Tileable Water Caustic“-Formel; der große Versatz (−250) ist Teil des Musters
  vec2 p = mod(aspectUv(uv) * p_scale * TAU, TAU) - 250.0;
  float t = uTime * p_speed + 23.0;
  vec2 i = p;
  float c = 1.0;
  float inten = 0.005;
  for (int n = 0; n < 5; n++) {
    float tt = t * (1.0 - (3.5 / float(n + 1)));
    i = p + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
    c += 1.0 / length(vec2(p.x / (sin(i.x + tt) / inten), p.y / (cos(i.y + tt) / inten)));
  }
  c /= 5.0;
  c = 1.17 - pow(c, 1.4);
  float v = pow(abs(c), 8.0);
  vec3 col = clamp(p_color * 0.45 + vec3(v), 0.0, 1.0) * p_bright;
  return vec4(col, 1.0);
}`,
  },
  {
    id: 'smoke',
    name: 'Nebel',
    category: 'Natur',
    icon: '🌫',
    description: 'Wabernde Nebelschwaden.',
    params: [
      speed(0.3, 2),
      { id: 'scale', label: 'Größe', type: 'float', min: 0.5, max: 6, step: 0.01, default: 2 },
      { id: 'density', label: 'Dichte', type: 'float', min: 0, max: 1.5, step: 0.01, default: 0.8 },
      { id: 'color', label: 'Farbe', type: 'color', default: '#9db4ff' },
    ],
    glsl: `vec4 effect(vec2 uv) {
  vec2 p = aspectUv(uv) * p_scale;
  float t = uTime * p_speed;
  vec2 q = vec2(fbm(p + vec2(0.0, t)), fbm(p + vec2(5.2, -t * 0.7)));
  float f = fbm(p + 2.0 * q + vec2(t * 0.3, 0.0));
  float a = clamp((f - 0.35) * 2.0 * p_density, 0.0, 1.0);
  return vec4(p_color, a);
}`,
  },
  {
    id: 'stars',
    name: 'Sternenhimmel',
    category: 'Natur',
    icon: '✨',
    description: 'Funkelnde Sterne, optional mit Sternschnuppen.',
    params: [
      { id: 'density', label: 'Dichte', type: 'float', min: 5, max: 80, step: 1, default: 30 },
      { id: 'twinkle', label: 'Funkeln', type: 'float', min: 0, max: 1, step: 0.01, default: 0.7 },
      { id: 'shooting', label: 'Sternschnuppen', type: 'float', min: 0, max: 1, step: 0.01, default: 0.4 },
      { id: 'color', label: 'Farbe', type: 'color', default: '#ffffff' },
    ],
    glsl: `vec4 effect(vec2 uv) {
  vec2 p = aspectUv(uv) * p_density;
  vec2 id = floor(p), f = fract(p) - 0.5;
  float h = hash21(id + uSeed * 7.0);
  vec2 off = (hash22(id) - 0.5) * 0.7;
  float size = 0.04 + 0.08 * h * h;
  float star = smoothstep(size, 0.0, length(f - off)) * step(0.55, h);
  star *= mix(1.0, 0.5 + 0.5 * sin(uTime * (1.0 + h * 5.0) + h * 40.0), p_twinkle);
  // Sternschnuppe: alle paar Sekunden eine helle Linie
  float k = floor(uTime * 0.4);
  float ph = fract(uTime * 0.4);
  vec2 a = vec2(hash11(k) * uAspect, hash11(k + 3.0) * 0.5);
  vec2 dir = normalize(vec2(1.0, 0.45));
  vec2 head = a + dir * ph * 1.2;
  vec2 d = aspectUv(uv) - head;
  float along = dot(d, -dir);
  float across = abs(dot(d, vec2(-dir.y, dir.x)));
  float tail = smoothstep(0.004, 0.0, across) * smoothstep(0.3, 0.0, along) * step(0.0, along);
  float shoot = tail * step(ph, 0.35) * step(1.0 - p_shooting, hash11(k + 9.0));
  return vec4(p_color, clamp(star + shoot, 0.0, 1.0));
}`,
  },
  {
    id: 'rain',
    name: 'Regen',
    category: 'Natur',
    icon: '🌧',
    description: 'Fallende Regenstreifen.',
    params: [
      { id: 'density', label: 'Dichte', type: 'float', min: 10, max: 120, step: 1, default: 50 },
      speed(1, 4),
      { id: 'angle', label: 'Neigung', type: 'float', min: -0.6, max: 0.6, step: 0.01, default: 0.15 },
      { id: 'color', label: 'Farbe', type: 'color', default: '#9cc9ff' },
    ],
    glsl: `vec4 effect(vec2 uv) {
  vec2 p = aspectUv(uv);
  p.x += p.y * p_angle;
  float col = floor(p.x * p_density);
  float h = hash11(col + uSeed * 50.0);
  float y = fract(p.y * 1.5 - uTime * p_speed * (1.2 + h) - h * 10.0);
  float drop = smoothstep(0.0, 0.15, y) * smoothstep(0.32, 0.15, y);
  float thin = smoothstep(0.5, 0.2, abs(fract(p.x * p_density) - 0.5));
  return vec4(p_color, drop * thin * step(0.35, h));
}`,
  },

  // ---------------------------------------------------------------- Muster
  {
    id: 'lines',
    name: 'Linienmuster',
    category: 'Muster',
    icon: '〰',
    description: 'Wandernde Streifen in beliebigem Winkel.',
    params: [
      { id: 'count', label: 'Anzahl', type: 'float', min: 1, max: 60, step: 1, default: 10 },
      { id: 'thickness', label: 'Breite', type: 'float', min: 0.02, max: 0.98, step: 0.01, default: 0.3 },
      { id: 'angle', label: 'Winkel', type: 'float', min: 0, max: 180, step: 1, default: 45, unit: '°' },
      speed(0.5, 4),
      { id: 'soft', label: 'Weichheit', type: 'float', min: 0, max: 1, step: 0.01, default: 0.05 },
      { id: 'color', label: 'Farbe', type: 'color', default: '#ffffff' },
    ],
    glsl: `vec4 effect(vec2 uv) {
  vec2 p = aspectUv(uv) - vec2(uAspect * 0.5, 0.5);
  float a = radians(p_angle);
  float x = dot(p, vec2(cos(a), sin(a))) * p_count - uTime * p_speed;
  float f = fract(x);
  float s = max(p_soft * 0.5, 0.005);
  float on = smoothstep(0.0, s, f) * (1.0 - smoothstep(p_thickness - s, p_thickness, f));
  return vec4(p_color, on);
}`,
  },
  {
    id: 'checker',
    name: 'Schachbrett',
    category: 'Muster',
    icon: '🏁',
    description: 'Blinkende oder wandernde Felder.',
    params: [
      { id: 'cols', label: 'Felder', type: 'float', min: 2, max: 40, step: 1, default: 8 },
      speed(0.5, 4),
      { id: 'mode', label: 'Bewegung', type: 'select', options: ['Blinken', 'Wandern', 'Zufall'], default: 0 },
      { id: 'color', label: 'Farbe', type: 'color', default: '#ffffff' },
    ],
    glsl: `vec4 effect(vec2 uv) {
  vec2 p = aspectUv(uv) * p_cols / uAspect;
  float t = uTime * p_speed;
  if (p_mode > 0.5 && p_mode < 1.5) p.x += t;
  vec2 id = floor(p);
  float on = mod(id.x + id.y, 2.0);
  if (p_mode < 0.5) on = abs(on - step(0.5, fract(t)));
  if (p_mode > 1.5) on = step(0.5, hash21(id + floor(t * 2.0)));
  return vec4(p_color, on);
}`,
  },
  {
    id: 'rings',
    name: 'Ringe',
    category: 'Muster',
    icon: '◎',
    description: 'Konzentrische Ringe breiten sich von der Mitte aus.',
    params: [
      { id: 'count', label: 'Anzahl', type: 'float', min: 1, max: 30, step: 1, default: 6 },
      speed(0.5, 3),
      { id: 'thickness', label: 'Breite', type: 'float', min: 0.05, max: 0.95, step: 0.01, default: 0.3 },
      { id: 'rainbow', label: 'Bunt', type: 'float', min: 0, max: 1, step: 0.01, default: 0.6 },
      { id: 'color', label: 'Farbe', type: 'color', default: '#38bdf8' },
    ],
    glsl: `vec4 effect(vec2 uv) {
  float r = length(aspectUv(uv) - vec2(uAspect * 0.5, 0.5));
  float x = r * p_count - uTime * p_speed;
  float on = smoothstep(0.0, 0.03, fract(x)) * (1.0 - smoothstep(p_thickness - 0.03, p_thickness, fract(x)));
  vec3 c = mix(p_color, hsv2rgb(vec3(floor(x) * 0.13, 0.85, 1.0)), p_rainbow);
  return vec4(c, on);
}`,
  },
  {
    id: 'kaleido',
    name: 'Kaleidoskop',
    category: 'Muster',
    icon: '❄',
    description: 'Drehendes, gespiegeltes Farbmuster.',
    params: [
      { id: 'segments', label: 'Segmente', type: 'float', min: 3, max: 16, step: 1, default: 6 },
      speed(0.3, 2),
      { id: 'zoom', label: 'Zoom', type: 'float', min: 0.5, max: 6, step: 0.01, default: 2 },
    ],
    glsl: `vec4 effect(vec2 uv) {
  vec2 p = aspectUv(uv) - vec2(uAspect * 0.5, 0.5);
  float t = uTime * p_speed;
  float a = atan(p.y, p.x) + t * 0.3;
  float r = length(p);
  float seg = TAU / p_segments;
  a = mod(a, seg);
  a = abs(a - seg * 0.5);
  vec2 q = vec2(cos(a), sin(a)) * r * p_zoom;
  float f = fbm(q * 2.0 + vec2(t, -t * 0.5));
  vec3 c = hsv2rgb(vec3(f * 1.5 + t * 0.1, 0.8, smoothstep(0.25, 0.75, f)));
  return vec4(c, 1.0);
}`,
  },

  // ----------------------------------------------------------------- Farbe
  {
    id: 'plasma',
    name: 'Plasma',
    category: 'Farbe',
    icon: '🫧',
    description: 'Fließende, bunte Farbwolken.',
    params: [
      speed(0.5, 3),
      { id: 'scale', label: 'Größe', type: 'float', min: 0.5, max: 8, step: 0.01, default: 3 },
      { id: 'sat', label: 'Sättigung', type: 'float', min: 0, max: 1, step: 0.01, default: 0.85 },
    ],
    glsl: `vec4 effect(vec2 uv) {
  vec2 p = aspectUv(uv) * p_scale;
  float t = uTime * p_speed;
  float v = sin(p.x + t) + sin((p.y + t) * 0.7) + sin((p.x + p.y + t) * 0.6) + sin(length(p - vec2(sin(t * 0.5), cos(t * 0.4)) * 2.0) * 1.5);
  return vec4(hsv2rgb(vec3(v * 0.15 + t * 0.05, p_sat, 1.0)), 1.0);
}`,
  },
  {
    id: 'gradient',
    name: 'Farbverlauf',
    category: 'Farbe',
    icon: '🎨',
    description: 'Verlauf zwischen zwei Farben, optional wandernd.',
    params: [
      { id: 'colorA', label: 'Farbe 1', type: 'color', default: '#ff2a6d' },
      { id: 'colorB', label: 'Farbe 2', type: 'color', default: '#05d9e8' },
      { id: 'angle', label: 'Winkel', type: 'float', min: 0, max: 360, step: 1, default: 90, unit: '°' },
      speed(0.2, 2),
    ],
    glsl: `vec4 effect(vec2 uv) {
  vec2 d = vec2(cos(radians(p_angle)), sin(radians(p_angle)));
  float x = dot(uv - 0.5, d) + 0.5 + uTime * p_speed * 0.2;
  float k = 0.5 - 0.5 * cos(x * TAU);
  return vec4(mix(p_colorA, p_colorB, k), 1.0);
}`,
  },
  {
    id: 'rainbow',
    name: 'Regenbogen',
    category: 'Farbe',
    icon: '🌈',
    description: 'Durchlaufender Regenbogen.',
    params: [
      { id: 'angle', label: 'Winkel', type: 'float', min: 0, max: 360, step: 1, default: 0, unit: '°' },
      { id: 'scale', label: 'Wiederholungen', type: 'float', min: 0.2, max: 6, step: 0.01, default: 1 },
      speed(0.3, 3),
    ],
    glsl: `vec4 effect(vec2 uv) {
  vec2 d = vec2(cos(radians(p_angle)), sin(radians(p_angle)));
  float x = dot(uv - 0.5, d) * p_scale - uTime * p_speed * 0.3;
  return vec4(hsv2rgb(vec3(x, 0.9, 1.0)), 1.0);
}`,
  },

  // --------------------------------------------------------------- Digital
  {
    id: 'glitch',
    name: 'Glitch',
    category: 'Digital',
    icon: '📺',
    description: 'Digitale Störungen: verschobene Blöcke, Farbkanäle, Rauschen.',
    params: [
      { id: 'amount', label: 'Stärke', type: 'float', min: 0, max: 1, step: 0.01, default: 0.5 },
      speed(1, 4),
      { id: 'color', label: 'Grundfarbe', type: 'color', default: '#00ffd0' },
    ],
    glsl: `vec4 effect(vec2 uv) {
  float t = floor(uTime * p_speed * 12.0);
  float band = floor(uv.y * 24.0);
  float shift = (hash21(vec2(band, t)) - 0.5) * p_amount * step(1.0 - p_amount * 0.6, hash21(vec2(band * 3.0, t)));
  vec2 q = uv + vec2(shift, 0.0);
  vec2 cell = floor(q * vec2(16.0, 9.0));
  float blk = step(0.5 + 0.45 * (1.0 - p_amount), hash21(cell + t));
  float r = step(0.5, fract(q.x * 6.0 + 0.05 * p_amount + t * 0.1));
  float g = step(0.5, fract(q.x * 6.0 + t * 0.1));
  float b = step(0.5, fract(q.x * 6.0 - 0.05 * p_amount + t * 0.1));
  vec3 c = mix(p_color * 0.15, vec3(r, g, b) * p_color + vec3(r, 0.0, b) * 0.4, blk);
  float scan = 0.8 + 0.2 * sin(uv.y * 400.0);
  float n = hash21(uv * 300.0 + t) * p_amount * 0.4;
  return vec4(c * scan + n, 1.0);
}`,
  },
  {
    id: 'matrix',
    name: 'Matrix-Regen',
    category: 'Digital',
    icon: '🟩',
    description: 'Herabfallende Zeichen-Spalten.',
    params: [
      { id: 'cols', label: 'Spalten', type: 'float', min: 8, max: 120, step: 1, default: 40 },
      speed(1, 4),
      { id: 'color', label: 'Farbe', type: 'color', default: '#22ff66' },
    ],
    glsl: `vec4 effect(vec2 uv) {
  vec2 p = aspectUv(uv) * p_cols / uAspect;
  vec2 id = floor(p), f = fract(p);
  float h = hash11(id.x + uSeed * 30.0);
  float head = fract(-uTime * p_speed * (0.15 + 0.2 * h) + h) * (p_cols / uAspect + 12.0) - 6.0;
  float dist = head - id.y;
  float trail = dist >= 0.0 ? exp(-dist * 0.25) : 0.0;
  // „Zeichen“: zufällige Pixelmuster in 3×5-Raster, die gelegentlich wechseln
  vec2 g = floor(f * vec2(3.0, 5.0));
  float glyph = step(0.45, hash21(g + id * 7.0 + floor(uTime * (1.0 + h * 3.0))));
  glyph *= step(0.1, f.x) * step(f.x, 0.9) * step(0.08, f.y) * step(f.y, 0.92);
  vec3 c = mix(p_color, vec3(0.85, 1.0, 0.9), step(dist, 0.9) * step(0.0, dist));
  return vec4(c, glyph * trail);
}`,
  },
  {
    id: 'scanlines',
    name: 'Scanlines',
    category: 'Digital',
    icon: '📟',
    description: 'Laufende Bildschirmzeilen wie bei alten Monitoren.',
    params: [
      { id: 'count', label: 'Zeilen', type: 'float', min: 10, max: 300, step: 1, default: 80 },
      speed(0.5, 4),
      { id: 'color', label: 'Farbe', type: 'color', default: '#7dd3fc' },
    ],
    glsl: `vec4 effect(vec2 uv) {
  float lines = 0.55 + 0.45 * sin(uv.y * p_count * PI);
  float bar = smoothstep(0.12, 0.0, abs(fract(uv.y - uTime * p_speed * 0.3) - 0.5) - 0.38);
  return vec4(p_color, clamp(lines * 0.35 + bar * 0.65, 0.0, 1.0));
}`,
  },

  // ----------------------------------------------------------- Architektur
  {
    id: 'windows',
    name: 'Fenster',
    category: 'Architektur',
    icon: '🏢',
    description: 'Fenster gehen nacheinander an und aus – für Fassaden und Modellhäuser.',
    params: [
      { id: 'cols', label: 'Spalten', type: 'float', min: 1, max: 24, step: 1, default: 6 },
      { id: 'rows', label: 'Stockwerke', type: 'float', min: 1, max: 16, step: 1, default: 4 },
      speed(0.3, 2),
      { id: 'lit', label: 'Anteil an', type: 'float', min: 0, max: 1, step: 0.01, default: 0.55 },
      { id: 'frame', label: 'Rahmen', type: 'float', min: 0.02, max: 0.45, step: 0.01, default: 0.18 },
      { id: 'color', label: 'Licht', type: 'color', default: '#ffcf7a' },
    ],
    glsl: `vec4 effect(vec2 uv) {
  vec2 p = uv * vec2(p_cols, p_rows);
  vec2 id = floor(p), f = fract(p);
  float inside = step(p_frame, f.x) * step(f.x, 1.0 - p_frame) * step(p_frame, f.y) * step(f.y, 1.0 - p_frame);
  float h = hash21(id + uSeed * 17.0);
  float t = uTime * p_speed * (0.3 + h);
  float k = floor(t + h * 10.0);
  float lit = step(1.0 - p_lit, hash21(id + k * 0.37));
  float fade = smoothstep(0.0, 0.15, fract(t + h * 10.0));
  // leichter Farbunterschied je Fenster (Lampen sind nie gleich)
  vec3 c = p_color * (0.75 + 0.35 * h);
  return vec4(c, inside * lit * mix(0.6, 1.0, fade));
}`,
  },
  {
    id: 'sun',
    name: 'Sonnenlauf',
    category: 'Architektur',
    icon: '☀',
    description: 'Sonnenlicht wandert über die Fläche – von Morgenrot bis Mittagslicht.',
    params: [
      { id: 'duration', label: 'Tageslänge', type: 'float', min: 2, max: 120, step: 1, default: 20, unit: 's' },
      { id: 'soft', label: 'Weichheit', type: 'float', min: 0.05, max: 1, step: 0.01, default: 0.45 },
      { id: 'ambient', label: 'Grundlicht', type: 'float', min: 0, max: 0.6, step: 0.01, default: 0.08 },
    ],
    glsl: `vec4 effect(vec2 uv) {
  float ph = fract(uTime / p_duration);
  float elev = sin(ph * PI);
  vec2 sunPos = vec2(mix(-0.2, 1.2, ph), 1.1 - elev * 1.2);
  vec2 d = aspectUv(uv) - vec2(sunPos.x * uAspect, sunPos.y);
  float light = exp(-dot(d, d) / (p_soft * p_soft * 2.0));
  vec3 warm = vec3(1.0, 0.55, 0.25), noon = vec3(1.0, 0.97, 0.88);
  vec3 c = mix(warm, noon, smoothstep(0.2, 0.8, elev));
  float a = clamp(p_ambient + light * smoothstep(0.0, 0.15, elev), 0.0, 1.0);
  return vec4(c, a);
}`,
  },
  {
    id: 'phases',
    name: 'Bauphasen',
    category: 'Architektur',
    icon: '🧱',
    description: 'Die Fläche füllt sich Schritt für Schritt – für Modelle und Präsentationen.',
    params: [
      { id: 'steps', label: 'Schritte', type: 'float', min: 2, max: 12, step: 1, default: 5 },
      { id: 'duration', label: 'Dauer je Schritt', type: 'float', min: 0.3, max: 10, step: 0.1, default: 2, unit: 's' },
      { id: 'dir', label: 'Richtung', type: 'select', options: ['von unten', 'von links', 'von der Mitte', 'Raster'], default: 0 },
      { id: 'colorA', label: 'Farbe Anfang', type: 'color', default: '#3b82f6' },
      { id: 'colorB', label: 'Farbe Ende', type: 'color', default: '#f59e0b' },
    ],
    glsl: `vec4 effect(vec2 uv) {
  float total = p_steps + 1.0;
  float k = mod(floor(uTime / p_duration), total);
  float fade = smoothstep(0.0, 0.25, fract(uTime / p_duration));
  float x;
  if (p_dir < 0.5) x = 1.0 - uv.y;
  else if (p_dir < 1.5) x = uv.x;
  else if (p_dir < 2.5) x = max(abs(uv.x - 0.5), abs(uv.y - 0.5)) * 2.0;
  else x = hash21(floor(uv * vec2(6.0, 4.0)) + 3.0);
  float s = floor(x * p_steps);
  float on = s < k - 1.0 ? 1.0 : (s < k ? fade : 0.0);
  vec3 c = mix(p_colorA, p_colorB, s / max(p_steps - 1.0, 1.0));
  return vec4(c, on);
}`,
  },
  {
    id: 'wipe',
    name: 'Aufbau / Wipe',
    category: 'Architektur',
    icon: '▶',
    description: 'Farbe füllt die Fläche von einer Seite, aus der Mitte oder als Raster.',
    params: [
      { id: 'dir', label: 'Art', type: 'select', options: ['links → rechts', 'unten → oben', 'aus der Mitte', 'Raster', 'Diagonale'], default: 0 },
      { id: 'duration', label: 'Dauer', type: 'float', min: 0.3, max: 20, step: 0.1, default: 3, unit: 's' },
      { id: 'hold', label: 'Halten', type: 'float', min: 0, max: 10, step: 0.1, default: 1, unit: 's' },
      { id: 'soft', label: 'Kante', type: 'float', min: 0, max: 0.5, step: 0.01, default: 0.05 },
      { id: 'color', label: 'Farbe', type: 'color', default: '#ffffff' },
    ],
    glsl: `vec4 effect(vec2 uv) {
  float cycle = p_duration * 2.0 + p_hold * 2.0;
  float t = mod(uTime, cycle);
  float prog = t < p_duration ? t / p_duration
             : t < p_duration + p_hold ? 1.0
             : t < p_duration * 2.0 + p_hold ? 1.0 - (t - p_duration - p_hold) / p_duration : 0.0;
  float x;
  if (p_dir < 0.5) x = uv.x;
  else if (p_dir < 1.5) x = 1.0 - uv.y;
  else if (p_dir < 2.5) x = length((uv - 0.5) * vec2(uAspect, 1.0)) / length(vec2(uAspect, 1.0) * 0.5);
  else if (p_dir < 3.5) x = hash21(floor(uv * vec2(8.0, 6.0)) + 1.0) * 0.999;
  else x = (uv.x + 1.0 - uv.y) * 0.5;
  float s = max(p_soft, 0.001);
  float on = 1.0 - smoothstep(prog * (1.0 + s) - s, prog * (1.0 + s), x);
  return vec4(p_color, on);
}`,
  },
];

export const EFFECT_MAP = new Map(EFFECTS.map((e) => [e.id, e]));

export function defaultParams(def: EffectDef): Record<string, number | string> {
  const out: Record<string, number | string> = {};
  for (const p of def.params) out[p.id] = p.default;
  return out;
}
