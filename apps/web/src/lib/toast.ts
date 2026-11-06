import { toast } from 'sonner';

export type ToastKind = 'info' | 'good' | 'bad' | 'alert';

/** Game toasts. Sonner handles stacking, swipe-to-dismiss and pausing while the tab is hidden. */
export function notify(text: string, kind: ToastKind = 'info') {
  const opts = { duration: kind === 'alert' || kind === 'bad' ? 6000 : 4000 };
  if (kind === 'good') toast.success(text, opts);
  else if (kind === 'bad') toast.error(text, opts);
  else if (kind === 'alert') toast.warning(text, opts);
  else toast(text, opts);
}
