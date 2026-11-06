import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { BIB_RE, GAMES, ROOM_CODE_RE, cleanName, type RoomPreview } from '@runnn/shared';
import { GameMap } from '../components/GameMap.tsx';
import { Button, Card, ErrorBox, Field, Input, Page, Pill } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { getLastName, getSession, setLastName, setSession } from '../lib/storage.ts';
import { minutes } from '../lib/time.ts';

export function Join() {
  const params = useParams();
  const nav = useNavigate();
  const [code, setCode] = useState((params.code ?? '').toUpperCase());
  const [name, setName] = useState(getLastName());
  const [bib, setBib] = useState('');
  const [noBib, setNoBib] = useState(false);
  const [room, setRoom] = useState<RoomPreview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const valid = ROOM_CODE_RE.test(code);

  useEffect(() => {
    setRoom(null);
    setErr(null);
    if (!valid) return;
    // Already in this game on this phone: go straight back in.
    const s = getSession(code);
    if (s.playerId || s.organiserKey) return void nav(`/play/${code}`, { replace: true });
    let live = true;
    api<RoomPreview>(`/rooms/${code}`)
      .then((r) => live && setRoom(r))
      .catch((e) => live && setErr(e.message));
    return () => {
      live = false;
    };
  }, [code, valid, nav]);

  const needsBib = room ? GAMES[room.game].needsBibs : true;
  const bibOk = noBib || BIB_RE.test(bib);
  const nameOk = cleanName(name).length > 0;

  const go = () => {
    if (!room || !nameOk || !bibOk) return;
    setBusy(true);
    setLastName(cleanName(name));
    setSession(code, { name: cleanName(name), bib: noBib ? undefined : bib });
    nav(`/play/${code}`);
  };

  return (
    <Page title="Join a game" back="/">
      <Field label="Game code" help="Four letters or numbers from the organiser.">
        <Input
          autoFocus={!code}
          autoCapitalize="characters"
          autoComplete="off"
          maxLength={4}
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4))}
          className="text-center text-3xl font-black tracking-[0.4em]"
          placeholder="ABCD"
        />
      </Field>

      {err && <ErrorBox>{err}</ErrorBox>}

      {room && (
        <>
          <Card className="mb-4 overflow-hidden p-0">
            <div className="h-36">
              <GameMap boundary={room.boundary} fitKey={room.code} interactive={false} />
            </div>
            <div className="p-4">
              <div className="flex items-center gap-2">
                <h2 className="flex-1 truncate text-xl font-black">{room.title}</h2>
                <Pill>{room.phase === 'lobby' ? 'In lobby' : room.phase === 'ended' ? 'Finished' : 'Playing'}</Pill>
              </div>
              <div className="mt-1 text-sm text-dim">
                {GAMES[room.game].emoji} {GAMES[room.game].name} · {minutes(room.config.durationSecs)} · {room.players} joined
              </div>
              {room.phase !== 'lobby' && room.phase !== 'ended' && (
                <p className="mt-2 text-sm font-semibold">A round is running. You will join as a hunter.</p>
              )}
            </div>
          </Card>

          <Field label="Your name">
            <Input value={name} maxLength={24} onChange={(e) => setName(e.target.value)} placeholder="What should people call you?" autoComplete="nickname" />
          </Field>

          {needsBib && (
            <Field
              label="Your bib number"
              help={noBib ? 'Without a bib you can only be caught with a claim code.' : 'The 3-digit number printed on the QR pinned to your back.'}
              error={!noBib && bib.length === 3 && !bibOk ? 'Bib numbers are 3 digits.' : null}
            >
              <Input
                inputMode="numeric"
                maxLength={3}
                value={bib}
                disabled={noBib}
                onChange={(e) => setBib(e.target.value.replace(/\D/g, '').slice(0, 3))}
                placeholder="104"
                className="text-center text-2xl font-black tracking-[0.3em]"
              />
              <label className="mt-2 flex items-center gap-2 px-1 text-sm font-semibold">
                <input type="checkbox" checked={noBib} onChange={(e) => setNoBib(e.target.checked)} className="size-4 accent-[var(--color-ink)]" />
                I don’t have a bib
              </label>
            </Field>
          )}

          <Button block size="lg" onClick={go} loading={busy} disabled={!nameOk || (needsBib && !bibOk)}>
            Join {room.title}
          </Button>
        </>
      )}
    </Page>
  );
}
