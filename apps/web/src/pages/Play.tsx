import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { boundaryCenter, offset, type ClientMsg, type HostCmd, type RoomView, type Team } from '@kalikkam/shared';
import { GameConnection, type ConnStatus } from '../lib/conn.ts';
import { getProfile, getSession, getSettings, setSession, setSettings, type Settings } from '../lib/storage.ts';
import { useGeolocation, useWakeLock } from '../lib/hooks.ts';
import { chord, vibrate } from '../lib/sound.ts';
import { Spinner } from '../components/ui.tsx';
import { notify } from '../lib/toast.ts';
import { recordRun } from '../lib/run.ts';
import { Lobby } from '../game/Lobby.tsx';
import { Live } from '../game/Live.tsx';
import { Results } from '../game/Results.tsx';
import { useRadarFeedback } from '../game/radar.ts';

export interface PlayCtx {
  view: RoomView;
  status: ConnStatus;
  send: (m: ClientMsg) => void;
  host: (c: HostCmd) => void;
  serverNow: () => number;
  settings: Settings;
  setSettings: (s: Settings) => void;
  geo: ReturnType<typeof useGeolocation>;
  toast: (text: string, kind?: 'info' | 'good' | 'bad' | 'alert') => void;
  pendingAction: string | null;
  /** `code`: the catch code for 'gotTagged' ('' = "I don't know"). */
  act: (action: string, code?: string) => void;
  /** Simulation host: the team whose bot screen we asked to see (null = referee map). */
  watchTeam: Team | null;
  watch: (team: Team | null) => void;
}

export function PlayPage() {
  const code = (useParams().code ?? '').toUpperCase();
  const nav = useNavigate();
  const session = getSession(code);
  const [view, setView] = useState<RoomView | null>(null);
  const [status, setStatus] = useState<ConnStatus>('connecting');
  const [fatal, setFatal] = useState<string | null>(null);
  const [settings, setLocalSettings] = useState(getSettings);
  const [pendingAction, setPending] = useState<string | null>(null);
  const connRef = useRef<GameConnection | null>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  // ?watch=zombie|survivor opens a simulation on a bot's screen (the side-by-side page uses it).
  const [params] = useSearchParams();
  const asked = params.get('watch');
  const [watchTeam, setWatchTeam] = useState<Team | null>(asked === 'zombie' || asked === 'survivor' ? asked : null);
  const watchRef = useRef(watchTeam);
  watchRef.current = watchTeam;

  const needsJoin = !session || (!session.name && !session.hostKey);
  useEffect(() => {
    if (needsJoin) nav(`/join/${code}`, { replace: true });
  }, [needsJoin, code, nav]);

  useEffect(() => {
    if (needsJoin) return;
    const s = getSession(code)!;
    const conn = new GameConnection(
      code,
      { name: s.name ?? 'Player', vest: s.vest, profileToken: getProfile()?.token },
      {
        onView: (v) => {
          setView(v);
          setPending(null);
        },
        onStatus: setStatus,
        // Each (re)connect is a new socket, so ask again which bot to watch.
        onJoined: (isHost) => {
          if (isHost && watchRef.current) connRef.current?.send({ t: 'watch', team: watchRef.current });
        },
        onToast: (text, kind, vib) => {
          notify(text, kind);
          if (settingsRef.current.vibrate && vib) vibrate(vib);
          if (settingsRef.current.sound) chord(kind);
        },
        onError: (msg, isFatal, beforeJoin) => {
          setPending(null);
          if (isFatal) return setFatal(msg);
          if (beforeJoin) {
            // e.g. vest number taken → back to the join form with the reason.
            const cur = getSession(code);
            setSession(code, cur?.hostKey ? { hostKey: cur.hostKey, name: cur.name } : null);
            nav(`/join/${code}?error=${encodeURIComponent(msg)}`, { replace: true });
            return;
          }
          notify(msg, 'bad');
          if (settingsRef.current.vibrate) vibrate(200);
        },
      },
    );
    connRef.current = conn;
    conn.start();
    return () => conn.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, needsJoin]);

  const send = useCallback((m: ClientMsg) => connRef.current?.send(m), []);
  const host = useCallback((c: HostCmd) => connRef.current?.send({ t: 'host', ...c } as ClientMsg), []);
  const serverNow = useCallback(() => connRef.current?.serverNow() ?? Date.now(), []);
  const watch = useCallback((team: Team | null) => {
    setWatchTeam(team);
    connRef.current?.send({ t: 'watch', team });
  }, []);
  const act = useCallback((action: string, code?: string) => {
    // Watching a bot: its buttons are for show only.
    if (viewRef.current?.watching) return;
    setPending(action);
    connRef.current?.send({ t: 'act', action, ...(code !== undefined ? { code } : {}) });
    setTimeout(() => setPending((p) => (p === action ? null : p)), 4000);
  }, []);
  const updateSettings = (s: Settings) => {
    setLocalSettings(s);
    setSettings(s);
  };

  // GPS: on as soon as we're in the room so the host can see people arrive.
  const simStart = useMemo(
    () => (view ? offset(boundaryCenter(view.boundary), Math.random() * 25, Math.random() * 360) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [view?.code],
  );
  const geoOn = !!view && !view.sim && (view.me.plays || view.me.isHost) && view.phase !== 'ended';
  const geo = useGeolocation(geoOn, settings.simGps, simStart);
  const lastSent = useRef(0);
  const lastFix = useRef<{ lat: number; lng: number; acc: number; at: number } | null>(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  useEffect(() => {
    if (geo.state.kind !== 'ok' && !(geo.state.kind === 'error' && geo.state.fix)) return;
    const fix = geo.state.kind === 'ok' ? geo.state.fix : geo.state.fix!;
    lastFix.current = fix;
    // My run (beta): your own route, saved on this phone only.
    const v = viewRef.current;
    if (v && v.phase === 'live' && v.me.plays && v.startedAt && settingsRef.current.runMap && !settingsRef.current.simGps) {
      recordRun(v.code, v.startedAt, fix, v.me.role === 'zombie');
    }
    const now = Date.now();
    if (now - lastSent.current < 900) return;
    lastSent.current = now;
    send({ t: 'pos', lat: fix.lat, lng: fix.lng, acc: fix.acc });
  }, [geo.state, send]);
  // Phones often stop reporting while you stand still, and after 20 s the server treats you as gone (off
  // everyone's radar, can't be checked against the play area). Re-send the last reading every 5 s while it's
  // under a minute old; a phone that really lost GPS stops re-sending and goes stale, as it should.
  useEffect(() => {
    if (!geoOn) return;
    const id = setInterval(() => {
      const f = lastFix.current;
      const now = Date.now();
      if (!f || now - lastSent.current < 4500 || now - f.at > 60_000) return;
      lastSent.current = now;
      send({ t: 'pos', lat: f.lat, lng: f.lng, acc: f.acc });
    }, 5000);
    return () => clearInterval(id);
  }, [geoOn, send]);

  const live = view?.phase === 'live' || view?.phase === 'paused' || view?.phase === 'countdown';
  const wake = useWakeLock(!!live);
  useRadarFeedback(view, settings);

  if (fatal) {
    return (
      <div className="page flex min-h-dvh flex-col items-center justify-center text-center">
        <div className="mb-4 text-6xl">🚪</div>
        <h1 className="mb-2 text-2xl font-extrabold">{fatal}</h1>
        <Link to="/" className="btn-brand mt-6">
          Back home
        </Link>
      </div>
    );
  }
  if (!view) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Spinner label={status === 'reconnecting' ? 'Reconnecting…' : `Joining ${code}…`} />
      </div>
    );
  }

  const ctx: PlayCtx = {
    view,
    status,
    send,
    host,
    serverNow,
    settings,
    setSettings: updateSettings,
    geo,
    toast: notify,
    pendingAction,
    act,
    watchTeam,
    watch,
  };

  return (
    <>
      {status !== 'open' && (
        <div className="fixed inset-x-0 top-0 z-[45] bg-sun py-1 text-center text-xs font-bold text-ink">
          {status === 'closed' ? 'Disconnected' : 'Reconnecting… your role is saved'}
        </div>
      )}
      {view.phase === 'lobby' && <Lobby ctx={ctx} />}
      {(view.phase === 'countdown' || view.phase === 'live' || view.phase === 'paused') && <Live ctx={ctx} wakeLock={wake} />}
      {view.phase === 'ended' && <Results ctx={ctx} />}
    </>
  );
}
