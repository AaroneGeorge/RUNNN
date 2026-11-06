import { toast as sonner } from 'sonner';
import type { SoundCue, ToastKind } from '@runnn/shared';
import { cue, vibrate } from './sound.ts';

/** The server sends the pattern on a toast, so the rules decide the feel. */
export function notify(text: string, kind: ToastKind = 'info', opts: { vibrate?: number[]; sound?: SoundCue } = {}) {
  vibrate(opts.vibrate);
  cue(opts.sound);
  const duration = kind === 'alert' ? 5000 : 3500;
  if (kind === 'good') sonner.success(text, { duration });
  else if (kind === 'bad') sonner.error(text, { duration });
  else if (kind === 'alert') sonner.warning(text, { duration });
  else sonner(text, { duration });
}

export const toastError = (e: unknown) => notify(e instanceof Error ? e.message : String(e), 'bad');
