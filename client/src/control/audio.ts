import { useSyncExternalStore } from 'react';
import { AudioEngine } from '../lib/audio/engine';
import { conn } from './store';

/** Eine Audio-Engine für die ganze Steuerung; Analysen gehen an alle Fenster */
export const audio = new AudioEngine((frame) => conn.sendAudio(frame));

export function useAudioState() {
  return useSyncExternalStore(audio.subscribe, audio.getState);
}
