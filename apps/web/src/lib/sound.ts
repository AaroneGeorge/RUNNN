import type { SoundCue } from '@runnn/shared';
import { getSettings } from './storage.ts';

/** WebAudio beeps: no audio files, nothing to fail to load. */
let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (!getSettings().sound) return null;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  } catch {
    return null;
  }
}

/** Call from a user gesture once so iOS allows sound later. */
export function unlockAudio() {
  const a = audio();
  if (!a) return;
  const o = a.createOscillator();
  const g = a.createGain();
  g.gain.value = 0;
  o.connect(g).connect(a.destination);
  o.start();
  o.stop(a.currentTime + 0.01);
}

export function beep(freq: number, ms: number, gain = 0.15, type: OscillatorType = 'sine', delay = 0) {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + delay / 1000;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000);
  o.connect(g).connect(a.destination);
  o.start(t);
  o.stop(t + ms / 1000 + 0.02);
}

const CUES: Record<SoundCue, () => void> = {
  start: () => [523, 659, 784].forEach((f, i) => beep(f, 160, 0.18, 'triangle', i * 140)),
  release: () => [784, 1047].forEach((f, i) => beep(f, 220, 0.2, 'square', i * 180)),
  scan: () => [880, 880, 880].forEach((f, i) => beep(f, 90, 0.22, 'sawtooth', i * 120)),
  broke: () => [660, 990].forEach((f, i) => beep(f, 120, 0.16, 'triangle', i * 100)),
  caught: () => [523, 784, 1047].forEach((f, i) => beep(f, 140, 0.2, 'square', i * 110)),
  converted: () => [440, 330, 220].forEach((f, i) => beep(f, 220, 0.2, 'sawtooth', i * 180)),
  out: () => [300, 300].forEach((f, i) => beep(f, 260, 0.2, 'square', i * 340)),
  end: () => [784, 659, 523, 784].forEach((f, i) => beep(f, 200, 0.18, 'triangle', i * 170)),
  sos: () => [1000, 700, 1000, 700].forEach((f, i) => beep(f, 160, 0.25, 'square', i * 180)),
};

export function cue(c: SoundCue | undefined) {
  if (c) CUES[c]?.();
}

export function vibrate(pattern: number[] | undefined) {
  if (!pattern || !getSettings().vibrate) return;
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* not supported */
  }
}
