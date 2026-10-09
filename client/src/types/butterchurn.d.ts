// Minimale Typen für Butterchurn (MIT, https://github.com/jberg/butterchurn)

declare module 'butterchurn' {
  export interface ButterchurnVisualizer {
    loadPreset(preset: object, blendTime: number): void;
    setRendererSize(width: number, height: number, opts?: { pixelRatio?: number; textureRatio?: number }): void;
    render(opts?: {
      audioLevels?: { timeByteArray: Uint8Array; timeByteArrayL: Uint8Array; timeByteArrayR: Uint8Array };
      elapsedTime?: number;
    }): void;
  }
  const butterchurn: {
    createVisualizer(
      audioContext: AudioContext | null,
      canvas: HTMLCanvasElement,
      opts: { width: number; height: number; pixelRatio?: number; textureRatio?: number },
    ): ButterchurnVisualizer;
  };
  export default butterchurn;
}

declare module 'butterchurn-presets/lib/*' {
  const pack: { getPresets(): Record<string, object> };
  export default pack;
}
