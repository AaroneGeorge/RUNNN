import { Award, BadgeCheck, LogOut, Mail, Pencil, Settings as SettingsIcon } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { cleanName, levelProgress, type HistoryItem, type MeResponse, type Profile } from '@runnn/shared';
import { Mascot } from '../components/Mascot.tsx';
import { WorldLogin } from '../components/WorldLogin.tsx';
import { Avatar, Button, Card, ErrorBox, Field, IconButton, Input, ListRow, Loading, Page, Pill, Section, Sheet, Stat } from '../components/ui.tsx';
import { Points } from '../game/bits.tsx';
import { api, useApi } from '../lib/api.ts';
import { rankTitle } from '../lib/rank.ts';
import { getLastName, setLastName, setProfileToken, useProfileToken } from '../lib/storage.ts';
import { ago } from '../lib/time.ts';
import { notify, toastError } from '../lib/toast.ts';

function LevelBar({ xp }: { xp: number }) {
  const { level, into, span } = levelProgress(xp);
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-bold">
          Level {level} · {rankTitle(level)}
        </span>
        <span className="text-xs font-bold text-dim tabular">
          {into}/{span} XP
        </span>
      </div>
      <div className="mt-1.5 h-3 overflow-hidden rounded-full bg-sunk">
        <div className="h-full rounded-full bg-accent transition-[width] duration-700" style={{ width: `${(into / span) * 100}%` }} />
      </div>
    </div>
  );
}

function ProfileHead({ p }: { p: Profile }) {
  return (
    <>
      <div className="flex items-center gap-4">
        <Avatar name={p.name} size={64} />
        <div className="min-w-0">
          <h2 className="flex items-center gap-1.5 truncate text-2xl font-black">
            {p.name}
            {p.humanVerified && <BadgeCheck className="size-6 shrink-0 text-good" aria-label="Verified human" />}
          </h2>
          <div className="text-sm text-dim">Playing since {new Date(p.createdAt).toLocaleDateString([], { month: 'short', year: 'numeric' })}</div>
        </div>
      </div>
      <Card className="mt-4">
        <LevelBar xp={p.xp} />
      </Card>
      <div className="mt-3 grid grid-cols-4 gap-2">
        <Stat label="Games" value={p.gamesPlayed} />
        <Stat label="Wins" value={p.wins} />
        <Stat label="Best 🏃" value={p.best.runner ?? '—'} />
        <Stat label="Best 🎯" value={p.best.hunter ?? '—'} />
      </div>
      {p.badges.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {p.badges.map((b) => (
            <Pill key={b.id} className="h-8 text-sm">
              {b.emoji} {b.name}
            </Pill>
          ))}
        </div>
      )}
    </>
  );
}

function History({ items }: { items: HistoryItem[] }) {
  if (!items.length) return <Card className="text-center text-sm text-dim">No games yet. Join one!</Card>;
  return (
    <Card className="py-1">
      {items.map((h) => (
        <ListRow
          key={h.resultId}
          title={`${h.won ? '🏆 ' : ''}${h.title}`}
          sub={`${ago(h.endedAt)} · dealt ${h.role ?? '—'} · +${h.xp} XP`}
          right={<Points points={h.points} className="text-sm" />}
        />
      ))}
    </Card>
  );
}

function EmailSignIn({ onDone, guest }: { onDone: () => void; guest: boolean }) {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const start = async () => {
    setBusy(true);
    setErr(null);
    try {
      await api('/auth/email/start', { body: { email } });
      setSent(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const verify = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ token: string; profile: Profile; linked: boolean }>('/auth/email/verify', { body: { email, code } });
      setProfileToken(r.token);
      setLastName(r.profile.name);
      notify(r.linked ? 'Email saved. Your XP is safe.' : `Signed in as ${r.profile.name}`, 'good');
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <p className="mb-4 text-dim">
        {guest ? 'Add your email so you can sign in on another phone and keep your XP.' : 'We’ll email you a 6-digit code. No password.'}
      </p>
      <Field label="Email">
        <Input type="email" autoComplete="email" value={email} disabled={sent} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      {sent && (
        <Field label="Code from the email" help="It works for 10 minutes.">
          <Input
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            className="text-center text-2xl font-black tracking-[0.4em]"
          />
        </Field>
      )}
      {err && <ErrorBox>{err}</ErrorBox>}
      <div className="mt-4 mb-4">
        {sent ? (
          <Button block size="lg" loading={busy} disabled={code.length !== 6} onClick={verify}>
            Verify
          </Button>
        ) : (
          <Button block size="lg" loading={busy} disabled={!email.includes('@')} onClick={start}>
            Send code
          </Button>
        )}
      </div>
    </div>
  );
}

export function Me() {
  const token = useProfileToken();
  const nav = useNavigate();
  const me = useApi<MeResponse>(token ? '/me' : null, [token]);
  const [name, setName] = useState(getLastName());
  const [busy, setBusy] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [newName, setNewName] = useState('');

  const create = async () => {
    setBusy(true);
    try {
      const r = await api<{ token: string; profile: Profile }>('/profile', { body: { name } });
      setProfileToken(r.token);
      setLastName(r.profile.name);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };

  const settings = (
    <Link to="/settings">
      <IconButton label="Settings">
        <SettingsIcon className="size-5" />
      </IconButton>
    </Link>
  );

  if (!token) {
    return (
      <Page title="Profile" actions={settings}>
        <div className="flex flex-col items-center text-center">
          <Mascot mood="wait" />
          <h2 className="mt-2 text-2xl font-black">Keep your XP</h2>
          <p className="mt-1 max-w-xs text-dim">A profile tracks your games, levels and badges. Just a name, no password.</p>
        </div>
        <Card className="mt-6">
          <Field label="Your name">
            <Input value={name} maxLength={24} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Button block size="lg" loading={busy} disabled={!cleanName(name)} onClick={create}>
            Make my profile
          </Button>
        </Card>
        <div className="mt-3">
          <WorldLogin name={cleanName(name) || undefined} />
        </div>
        <Button variant="ghost" block className="mt-2" icon={<Mail className="size-5" />} onClick={() => setEmailOpen(true)}>
          I have one: sign in with email
        </Button>
        <Sheet open={emailOpen} onClose={() => setEmailOpen(false)} title="Sign in with email">
          <EmailSignIn guest={false} onDone={() => setEmailOpen(false)} />
        </Sheet>
      </Page>
    );
  }

  if (me.error) return <Page title="Profile" actions={settings}><ErrorBox onRetry={me.reload}>{me.error}</ErrorBox></Page>;
  if (!me.data) return <Loading />;
  const { profile, history, email } = me.data;

  const rename = async () => {
    try {
      me.setData(await api<MeResponse>('/me', { method: 'PATCH', body: { name: newName } }));
      setLastName(cleanName(newName));
      setRenameOpen(false);
    } catch (e) {
      toastError(e);
    }
  };

  return (
    <Page
      title="Profile"
      actions={
        <>
          <IconButton
            label="Rename"
            onClick={() => {
              setNewName(profile.name);
              setRenameOpen(true);
            }}
          >
            <Pencil className="size-5" />
          </IconButton>
          {settings}
        </>
      }
    >
      <ProfileHead p={profile} />
      {!email && (
        <Card className="mt-4 flex items-center gap-3" onClick={() => setEmailOpen(true)}>
          <Mail className="size-6 shrink-0" />
          <div className="flex-1 text-sm">
            <div className="font-extrabold">Save your progress</div>
            <div className="text-dim">Add an email so a lost phone doesn’t mean lost XP.</div>
          </div>
        </Card>
      )}
      {!profile.humanVerified && (
        <div className="mt-3">
          <WorldLogin mode="verify" onDone={me.reload} />
        </div>
      )}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button variant="secondary" icon={<Award className="size-5" />} onClick={() => nav('/achievements')}>
          Badges
        </Button>
        <Button variant="secondary" onClick={() => nav(`/u/${profile.id}`)}>
          Public page
        </Button>
      </div>
      <Section title="Recent games">
        <History items={history} />
      </Section>
      {email && <p className="mt-6 text-center text-sm text-dim">Signed in as {email}</p>}
      <Button
        variant="ghost"
        block
        className="mt-2"
        icon={<LogOut className="size-5" />}
        onClick={() => {
          if (email || confirm('Without an email you cannot get this profile back. Sign out anyway?')) setProfileToken(null);
        }}
      >
        Sign out on this phone
      </Button>

      <Sheet open={emailOpen} onClose={() => setEmailOpen(false)} title="Add your email">
        <EmailSignIn
          guest
          onDone={() => {
            setEmailOpen(false);
            me.reload();
          }}
        />
      </Sheet>
      <Sheet open={renameOpen} onClose={() => setRenameOpen(false)} title="Change name">
        <Field label="Name">
          <Input value={newName} maxLength={24} onChange={(e) => setNewName(e.target.value)} />
        </Field>
        <div className="mb-4">
          <Button block size="lg" disabled={!cleanName(newName)} onClick={rename}>
            Save
          </Button>
        </div>
      </Sheet>
    </Page>
  );
}

export function PublicProfile() {
  const { id } = useParams();
  const r = useApi<{ profile: Profile; history: HistoryItem[] }>(`/profiles/${id}`);
  if (r.error) return <Page title="Player" back><ErrorBox>{r.error}</ErrorBox></Page>;
  if (!r.data) return <Loading />;
  return (
    <Page title="Player" back>
      <ProfileHead p={r.data.profile} />
      <Section title="Recent games">
        <History items={r.data.history} />
      </Section>
    </Page>
  );
}
