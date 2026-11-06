// Tiny WebAudio blips for the radar and alerts — no audio files to download.

let ctx: AudioContext | null = null;

function ac(): AudioContext | null {
  try {
    ctx ??= new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

/** Call from a user gesture once so iOS allows audio later. */
export function unlockAudio() {
  const c = ac();
  if (!c) return;
  const o = c.createOscillator();
  const g = c.createGain();
  g.gain.value = 0;
  o.connect(g).connect(c.destination);
  o.start();
  o.stop(c.currentTime + 0.01);
}

export function beep(freq = 880, ms = 90, vol = 0.15, type: OscillatorType = 'sine') {
  const c = ac();
  if (!c) return;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(vol, c.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + ms / 1000);
  o.connect(g).connect(c.destination);
  o.start();
  o.stop(c.currentTime + ms / 1000 + 0.02);
}

export function chord(kind: 'good' | 'bad' | 'alert' | 'info') {
  if (kind === 'good') [660, 880, 1320].forEach((f, i) => setTimeout(() => beep(f, 120, 0.12, 'triangle'), i * 90));
  else if (kind === 'bad') [440, 330, 220].forEach((f, i) => setTimeout(() => beep(f, 160, 0.14, 'sawtooth'), i * 110));
  else if (kind === 'alert') [990, 990].forEach((f, i) => setTimeout(() => beep(f, 120, 0.14, 'square'), i * 180));
  else beep(720, 70, 0.08);
}

export function vibrate(pattern: number | number[]) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* unsupported */
  }
}
