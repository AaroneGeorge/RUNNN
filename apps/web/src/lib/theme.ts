// Light and dark mode. The palette lives in CSS (index.css swaps the colour tokens on <html data-theme="dark">);
// this file decides which theme applies and keeps the browser's status bar colour in step.
import { useSyncExternalStore } from 'react';
import { getSettings } from './storage.ts';

export type ThemePref = 'system' | 'light' | 'dark';
export type Theme = 'light' | 'dark';

const media = () => window.matchMedia('(prefers-color-scheme: dark)');
export const resolveTheme = (pref: ThemePref): Theme => (pref === 'system' ? (media().matches ? 'dark' : 'light') : pref);

const listeners = new Set<() => void>();
/** A screen that paints its own colour behind the status bar (the yellow countdown), or null for the page colour. */
let barOverride: string | null = null;

function syncBar() {
  const page = getComputedStyle(document.documentElement).getPropertyValue('--color-night').trim();
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', barOverride ?? (page || '#eeebe3'));
}

/** Put the theme on <html>, where CSS swaps the palette. index.html does the same before first paint. */
export function applyTheme(pref: ThemePref = getSettings().theme) {
  const t = resolveTheme(pref);
  const root = document.documentElement;
  if (root.dataset.theme !== t) root.dataset.theme = t;
  syncBar();
  listeners.forEach((l) => l());
}

export function setStatusBarColor(color: string | null) {
  barOverride = color;
  syncBar();
}

/** Follow the phone's light/dark setting while the preference is "system". */
export function watchSystemTheme(): () => void {
  const m = media();
  const on = () => {
    if (getSettings().theme === 'system') applyTheme('system');
  };
  m.addEventListener('change', on);
  return () => m.removeEventListener('change', on);
}

/** The theme in use right now; re-renders when it changes. */
export function useTheme(): Theme {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'),
  );
}
