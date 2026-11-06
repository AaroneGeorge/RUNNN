import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { boundaryCenter, type ClientMsg, type RoomView } from '@runnn/shared';
import { Mascot } from '../components/Mascot.tsx';
import { Button, Loading } from '../components/ui.tsx';
import { Live } from '../game/Live.tsx';
import { Lobby } from '../game/Lobby.tsx';
import { Results } from '../game/Results.tsx';
import { Watch } from '../game/Watch.tsx';
import type { GameCtx } from '../game/bits.tsx';
import { GameConnection, type ConnStatus } from '../lib/conn.ts';
import { useGeolocation } from '../lib/hooks.ts';
import { usePositionSender } from '../lib/run.ts';
import { forgetSession, getLastName, getSession, setSession, useSettings } from '../lib/storage.ts';
import { notify } from '../lib/toast.ts';

export function Play({ watch = false }: { watch?: boolean }) {
  const code = (useParams().code ?? '').toUpperCase();
  const nav = useNavigate();
  const settings = useSettings();
  const [view, setView] = useState<RoomView | null>(null);
  const [status, setStatus] = useState<ConnStatus>('connecting');
  const [fatal, setFatal] = useState<string | null>(null);
  const conn = useRef<GameConnection | null>(null);
  const session = getSession(code);
  const canJoin = !!(session.playerId || session.organiserKey || session.name || getLastName());

  useEffect(() => {
    if (!canJoin) return;
    const c = new GameConnection(code, {
      onView: setView,
      onToast: (m) => notify(m.text, m.kind, { vibrate: m.vibrate, sound: m.sound }),
      onError: (msg, isFatal) => {
        if (isFatal) {
          setFatal(msg);
          if (/no longer exists|removed/.test(msg)) forgetSession(code);
        } else notify(msg, 'bad');
      },
      onStatus: setStatus,
    });
    conn.current = c;
    const onVis = () => document.visibilityState === 'visible' && c.kick();
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('online', onVis);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('online', onVis);
      c.stop();
      conn.current = null;
    };
  }, [code, canJoin]);

  // Remember the organiser key on this device too (e.g. after joining from HQ on a second phone).
  useEffect(() => {
    if (view?.organiserKey && getSession(code).organiserKey !== view.organiserKey) setSession(code, { organiserKey: view.organiserKey });
  }, [view?.organiserKey, code]);

  const send = useCallback((m: ClientMsg) => conn.current?.send(m) ?? false, []);
  const serverNow = useCallback(() => conn.current?.serverNow() ?? Date.now(), []);

  const plays = !!view?.me.plays && !watch && !view.me.isBot;
  const active = plays && view?.phase !== 'ended' && view?.me.status !== 'eliminated';
  const testMode = settings.gpsTest;
  const geo = useGeolocation(!!active, testMode, view ? boundaryCenter(view.boundary) : null);
  usePositionSender(geo.fix, send, !!active && status === 'open');

  if (!canJoin) return <Navigate to={`/join/${code}`} replace />;

  if (fatal)
    return (
      <div className="grid min-h-[100dvh] place-items-center px-6 text-center">
        <div>
          <div className="mx-auto w-fit">
            <Mascot mood="sad" />
          </div>
          <h1 className="mt-2 text-2xl font-black">{fatal}</h1>
          <div className="mt-6 flex justify-center gap-2">
            <Button variant="secondary" onClick={() => nav('/')}>
              Home
            </Button>
            <Link to="/join">
              <Button>Join another game</Button>
            </Link>
          </div>
        </div>
      </div>
    );

  if (!view) return <Loading label={status === 'reconnecting' ? 'Reconnecting…' : `Joining ${code}…`} />;

  const ctx: GameCtx = { view, send, serverNow, status, geo, testMode };
  if (watch) return <Watch {...ctx} />;
  if (view.phase === 'lobby' || view.phase === 'countdown') return <Lobby {...ctx} />;
  if (view.phase === 'ended') return <Results {...ctx} />;
  return <Live {...ctx} />;
}
