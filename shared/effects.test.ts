import { describe, expect, it } from 'vitest';
import { EFFECT_CATEGORIES, EFFECTS, defaultParams } from './effects.js';
import { parseContent } from './state.js';

describe('Effekt-Bibliothek', () => {
  it('hat eindeutige IDs und gültige Kategorien', () => {
    const ids = EFFECTS.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const e of EFFECTS) expect(EFFECT_CATEGORIES).toContain(e.category);
  });

  it.each(EFFECTS.map((e) => [e.id, e] as const))('%s: Shader und Parameter passen zusammen', (_id, e) => {
    expect(e.glsl).toMatch(/vec4\s+effect\s*\(\s*vec2\s+uv\s*\)/);
    for (const p of e.params) {
      // Jeder Regler muss im Shader auch wirken
      expect(e.glsl).toContain(`p_${p.id}`);
      if (p.type === 'float') {
        expect(p.default).toBeGreaterThanOrEqual(p.min);
        expect(p.default).toBeLessThanOrEqual(p.max);
      }
      if (p.type === 'select') expect(p.default).toBeLessThan(p.options.length);
      if (p.type === 'color') expect(p.default).toMatch(/^#[0-9a-f]{6}$/);
    }
    // Standardwerte überstehen die Server-Prüfung unverändert
    const params = defaultParams(e);
    expect(parseContent({ type: 'effect', effect: e.id, params })).toEqual({ type: 'effect', effect: e.id, params });
  });

  it('begrenzt Stroboskope auf höchstens 12 Hz und warnt', () => {
    for (const e of EFFECTS.filter((x) => x.id.includes('strobe'))) {
      const freq = e.params.find((p) => p.id === 'freq');
      expect(freq?.type === 'float' && freq.max).toBeLessThanOrEqual(12);
      expect(e.warning).toBeTruthy();
    }
  });
});
