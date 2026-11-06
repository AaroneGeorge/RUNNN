import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { EMAIL_RE, normalizeEmail } from '@kalikkam/shared';
import { ArrowLeft, ArrowRight, Check, KeyRound, Mail, UserRound } from 'lucide-react';
import { ApiError, api, ensureProfile, hostSignIn, requestEmailCode, verifyEmailCode } from '../lib/api.ts';
import { getProfile, lastName, rememberName, setProfile, setWelcomed } from '../lib/storage.ts';
import { unlockAudio } from '../lib/sound.ts';
import { notify } from '../lib/toast.ts';
import { Mascot, Sparkle } from '../components/Mascot.tsx';
import { Wordmark } from '../components/Brand.tsx';
import { SceneRadar, SceneScan, SceneTeams } from '../components/Scenes.tsx';

type Step = 'splash' | 'tour' | 'signin' | 'host' | 'email' | 'code' | 'name';
const ORDER: Step[] = ['splash', 'tour', 'signin', 'host', 'email', 'code', 'name'];

const TOUR = [
  { title: 'Random teams', body: 'Zombie or survivor: the game deals the teams at random when it starts. Everyone wears a QR code on their back.', Scene: SceneTeams },
  { title: 'Watch your radar', body: 'No map, no names. Just who’s within 10 m of you, and which team they’re on.', Scene: SceneRadar },
  { title: 'Scan to infect', body: 'Zombies hold their camera on a survivor’s back QR. Survivors run, so the scan breaks.', Scene: SceneScan },
];

/**
 * First launch: splash, a three-card tour, then join as a guest (name only). Hosts sign in with the username and
 * password the organisers gave them. Email (a 6-digit code; the profile then works on any phone) is offered later,
 * after a game and on the profile. `?step=` opens a step directly; `?next=` is where a host goes after signing in.
 */
export function WelcomePage() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const startStep = (params.get('step') as Step | null) ?? 'splash';
  const [step, setStepRaw] = useState<Step>(ORDER.includes(startStep) ? startStep : 'splash');
  const [dir, setDir] = useState<'in' | 'back'>('in');
  const [email, setEmail] = useState(getProfile()?.email ?? '');
  const [delivery, setDelivery] = useState<'email' | 'console'>('email');

  const go = (next: Step) => {
    setDir(ORDER.indexOf(next) >= ORDER.indexOf(step) ? 'in' : 'back');
    setStepRaw(next);
  };
  const finish = (msg: string) => {
    setWelcomed();
    notify(msg, 'good');
    nav('/', { replace: true });
  };

  return (
    <div className="min-h-dvh">
      {step === 'splash' && <Splash onDone={() => go('tour')} />}
      {step === 'tour' && <Tour onDone={() => go('signin')} />}
      {step !== 'splash' && step !== 'tour' && (
        <div key={step} className={`page ${dir === 'in' ? 'step-in' : 'step-back'}`}>
          {step === 'signin' && <SignIn onGuest={(name) => finish(`Welcome, ${name}!`)} onHost={() => go('host')} />}
          {step === 'host' && (
            <HostStep
              onBack={() => go('signin')}
              onSignedIn={(username) => {
                setWelcomed();
                notify(`Signed in as host ${username}`, 'good');
                const next = params.get('next');
                nav(next && next.startsWith('/') ? next : '/hq', { replace: true });
              }}
            />
          )}
          {step === 'email' && (
            <EmailStep
              initial={email}
              onBack={() => go('signin')}
              onSent={(e, d) => {
                setEmail(e);
                setDelivery(d);
                go('code');
              }}
            />
          )}
          {step === 'code' && (
            <CodeStep
              email={email}
              delivery={delivery}
              onBack={() => go('email')}
              onSignedIn={(created, name) => (created ? go('name') : finish(`Signed in as ${name}`))}
            />
          )}
          {step === 'name' && <NameStep onDone={(name) => finish(`Welcome, ${name}!`)} />}
        </div>
      )}
    </div>
  );
}

// ---- Splash -------------------------------------------------------------------------------------------

function Splash({ onDone }: { onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 2200);
    return () => clearTimeout(t);
  }, [onDone]);
  return (
    <button
      aria-label="Start"
      className="fixed inset-0 flex flex-col items-center justify-center overflow-hidden bg-sun bg-[length:560px] bg-topo px-6"
      onClick={onDone}
    >
      <Sparkle size={26} fill="#fff" className="rise-in absolute left-[16%] top-[20%] [animation-delay:700ms]" />
      <Sparkle size={16} fill="#fff" className="rise-in absolute right-[18%] top-[28%] [animation-delay:820ms]" />
      <Wordmark className="text-[clamp(44px,14vw,72px)]" />
      <div className="rise-in font-display mt-3 rounded-full bg-panel px-4 py-1.5 text-sm uppercase [animation-delay:420ms]">Outdoor tag · Kochi</div>
      <div className="mt-10 flex items-end">
        <Mascot team="survivor" mood="scared" size={118} live className="rise-in [animation-delay:560ms]" />
        <Mascot team="zombie" mood="happy" size={156} live className="rise-in -ml-3 [animation-delay:640ms]" />
      </div>
    </button>
  );
}

// ---- Tour ---------------------------------------------------------------------------------------------

/** Three cards on a track: swipe or tap Next; the track follows the finger and settles with the UI curve. */
function Tour({ onDone }: { onDone: () => void }) {
  const [i, setI] = useState(0);
  const [drag, setDrag] = useState(0);
  const start = useRef<{ x: number; w: number } | null>(null);
  const last = i === TOUR.length - 1;
  const next = () => (last ? onDone() : setI(i + 1));

  const down = (e: ReactPointerEvent<HTMLDivElement>) => {
    start.current = { x: e.clientX, w: e.currentTarget.offsetWidth };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move = (e: ReactPointerEvent) => {
    if (!start.current) return;
    let dx = e.clientX - start.current.x;
    // Resist past the first and last card instead of stopping dead.
    if ((i === 0 && dx > 0) || (last && dx < 0)) dx = Math.sign(dx) * Math.sqrt(Math.abs(dx)) * 4;
    setDrag(dx);
  };
  const up = () => {
    const s = start.current;
    start.current = null;
    if (!s) return;
    if (drag < -s.w * 0.2 && !last) setI(i + 1);
    else if (drag > s.w * 0.2 && i > 0) setI(i - 1);
    setDrag(0);
  };

  return (
    <div className="mx-auto flex min-h-dvh max-w-xl flex-col px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))]">
      <div className="flex items-center justify-between">
        <span className="font-display text-lg lowercase">zombie run</span>
        <button className="btn-ghost btn-sm" onClick={onDone}>
          Skip
        </button>
      </div>
      <div className="relative -mx-4 mt-4 flex-1 overflow-hidden" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} style={{ touchAction: 'pan-y' }}>
        <div
          className="flex h-full"
          style={{
            transform: `translateX(calc(${-i * 100}% + ${drag}px))`,
            transition: start.current ? 'none' : 'transform 320ms var(--ease-out)',
          }}
        >
          {TOUR.map(({ title, body, Scene }, k) => (
            <section key={title} className="flex w-full shrink-0 flex-col px-4" aria-hidden={k !== i}>
              <div className="h-[min(58dvh,460px)]">
                <Scene active={k === i} />
              </div>
              <h1 className="font-display mt-7 text-[34px]">{title}</h1>
              <p className="mt-2 max-w-sm text-[17px] font-semibold leading-snug text-ink/70">{body}</p>
            </section>
          ))}
        </div>
      </div>
      <div className="mt-4 flex items-center justify-between">
        <div className="flex gap-1.5" aria-label={`Card ${i + 1} of ${TOUR.length}`}>
          {TOUR.map((_, k) => (
            <span key={k} className={`h-2 rounded-full transition-[width,background-color] duration-200 ease-[var(--ease-out)] ${k === i ? 'w-7 bg-sun ring-2 ring-ink' : 'w-2 bg-ink'}`} />
          ))}
        </div>
        <button className="btn-brand px-7 text-lg" onClick={next}>
          {last ? "Let's play" : 'Next'} <ArrowRight size={20} strokeWidth={2.6} />
        </button>
      </div>
    </div>
  );
}

// ---- Sign in ------------------------------------------------------------------------------------------

function Heading({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <>
      <h1 className="font-display text-[34px]">{title}</h1>
      {children && <p className="mt-2 text-[16px] font-semibold leading-snug text-ink/70">{children}</p>}
    </>
  );
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button aria-label="Back" className="press mb-5 grid h-12 w-12 place-items-center rounded-full bg-panel" onClick={onClick}>
      <ArrowLeft size={22} strokeWidth={2.4} />
    </button>
  );
}

function ErrorLine({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="mt-3 text-sm font-bold text-blood">
      {children}
    </p>
  );
}

/** Players join with just a name. Hosts sign in below, in small type: most people never need it. */
function SignIn({ onGuest, onHost }: { onGuest: (name: string) => void; onHost: () => void }) {
  const [name, setName] = useState(lastName());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const guest = async () => {
    const n = name.trim();
    if (!n) return;
    setBusy(true);
    setErr('');
    unlockAudio();
    rememberName(n);
    try {
      await ensureProfile(n);
      onGuest(n);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <div className="flex min-h-[calc(100dvh-3rem)] flex-col">
      <div className="mb-4 flex justify-center pt-4">
        <Wordmark className="text-[34px]" />
      </div>
      {/* The zombie peeks over the card: the character breaking out of its frame, as on Home. */}
      <div className="relative mt-28">
        <Mascot team="zombie" mood="happy" size={130} live className="pointer-events-none absolute -top-[104px] right-4" />
        <div className="card relative p-5">
          <Heading title="Join the hunt">Just your name and you're in.</Heading>
          <label className="label mt-5" htmlFor="gname">
            Your name
          </label>
          <input
            id="gname"
            className="field"
            placeholder="What should we call you?"
            maxLength={24}
            autoComplete="nickname"
            enterKeyHint="go"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && guest()}
          />
          <button className="btn-brand mt-3 w-full justify-between px-6 text-lg" disabled={!name.trim() || busy} onClick={guest}>
            {busy ? 'Joining…' : 'Play as guest'} <UserRound size={20} strokeWidth={2.4} />
          </button>
          <p className="mt-2 text-center text-xs font-semibold text-dim">Your XP stays on this phone. You can add your email after a game.</p>
          {err && <ErrorLine>{err}</ErrorLine>}
        </div>
      </div>
      <p className="mt-6 text-center text-sm font-semibold text-dim">
        Got a game code?{' '}
        <Link to="/join" className="font-bold text-ink underline decoration-2 underline-offset-4" onClick={setWelcomed}>
          Join a game
        </Link>
      </p>
      <button className="mx-auto mt-auto flex items-center gap-1.5 pt-8 text-xs font-semibold text-dim active:text-ink" onClick={onHost}>
        <KeyRound size={13} /> Sign in as host
      </button>
    </div>
  );
}

/** Hosts: the username and password the organisers set up. Hosts run games, plan events and see game logs. */
function HostStep({ onBack, onSignedIn }: { onBack: () => void; onSignedIn: (username: string) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const submit = async () => {
    if (!username.trim() || !password) return;
    setBusy(true);
    setErr('');
    try {
      const s = await hostSignIn(username.trim(), password);
      onSignedIn(s.username);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <div className="flex min-h-[calc(100dvh-3rem)] flex-col">
      <BackButton onClick={onBack} />
      <div className="card mt-4 p-5">
        <Heading title="Host sign-in">For organisers: run games, plan events and see what happened in each game.</Heading>
        <label className="label mt-5" htmlFor="huser">
          Username
        </label>
        <input
          id="huser"
          className="field"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="next"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <label className="label mt-4" htmlFor="hpass">
          Password
        </label>
        <input
          id="hpass"
          className="field"
          type="password"
          autoComplete="current-password"
          enterKeyHint="go"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
        {err && <ErrorLine>{err}</ErrorLine>}
        <button className="btn-brand mt-5 w-full justify-between px-6 text-lg" disabled={!username.trim() || !password || busy} onClick={submit}>
          {busy ? 'Signing in…' : 'Sign in'} <ArrowRight size={20} strokeWidth={2.6} />
        </button>
      </div>
      <p className="mt-auto pt-6 text-center text-xs font-semibold text-dim">No host account? Ask the Zombie Run organisers for one.</p>
    </div>
  );
}

function EmailStep({ initial, onBack, onSent }: { initial: string; onBack: () => void; onSent: (email: string, d: 'email' | 'console') => void }) {
  const [email, setEmail] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const valid = EMAIL_RE.test(normalizeEmail(email));
  const send = async () => {
    if (!valid) return setErr('That email address looks wrong.');
    setBusy(true);
    setErr('');
    try {
      const r = await requestEmailCode(email);
      onSent(normalizeEmail(email), r.delivery);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <>
      <BackButton onClick={onBack} />
      <Heading title="Your email">We’ll send a 6-digit code. No password to remember.</Heading>
      <label className="label mt-6" htmlFor="email">
        Email
      </label>
      <input
        id="email"
        className="field"
        type="email"
        inputMode="email"
        autoComplete="email"
        autoCapitalize="none"
        enterKeyHint="send"
        placeholder="you@example.com"
        value={email}
        autoFocus
        onChange={(e) => setEmail(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && send()}
      />
      {err && <ErrorLine>{err}</ErrorLine>}
      <button className="btn-brand mt-4 w-full justify-between px-6 text-lg" disabled={!email.trim() || busy} onClick={send}>
        {busy ? 'Sending…' : 'Send me a code'} <ArrowRight size={20} strokeWidth={2.6} />
      </button>
    </>
  );
}

/** Six boxes over one real input (so paste, autofill from the email, and the numeric keypad all work). */
function CodeStep({ email, delivery, onBack, onSignedIn }: { email: string; delivery: 'email' | 'console'; onBack: () => void; onSignedIn: (created: boolean, name: string) => void }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [shakeKey, setShakeKey] = useState(0);
  const [done, setDone] = useState(false);
  const [wait, setWait] = useState(30);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait(wait - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  const check = async (c: string) => {
    setBusy(true);
    setErr('');
    try {
      const r = await verifyEmailCode(email, c);
      setDone(true);
      // Let the tick land before moving on.
      setTimeout(() => onSignedIn(r.created, r.profile.name), 450);
    } catch (e) {
      setErr((e as Error).message);
      setShakeKey((k) => k + 1);
      setCode('');
      setBusy(false);
      input.current?.focus();
    }
  };
  const onChange = (v: string) => {
    const digits = v.replace(/\D/g, '').slice(0, 6);
    setCode(digits);
    if (digits.length === 6) void check(digits);
  };
  const resend = async () => {
    setErr('');
    try {
      await requestEmailCode(email);
      setWait(30);
      notify('New code sent', 'good');
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Could not send a new code.');
    }
  };

  return (
    <>
      <BackButton onClick={onBack} />
      <Heading title="Check your email">
        We sent a 6-digit code to <span className="text-ink">{email}</span>.
      </Heading>
      {delivery === 'console' && (
        <p className="mt-3 rounded-2xl bg-sun-soft px-4 py-2.5 text-sm font-bold">Test mode: no email service is set up, so the code is printed in the server console.</p>
      )}
      <label htmlFor="otp" className="sr-only">
        6-digit code
      </label>
      <div key={shakeKey} className={`relative mt-6 ${shakeKey ? 'shake' : ''}`} onClick={() => input.current?.focus()}>
        <input
          id="otp"
          ref={input}
          className="absolute inset-0 h-full w-full opacity-0"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={code}
          disabled={busy && !err}
          autoFocus
          onChange={(e) => onChange(e.target.value)}
        />
        <div className="pointer-events-none grid grid-cols-6 gap-2" aria-hidden>
          {Array.from({ length: 6 }, (_, k) => {
            const ch = code[k];
            const current = k === code.length && !done;
            return (
              <div
                key={k}
                className={`font-display font-mono grid h-16 place-items-center rounded-2xl border-[2.5px] bg-panel text-[28px] transition-[border-color,background-color] duration-150 ${
                  done ? 'border-ink bg-sun' : err ? 'border-blood' : current ? 'border-ink' : ch ? 'border-ink/60' : 'border-ink/15'
                }`}
              >
                {ch ?? ''}
              </div>
            );
          })}
        </div>
      </div>
      {done && (
        <div className="bump-in mt-5 flex items-center justify-center gap-2 font-bold">
          <span className="grid h-7 w-7 place-items-center rounded-full bg-ink text-night">
            <Check size={16} strokeWidth={3} />
          </span>
          Signed in
        </div>
      )}
      {err && <ErrorLine>{err}</ErrorLine>}
      {!done && (
        <div className="mt-6 flex items-center justify-between text-sm font-bold">
          <button className="text-dim underline decoration-2 underline-offset-4" onClick={onBack}>
            Use a different email
          </button>
          <button className="disabled:text-dim" disabled={wait > 0} onClick={resend}>
            {wait > 0 ? `Resend in 0:${String(wait).padStart(2, '0')}` : 'Resend code'}
          </button>
        </div>
      )}
    </>
  );
}

/** New email accounts start with the email's first part as their name: offer to change it once. */
function NameStep({ onDone }: { onDone: (name: string) => void }) {
  const p = getProfile();
  const [name, setName] = useState(p?.name ?? '');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const n = name.trim();
    if (!n) return;
    setBusy(true);
    try {
      await api('/api/me', { method: 'PATCH', body: { name: n } });
      if (p) setProfile({ ...p, name: n });
      rememberName(n);
    } finally {
      onDone(n);
    }
  };
  return (
    <>
      <div className="mb-6 flex justify-center pt-6">
        <Mascot team="survivor" mood="happy" size={120} live className="mascot-hop" />
      </div>
      <Heading title="You’re in!">What should other players call you?</Heading>
      <label className="label mt-6" htmlFor="pname">
        Player name
      </label>
      <input id="pname" className="field" maxLength={24} autoComplete="nickname" enterKeyHint="done" value={name} autoFocus onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} />
      <button className="btn-brand mt-4 w-full justify-between px-6 text-lg" disabled={!name.trim() || busy} onClick={save}>
        Let’s play <ArrowRight size={20} strokeWidth={2.6} />
      </button>
    </>
  );
}
