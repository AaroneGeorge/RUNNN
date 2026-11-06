import { X } from 'lucide-react';
import { useRef } from 'react';
import type { ClientMsg, RoomView } from '@runnn/shared';
import { Button } from '../components/ui.tsx';
import { useQrCamera } from '../lib/hooks.ts';
import { HoldRing } from './bits.tsx';

/**
 * Full-screen camera. Reports frames to the server (~5/s); the server owns the hold timer
 * and the ring fills from its progress. The camera stays open after a tag so the chase continues.
 */
export function Scanner({
  view,
  send,
  serverNow,
  onClose,
}: {
  view: RoomView;
  send: (m: ClientMsg) => boolean;
  serverNow: () => number;
  onClose: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const last = useRef({ at: 0 });
  const { error, ready } = useQrCamera(video, true, (qr) => {
    const now = Date.now();
    if (now - last.current.at < 200) return;
    last.current.at = now;
    send({ t: 'scan', qr });
  });
  const scan = view.hud.scanning;
  const released = view.hud.released;

  return (
    <div className="fixed inset-0 z-40 bg-black text-white">
      <video ref={video} playsInline muted className="absolute inset-0 h-full w-full object-cover" />
      <div className="absolute inset-0 grid place-items-center">
        <div className="relative grid place-items-center">
          {scan ? (
            <HoldRing startedAt={scan.startedAt} holdMs={scan.holdMs} serverNow={serverNow} size={260} />
          ) : (
            <div className="size-[240px] rounded-[2.5rem] border-4 border-white/70 border-dashed" />
          )}
          {scan && (
            <div className="absolute text-center">
              <div className="text-5xl font-black tabular">{scan.bib}</div>
              <div className="font-bold">{scan.name}</div>
              <div className="text-sm text-white/70">Hold steady…</div>
            </div>
          )}
        </div>
      </div>

      <div className="safe-top absolute inset-x-0 top-0 flex items-start justify-between gap-3 bg-gradient-to-b from-black/70 to-transparent px-4 pb-10">
        <div>
          <div className="text-lg font-extrabold">{released ? 'Point at a runner’s bib' : 'Not released yet'}</div>
          <div className="text-sm text-white/75">Hold for {view.config.holdSecs} s. If they slip out of frame, the scan breaks.</div>
        </div>
        <button onClick={onClose} aria-label="Close camera" className="grid size-11 shrink-0 place-items-center rounded-full bg-white/15">
          <X />
        </button>
      </div>

      {(error || !ready) && (
        <div className="absolute inset-x-6 bottom-32 rounded-2xl bg-black/70 p-4 text-center font-semibold">
          {error ?? 'Opening the camera…'}
        </div>
      )}

      <div className="safe-bottom absolute inset-x-0 bottom-0 flex justify-center bg-gradient-to-t from-black/70 to-transparent px-6 pt-10">
        <div className="mb-2 w-full max-w-sm">
          <div className="mb-3 text-center text-sm text-white/80">
            Camera not working? Read your claim code <b className="text-accent tabular">{view.me.claimCode}</b> to the runner.
          </div>
          <Button variant="secondary" block onClick={onClose}>
            Back to radar
          </Button>
        </div>
      </div>
    </div>
  );
}
