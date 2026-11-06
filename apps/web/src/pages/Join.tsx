import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { GAMES, parseVestQr, type Boundary, type GameId, type Phase } from '@kalikkam/shared';
import { api, ensureProfile } from '../lib/api.ts';
import { getSession, lastName, rememberName, setSession } from '../lib/storage.ts';
import { unlockAudio } from '../lib/sound.ts';
import { ActionBar, ErrorBox, GameBadge, QrScanner, SwitchRow, TopBar } from '../components/ui.tsx';
import { Mascot } from '../components/Mascot.tsx';
import { ArrowRight, CircleCheck, Loader2, Lock, ScanLine, Shirt, Users } from 'lucide-react';

interface RoomInfo {
  code: string;
  game: GameId;
  title: string;
  phase: Phase;
  players: number;
  boundary: Boundary;
}

export function JoinPage() {
  const params = useParams();
  const nav = useNavigate();
  const [code, setCode] = useState((params.code ?? '').toUpperCase());
  const [info, setInfo] = useState<RoomInfo | null>(null);
  const [lookup, setLookup] = useState<'idle' | 'loading' | 'missing'>('idle');
  const [name, setName] = useState(lastName());
  const [vest, setVest] = useState(getSession(code)?.vest ?? '');
  const [noVest, setNoVest] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [scan, setScan] = useState(false);
  const [scanVest, setScanVest] = useState(false);
  const error = new URLSearchParams(location.search).get('error');

  useEffect(() => {
    if (!/^[A-Z]{4}$/.test(code)) {
      setInfo(null);
      setLookup('idle');
      return;
    }
    setLookup('loading');
    api<RoomInfo>(`/api/rooms/${code}`)
      .then((r) => {
        setInfo(r);
        setLookup('idle');
      })
      .catch(() => {
        setInfo(null);
        setLookup('missing');
      });
  }, [code]);

  const meta = info ? GAMES[info.game] : null;
  const vestOk = noVest || /^\d{3}$/.test(vest);

  const submit = async () => {
    if (!info || !name.trim() || !vestOk) return;
    setBusy(true);
    setErr('');
    unlockAudio();
    rememberName(name.trim());
    // Profile = XP + badges. Best effort: the game works without it.
    await ensureProfile(name.trim()).catch(() => undefined);
    const prev = getSession(info.code);
    setSession(info.code, { ...(prev?.hostKey ? { hostKey: prev.hostKey } : {}), name: name.trim(), vest: noVest ? undefined : vest });
    nav(`/play/${info.code}`);
  };

  const onScan = (text: string) => {
    setScan(false);
    // Invite QRs hold the join link; a bare 4-letter code works too.
    const m = text.match(/\/join\/([A-Za-z]{4})/) ?? text.trim().match(/^([A-Za-z]{4})$/);
    if (m) setCode(m[1].toUpperCase());
    else setErr("That QR isn't a Zombie Run invite.");
  };

  return (
    <div className="page">
      <TopBar title="Join a game" back="/" />
      {error && (
        <div className="mb-4">
          <ErrorBox>{error}</ErrorBox>
        </div>
      )}
      <label className="label" htmlFor="jcode">
        Game code
      </label>
      <div className="relative mb-3">
        <input
          id="jcode"
          className={`field text-center font-mono text-4xl font-bold uppercase tracking-[.45em] ${info ? 'border-brand/70' : lookup === 'missing' ? 'border-blood/70' : ''}`}
          maxLength={4}
          placeholder="ABCD"
          value={code}
          autoComplete="off"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="go"
          autoFocus={!code}
          onChange={(e) => setCode(e.target.value.replace(/[^a-zA-Z]/g, '').toUpperCase())}
        />
        <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2">
          {lookup === 'loading' && <Loader2 size={20} className="animate-spin text-dim" />}
          {info && <CircleCheck size={22} className="text-brand" />}
        </span>
      </div>
      {!info && (
        <button className="btn-ghost mb-4 w-full" onClick={() => setScan(true)}>
          <ScanLine size={18} className="text-ink" /> Scan the invite QR
        </button>
      )}
      {lookup === 'missing' && <ErrorBox>No game with code {code}. Check with your host.</ErrorBox>}
      {scan && <QrScanner onResult={onScan} onClose={() => setScan(false)} />}

      {info && meta && (
        <>
          <div
            className="rise card mb-6 flex items-center gap-4 p-4"
            style={{ background: 'var(--color-panel)' }}
          >
            <GameBadge color={meta.color} emoji={meta.emoji} size="lg" />
            <div className="min-w-0">
              <div className="truncate text-lg font-extrabold">{info.title}</div>
              <div className="flex items-center gap-1.5 text-sm text-dim">
                <Users size={14} /> {info.players} in · {meta.name}
                {info.phase !== 'lobby' && <span className="chip bg-gold/15 py-0.5 text-gold">started</span>}
              </div>
            </div>
          </div>

          <label className="label" htmlFor="jname">
            Your name
          </label>
          <input
            id="jname"
            className="field mb-5"
            placeholder="What should we call you?"
            maxLength={24}
            autoComplete="nickname"
            enterKeyHint="next"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />

          {/* Teams are dealt by the server when the game starts (late joiners start as zombies). */}
          <div className="mb-5 flex items-center gap-3 rounded-[26px] bg-raise p-4">
            <div className="flex shrink-0 -space-x-3">
              <Mascot team="survivor" size={52} />
              <Mascot team="zombie" size={52} />
            </div>
            <div className="min-w-0">
              <div className="font-display text-[17px]">Zombie or survivor?</div>
              <div className="text-[13px] font-semibold leading-snug text-ink/65">
                {info.phase === 'lobby'
                  ? 'The game deals the teams at random when it starts.'
                  : 'This game has started, so you join as a zombie.'}
              </div>
            </div>
          </div>

          <label className="label" htmlFor="jvest">
            Your vest number
          </label>
          {!noVest && (
            <input
              id="jvest"
              className="field mb-3 text-center font-mono text-4xl font-bold tracking-[.5em]"
              inputMode="numeric"
              pattern="[0-9]*"
              enterKeyHint="done"
              placeholder="000"
              maxLength={3}
              value={vest}
              onChange={(e) => setVest(e.target.value.replace(/\D/g, '').slice(0, 3))}
            />
          )}
          {!noVest && (
            <button className="btn-ghost mb-4 w-full" onClick={() => setScanVest(true)}>
              <ScanLine size={18} className="text-brand" /> Scan my vest's QR instead
            </button>
          )}
          {scanVest && (
            <QrScanner
              hint="Point at the QR on your own vest"
              onClose={() => setScanVest(false)}
              onResult={(t) => {
                setScanVest(false);
                const v = parseVestQr(t);
                if (v) setVest(v.vest);
                else setErr("That's not a Zombie Run vest QR. Ask your host for a printed vest.");
              }}
            />
          )}
          <div className="card mb-4">
            <SwitchRow
              icon={<Shirt size={18} />}
              tone="text-gold"
              title="No printed vest?"
              desc="We'll give you a number. Without a QR on your back, when a zombie catches you, tap “I got infected” and type the code from their phone."
              checked={noVest}
              onChange={setNoVest}
            />
          </div>
          <p className="flex items-start gap-2 text-xs leading-snug text-dim">
            <Lock size={14} className="mt-px shrink-0" /> Your location is shared with the game only while it's running, and the game never stores it. Your run map (beta) stays on this phone.
          </p>

          {err && (
            <div className="mt-4">
              <ErrorBox>{err}</ErrorBox>
            </div>
          )}
          <ActionBar>
            <button className="btn-brand w-full text-lg" disabled={!name.trim() || !vestOk || busy} onClick={submit}>
              {busy ? 'Joining…' : <>Join {meta.name} <ArrowRight size={20} strokeWidth={2.6} /></>}
            </button>
          </ActionBar>
        </>
      )}
      {!info && err && <ErrorBox>{err}</ErrorBox>}
    </div>
  );
}
