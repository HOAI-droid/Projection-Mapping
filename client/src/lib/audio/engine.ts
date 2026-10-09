// Audio-Analyse (Web Audio API) für die Audio-Reaktivität.
// Läuft in der Steuerung; die Analysewerte gehen per WebSocket an Ausgabe und Vorschau
// (kein Audiostream, nur ~60 kleine Zahlenpakete pro Sekunde).
//
// Quellen:  'mic'  – Mikrofon oder Audio-Eingang (auch virtuelle Geräte wie BlackHole/Loopback)
//           'file' – eigener Player: Musikdateien abspielen (hörbar) und analysieren
//           'tab'  – Ton eines Browser-Tabs (z. B. Spotify/YouTube im Web), per Bildschirmfreigabe

import type { AudioFrame } from '../../../../shared/types.js';

export type AudioSourceKind = 'none' | 'mic' | 'file' | 'tab';

export interface AudioUiState {
  source: AudioSourceKind;
  running: boolean;
  error: string | null;
  devices: MediaDeviceInfo[];
  deviceId: string;
  tracks: { name: string; url: string }[];
  trackIndex: number;
  playing: boolean;
  currentTime: number;
  duration: number;
  /** Verstärkung 0.2 … 4 */
  gain: number;
  /** Beat-Empfindlichkeit 1.1 (empfindlich) … 2 (nur deutliche Schläge) */
  beatSensitivity: number;
}

const BANDS = 64;
const WAVE = 128;
const r3 = (v: number) => Math.round(v * 1000) / 1000;

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private sourceNode: AudioNode | null = null;
  private stream: MediaStream | null = null;
  private audioEl: HTMLAudioElement | null = null;
  private timer: number | undefined;
  private freq = new Uint8Array(0);
  private time = new Float32Array(0);
  private timeBytes = new Uint8Array(0);
  private pcm = new Uint8Array(1024);

  // Analyse-Zustand
  private bandMax = { level: 0.2, bass: 0.2, mid: 0.2, high: 0.2 };
  private peaks = new Array<number>(BANDS).fill(0);
  private bassHistory: number[] = [];
  private lastBeat = 0;
  private beatIntervals: number[] = [];
  private beatPulse = 0;
  private beatCount = 0;
  private bpm = 0;

  private listeners = new Set<() => void>();
  private frameListeners = new Set<(f: AudioFrame) => void>();

  state: AudioUiState = {
    source: 'none',
    running: false,
    error: null,
    devices: [],
    deviceId: '',
    tracks: [],
    trackIndex: 0,
    playing: false,
    currentTime: 0,
    duration: 0,
    gain: 1,
    beatSensitivity: 1.35,
  };

  constructor(private emit: (f: AudioFrame) => void) {
    navigator.mediaDevices?.addEventListener?.('devicechange', () => void this.refreshDevices());
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getState = (): AudioUiState => this.state;

  onFrame(fn: (f: AudioFrame) => void): () => void {
    this.frameListeners.add(fn);
    return () => this.frameListeners.delete(fn);
  }

  set(patch: Partial<AudioUiState>): void {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn();
  }

  async refreshDevices(): Promise<void> {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      this.set({ devices: all.filter((d) => d.kind === 'audioinput') });
    } catch {
      /* egal */
    }
  }

  private ensureContext(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext({ latencyHint: 'interactive' });
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 2048;
      this.analyser.smoothingTimeConstant = 0.55;
      this.analyser.minDecibels = -90;
      this.analyser.maxDecibels = -15;
      this.freq = new Uint8Array(this.analyser.frequencyBinCount);
      this.time = new Float32Array(this.analyser.fftSize);
      this.timeBytes = new Uint8Array(this.analyser.fftSize);
    }
    void this.ctx.resume();
    return this.ctx;
  }

  /** Aktuelle Quelle trennen */
  stop(): void {
    window.clearInterval(this.timer);
    this.timer = undefined;
    this.sourceNode?.disconnect();
    this.sourceNode = null;
    this.analyser?.disconnect(); // Verbindung zu den Lautsprechern lösen (sonst wäre ein Mikrofon hörbar)
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    if (this.audioEl) {
      this.audioEl.pause();
      this.audioEl = null;
    }
    this.set({ source: 'none', running: false, playing: false });
  }

  async useMicrophone(deviceId = ''): Promise<void> {
    this.stop();
    try {
      const ctx = this.ensureContext();
      // Ohne Echo-/Rauschunterdrückung: die würden die Musik „glätten“
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: deviceId ? { exact: deviceId } : undefined,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      this.stream = stream;
      this.sourceNode = ctx.createMediaStreamSource(stream);
      this.sourceNode.connect(this.analyser!); // nicht an die Lautsprecher → keine Rückkopplung
      this.set({ source: 'mic', deviceId, running: true, error: null });
      void this.refreshDevices(); // Gerätenamen gibt es erst nach der Erlaubnis
      this.start();
    } catch (err) {
      this.set({ error: `Mikrofon nicht verfügbar: ${err instanceof Error ? err.message : String(err)}` });
    }
  }

  async useTab(): Promise<void> {
    this.stop();
    try {
      const ctx = this.ensureContext();
      // Chrome: im Dialog einen Tab wählen und „Tab-Audio teilen“ aktivieren
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      stream.getVideoTracks().forEach((t) => t.stop());
      if (stream.getAudioTracks().length === 0) throw new Error('Kein Ton freigegeben – im Dialog „Tab-Audio teilen“ aktivieren.');
      this.stream = stream;
      this.sourceNode = ctx.createMediaStreamSource(stream);
      this.sourceNode.connect(this.analyser!);
      stream.getAudioTracks()[0]!.addEventListener('ended', () => this.stop());
      this.set({ source: 'tab', running: true, error: null });
      this.start();
    } catch (err) {
      this.set({ error: err instanceof Error ? err.message : String(err) });
    }
  }

  /** Musikdateien in den Player laden */
  addFiles(files: FileList | File[]): void {
    const before = this.state.tracks.length;
    const tracks = [...this.state.tracks];
    for (const f of Array.from(files)) {
      if (f.type.startsWith('audio/') || /\.(mp3|m4a|aac|wav|flac|ogg|opus)$/i.test(f.name)) {
        tracks.push({ name: f.name.replace(/\.[^.]+$/, ''), url: URL.createObjectURL(f) });
      }
    }
    this.set({ tracks });
    // Läuft noch kein Player, gleich den ersten neuen Titel starten
    if (this.state.source !== 'file' && tracks.length > before) this.playTrack(before);
  }

  playTrack(index: number): void {
    const track = this.state.tracks[index];
    if (!track) return;
    const ctx = this.ensureContext();
    if (this.state.source !== 'file') this.stop();
    if (!this.audioEl) {
      const el = new Audio();
      el.crossOrigin = 'anonymous';
      el.addEventListener('timeupdate', () => this.set({ currentTime: el.currentTime, duration: el.duration || 0 }));
      el.addEventListener('ended', () => this.next());
      el.addEventListener('play', () => this.set({ playing: true }));
      el.addEventListener('pause', () => this.set({ playing: false }));
      this.audioEl = el;
      this.sourceNode = ctx.createMediaElementSource(el);
      this.sourceNode.connect(this.analyser!);
      this.analyser!.connect(ctx.destination); // hörbar
    }
    this.audioEl.src = track.url;
    void this.audioEl.play().catch((err: unknown) => this.set({ error: String(err) }));
    this.set({ source: 'file', running: true, trackIndex: index, error: null });
    this.start();
  }

  togglePlay(): void {
    if (!this.audioEl) return this.playTrack(this.state.trackIndex);
    if (this.audioEl.paused) void this.audioEl.play();
    else this.audioEl.pause();
  }

  next(): void {
    if (this.state.tracks.length) this.playTrack((this.state.trackIndex + 1) % this.state.tracks.length);
  }

  prev(): void {
    if (this.state.tracks.length) this.playTrack((this.state.trackIndex - 1 + this.state.tracks.length) % this.state.tracks.length);
  }

  seek(t: number): void {
    if (this.audioEl) this.audioEl.currentTime = t;
  }

  /** Manueller Beat (Tap): für Szenenwechsel und Beat-Effekte ohne Musik */
  tap(): void {
    this.registerBeat(performance.now());
    if (!this.timer) this.emitFrame(this.silentFrame());
  }

  private start(): void {
    window.clearInterval(this.timer);
    // setInterval statt requestAnimationFrame: läuft weiter, wenn das Fenster nicht im Vordergrund ist
    this.timer = window.setInterval(() => this.analyse(), 16);
  }

  private registerBeat(now: number): void {
    if (this.lastBeat) {
      const dt = now - this.lastBeat;
      if (dt > 250 && dt < 2000) {
        this.beatIntervals = [...this.beatIntervals, dt].slice(-12);
        const sorted = [...this.beatIntervals].sort((a, b) => a - b);
        let bpm = 60000 / sorted[Math.floor(sorted.length / 2)]!;
        while (bpm < 70) bpm *= 2;
        while (bpm > 190) bpm /= 2;
        this.bpm = bpm;
      }
    }
    this.lastBeat = now;
    this.beatPulse = 1;
    this.beatCount++;
  }

  private silentFrame(): AudioFrame {
    return {
      level: 0,
      bass: 0,
      mid: 0,
      high: 0,
      beat: r3(this.beatPulse),
      beatCount: this.beatCount,
      bpm: Math.round(this.bpm),
      spectrum: new Array<number>(BANDS).fill(0),
      peaks: new Array<number>(BANDS).fill(0),
      wave: new Array<number>(WAVE).fill(0),
    };
  }

  private analyse(): void {
    const an = this.analyser;
    const ctx = this.ctx;
    if (!an || !ctx) return;
    an.getByteFrequencyData(this.freq);
    an.getFloatTimeDomainData(this.time);
    const gain = this.state.gain;
    const binHz = ctx.sampleRate / an.fftSize;
    const avg = (lo: number, hi: number) => {
      const a = Math.max(1, Math.floor(lo / binHz));
      const b = Math.min(this.freq.length - 1, Math.ceil(hi / binHz));
      let sum = 0;
      for (let i = a; i <= b; i++) sum += this.freq[i]!;
      return sum / Math.max(1, b - a + 1) / 255;
    };

    let rms = 0;
    for (let i = 0; i < this.time.length; i++) rms += this.time[i]! * this.time[i]!;
    rms = Math.sqrt(rms / this.time.length);

    const raw = { level: rms * 3, bass: avg(20, 150), mid: avg(150, 2000), high: avg(2000, 12000) };
    // Automatische Pegelanpassung: leise Musik wirkt so lebendig wie laute
    const norm = (k: keyof typeof raw) => {
      this.bandMax[k] = Math.max(raw[k], this.bandMax[k] * 0.997, 0.08);
      return Math.min(1, (raw[k] / this.bandMax[k]) * 0.9 * gain);
    };
    const level = norm('level');
    const bass = norm('bass');
    const mid = norm('mid');
    const high = norm('high');

    // Beat: Bass-Energie deutlich über dem Mittel der letzten Sekunde
    const now = performance.now();
    this.bassHistory.push(raw.bass);
    if (this.bassHistory.length > 60) this.bassHistory.shift();
    const mean = this.bassHistory.reduce((a, b) => a + b, 0) / this.bassHistory.length;
    if (raw.bass > mean * this.state.beatSensitivity && raw.bass > 0.12 && now - this.lastBeat > 260) {
      this.registerBeat(now);
    } else {
      this.beatPulse *= 0.86;
    }

    // 64 logarithmische Bänder 30 Hz … 16 kHz mit Winamp-artig fallenden Spitzen
    const spectrum: number[] = [];
    const lo = Math.log(30);
    const hi = Math.log(16000);
    for (let i = 0; i < BANDS; i++) {
      const f0 = Math.exp(lo + ((hi - lo) * i) / BANDS);
      const f1 = Math.exp(lo + ((hi - lo) * (i + 1)) / BANDS);
      const v = Math.min(1, avg(f0, f1) * gain * 1.15);
      spectrum.push(r3(v));
      this.peaks[i] = Math.max(v, this.peaks[i]! - 0.012);
    }

    // Wellenform ab einem Nulldurchgang, damit das Oszilloskop ruhig steht
    let startIdx = 0;
    for (let i = 1; i < this.time.length / 2; i++) {
      if (this.time[i - 1]! < 0 && this.time[i]! >= 0) {
        startIdx = i;
        break;
      }
    }
    const step = Math.floor(this.time.length / 2 / WAVE);
    const wave: number[] = [];
    for (let i = 0; i < WAVE; i++) wave.push(r3(Math.max(-1, Math.min(1, this.time[startIdx + i * step]! * 2.5 * gain))));

    // Rohe Samples für Milkdrop (Butterchurn rechnet daraus seine eigene Analyse)
    an.getByteTimeDomainData(this.timeBytes);
    for (let i = 0; i < 1024; i++) {
      this.pcm[i] = Math.max(0, Math.min(255, Math.round(128 + (this.timeBytes[i]! - 128) * gain)));
    }
    let bin = '';
    for (let i = 0; i < 1024; i++) bin += String.fromCharCode(this.pcm[i]!);

    this.emitFrame({
      pcm: btoa(bin),
      level: r3(level),
      bass: r3(bass),
      mid: r3(mid),
      high: r3(high),
      beat: r3(this.beatPulse),
      beatCount: this.beatCount,
      bpm: Math.round(this.bpm),
      spectrum,
      peaks: this.peaks.map(r3),
      wave,
    });
  }

  private emitFrame(f: AudioFrame): void {
    this.emit(f);
    for (const fn of this.frameListeners) fn(f);
  }
}
