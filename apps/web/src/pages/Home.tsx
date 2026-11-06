import { ChevronRight, Download, FlaskConical, LayoutDashboard, Plus, Printer, Settings as SettingsIcon, Ticket } from 'lucide-react';
import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router';
import { GAMES, type EventSummary, type RoomListing } from '@runnn/shared';
import { Wordmark } from '../components/Brand.tsx';
import { Mascot } from '../components/Mascot.tsx';
import { Button, Card, IconButton, ListRow, Pill, Section } from '../components/ui.tsx';
import { useApi } from '../lib/api.ts';
import { isIos, useInstall } from '../lib/install.ts';
import { recentSessions, useOrganiser, useSettings } from '../lib/storage.ts';
import { ago, when } from '../lib/time.ts';

export function Home() {
  const nav = useNavigate();
  const org = useOrganiser();
  const settings = useSettings();
  const install = useInstall();
  const rooms = useApi<{ rooms: RoomListing[] }>('/rooms');
  const events = useApi<{ events: EventSummary[] }>('/events');
  const recent = recentSessions().slice(0, 3);
  const live = rooms.data?.rooms.filter((r) => recent.some((s) => s.code === r.code)) ?? [];

  useEffect(() => {
    if (!settings.seenWelcome) nav('/welcome', { replace: true });
  }, [settings.seenWelcome, nav]);

  useEffect(() => {
    const id = setInterval(rooms.reload, 15_000);
    return () => clearInterval(id);
  }, [rooms.reload]);

  const next = events.data?.events.filter((e) => !e.cancelled && e.startsAt > Date.now() - 3600_000).slice(0, 3) ?? [];

  return (
    <div className="mx-auto max-w-xl px-4 pb-28">
      <header className="safe-top flex items-center justify-between pb-2">
        <Wordmark />
        <Link to="/settings">
          <IconButton label="Settings">
            <SettingsIcon className="size-5" />
          </IconButton>
        </Link>
      </header>

      <div className="mt-3 overflow-hidden rounded-3xl bg-ink p-5 text-night">
        <div className="flex items-center gap-2">
          <div className="flex-1">
            <h1 className="text-3xl font-black leading-tight">Run. Hide. Get scanned.</h1>
            <p className="mt-1 text-sm text-night/70">Outdoor chase games where the tag is a real QR on your back.</p>
          </div>
          <Mascot size={96} />
        </div>
        <Button block size="lg" className="mt-4" onClick={() => nav('/join')} icon={<Ticket className="size-5" />}>
          Join with a code
        </Button>
      </div>

      {live.length > 0 && (
        <Section title="Back into your game">
          {live.map((r) => (
            <Card key={r.code} className="mb-2" onClick={() => nav(`/play/${r.code}`)}>
              <ListRow
                title={r.title}
                sub={`${r.code} · ${r.players} players · ${r.phase}`}
                right={<Pill tone="accent">Rejoin</Pill>}
              />
            </Card>
          ))}
        </Section>
      )}

      {org && (
        <Section title={`Organiser · ${org.username}`}>
          <div className="grid grid-cols-2 gap-2">
            <Card onClick={() => nav('/host')} className="p-4">
              <Plus className="mb-2 size-6" />
              <div className="font-extrabold">Host a game</div>
              <div className="text-sm text-dim">Draw the area, go</div>
            </Card>
            <Card onClick={() => nav('/hq')} className="p-4">
              <LayoutDashboard className="mb-2 size-6" />
              <div className="font-extrabold">HQ</div>
              <div className="text-sm text-dim">Live rounds & logs</div>
            </Card>
            <Card onClick={() => nav('/kit')} className="p-4">
              <Printer className="mb-2 size-6" />
              <div className="font-extrabold">Print bibs</div>
              <div className="text-sm text-dim">Signed QR pack</div>
            </Card>
            <Card onClick={() => nav('/sim')} className="p-4">
              <FlaskConical className="mb-2 size-6" />
              <div className="font-extrabold">Simulate</div>
              <div className="text-sm text-dim">Bots only, up to 8×</div>
            </Card>
          </div>
        </Section>
      )}

      <Section title="Coming up" action={<Link to="/events" className="text-sm font-bold">All events</Link>}>
        <Card className="py-1">
          {next.length === 0 && <div className="py-4 text-center text-sm text-dim">No events scheduled yet.</div>}
          {next.map((e) => (
            <ListRow
              key={e.id}
              onClick={() => nav(`/events/${e.id}`)}
              left={<span className="text-2xl">{GAMES[e.game]?.emoji ?? '🏃'}</span>}
              title={e.title}
              sub={`${when(e.startsAt)} · ${e.place}`}
              right={e.mine ? <Pill tone="good">Going</Pill> : <ChevronRight className="size-5 text-dim" />}
            />
          ))}
        </Card>
      </Section>

      <Section title="Games">
        {Object.values(GAMES).map((g) => (
          <Card key={g.id} onClick={() => nav(`/games/${g.id}`)} className="mb-2">
            <ListRow left={<span className="text-3xl">{g.emoji}</span>} title={g.name} sub={g.tagline} right={<ChevronRight className="size-5 text-dim" />} />
          </Card>
        ))}
      </Section>

      {recent.length > 0 && live.length === 0 && (
        <Section title="Recent">
          <div className="space-y-1 px-1 text-sm text-dim">
            {recent.map((r) => (
              <div key={r.code}>
                {r.code} · {ago(r.at)}
              </div>
            ))}
          </div>
        </Section>
      )}

      {install.mode && (
        <Card className="mt-6 flex items-center gap-3">
          <Download className="size-6 shrink-0" />
          <div className="flex-1 text-sm">
            <div className="font-extrabold">Install the app</div>
            <div className="text-dim">
              {install.mode === 'ios' || isIos() ? 'Tap Share, then “Add to Home Screen”.' : 'Full screen, faster, works with a weak signal.'}
            </div>
          </div>
          {install.mode === 'prompt' && (
            <Button size="sm" onClick={install.install}>
              Install
            </Button>
          )}
        </Card>
      )}
    </div>
  );
}
