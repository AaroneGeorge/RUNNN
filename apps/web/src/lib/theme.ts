import { useEffect } from 'react';
import { useSettings } from './storage.ts';

function apply(theme: 'system' | 'light' | 'dark') {
  const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  const root = document.documentElement;
  if (dark) root.dataset.theme = 'dark';
  else delete root.dataset.theme;
  const color = getComputedStyle(root).getPropertyValue('--color-night').trim() || (dark ? '#0f0f0e' : '#eeebe3');
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', color);
}

export function useTheme() {
  const { theme } = useSettings();
  useEffect(() => {
    apply(theme);
    if (theme !== 'system') return;
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const on = () => apply('system');
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [theme]);
}
