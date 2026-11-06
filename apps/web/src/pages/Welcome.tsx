import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Wordmark } from '../components/Brand.tsx';
import { Mascot } from '../components/Mascot.tsx';
import { MapScene, QrScene, TrophyScene } from '../components/Scenes.tsx';
import { Button, Card, ErrorBox, Field, Input, Sheet } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { setOrganiser, setProfileToken, setSettings } from '../lib/storage.ts';
import { notify } from '../lib/toast.ts';

const STEPS = [
  { art: <Mascot size={150} />, title: 'Outdoor chase, for real', body: 'Meet up in a park. The app deals hunters and runners at random. Then everyone runs.' },
  { art: <QrScene size={150} />, title: 'The tag is a camera', body: 'Everyone wears a numbered QR on their back. Hunters hold their camera on it for a few seconds to catch you.' },
  { art: <MapScene size={190} />, title: 'GPS is never the referee', body: 'The map keeps you inside the area and the radar beeps when someone is close. Only a real scan counts.' },
  { art: <TrophyScene size={140} />, title: 'Caught? Join the hunt', body: 'Caught runners become hunters and keep their points. Earn XP, badges and a spot on the leaderboard.' },
];

export function Welcome() {
  const nav = useNavigate();
  const [i, setI] = useState(0);
  const [signIn, setSignIn] = useState(false);
  const [user, setUser] = useState('');
  const [pw, setPw] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const step = STEPS[i];
  const last = i === STEPS.length - 1;

  const done = () => {
    setSettings({ seenWelcome: true });
    nav('/', { replace: true });
  };

  const login = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ token: string; username: string; profileToken: string }>('/organiser/login', { body: { username: user, password: pw } });
      setOrganiser({ token: r.token, username: r.username });
      setProfileToken(r.profileToken);
      notify(`Signed in as ${r.username}`, 'good');
      done();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-[100dvh] max-w-md flex-col px-6">
      <header className="safe-top flex items-center justify-between">
        <Wordmark />
        <button onClick={done} className="text-sm font-bold text-dim">
          Skip
        </button>
      </header>
      <div key={i} className="rise flex flex-1 flex-col items-center justify-center text-center">
        <div className="mb-8 grid h-48 place-items-center">{step.art}</div>
        <h1 className="text-3xl font-black tracking-tight">{step.title}</h1>
        <p className="mt-3 text-lg text-dim">{step.body}</p>
      </div>
      <div className="mb-6 flex justify-center gap-2">
        {STEPS.map((_, k) => (
          <span key={k} className={`h-2 rounded-full transition-all ${k === i ? 'w-6 bg-ink' : 'w-2 bg-line'}`} />
        ))}
      </div>
      <div className="safe-bottom grid gap-2 pb-4">
        <Button size="lg" block onClick={() => (last ? done() : setI(i + 1))}>
          {last ? 'Let’s play' : 'Next'}
        </Button>
        {last && (
          <Button variant="ghost" block onClick={() => setSignIn(true)}>
            I’m an organiser
          </Button>
        )}
      </div>

      <Sheet open={signIn} onClose={() => setSignIn(false)} title="Organiser sign-in">
        <Card className="mb-4 text-sm text-dim">Only organisers can create games and events. Ask whoever runs your server for an account.</Card>
        <Field label="Username">
          <Input autoCapitalize="none" autoComplete="username" value={user} onChange={(e) => setUser(e.target.value)} />
        </Field>
        <Field label="Password">
          <Input type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && login()} />
        </Field>
        {err && <ErrorBox>{err}</ErrorBox>}
        <div className="mt-4 mb-4">
          <Button block size="lg" loading={busy} disabled={!user || !pw} onClick={login}>
            Sign in
          </Button>
        </div>
      </Sheet>
    </div>
  );
}
