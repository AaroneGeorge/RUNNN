import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { GAMES, type EventItem, type Profile, type RoomListing, type Team } from '@kalikkam/shared';
import { api } from '../lib/api.ts';
import { getHost, getProfile, getSession, hasWelcomed } from '../lib/storage.ts';
import { fmtDateTime, relTime } from '../lib/time.ts';
import { GameBadge, LinkCard, Sheet } from '../components/ui.tsx';
import { Crosshair, Mascot, Sparkle, type Mood } from '../components/Mascot.tsx';
import { Wordmark } from '../components/Brand.tsx';
import { useInstall } from '../lib/install.ts';
import { ArrowRight, ChevronRight, Download, KeyRound, LayoutGrid, Share, SquarePlus, Star, Trophy, X } from 'lucide-react';

const PHASE_LABEL: Record<string, string> = { lobby: 'In the lobby', countdown: 'Starting', live: 'Playing now', paused: 'Paused', ended: 'Ended' };

export function Home() {
  const nav = useNavigate();
  const host = getHost();
  const [code, setCode] = useState('');
  const [rooms, setRooms] = useState<RoomListing[]>([]);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [xp, setXp] = useState<number | null>(null);

  // First launch with no profile: splash, tour and sign-in first. Join links skip this (they ask for a name).
  useEffect(() => {
    if (!getProfile() && !hasWelcomed()) nav('/welcome', { replace: true });
  }, [nav]);

  useEffect(() => {
    const load = () => {
      api<RoomListing[]>('/api/rooms').then(setRooms).catch(() => undefined);
    };
    load();
    api<EventItem[]>('/api/events').then(setEvents).catch(() => undefined);
    // Real XP only, and only once there is a profile: no placeholder scores.
    if (getProfile()) api<{ profile: Profile }>('/api/me').then((r) => setXp(r.profile.xp)).catch(() => undefined);
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, []);

  const go = () => {
    const c = code.trim().toUpperCase();
    if (/^[A-Z]{4}$/.test(c)) nav(getSession(c)?.playerId ? `/play/${c}` : `/join/${c}`);
  };

  return (
    <div className="page">
      <header className="mb-4 flex items-center justify-between">
        <Link to="/settings" aria-label="Settings" className="press grid h-12 w-12 place-items-center rounded-full bg-panel">
          <LayoutGrid size={20} strokeWidth={2.4} />
        </Link>
        {xp ? (
          <Link to="/me" className="flex items-center gap-1.5 text-lg font-extrabold">
            <span className="font-mono">{xp.toLocaleString('en-IN')}</span>
            <Star size={20} className="fill-sun text-ink" strokeWidth={2} /> <span className="sr-only">XP</span>
          </Link>
        ) : (
          <span className="font-display text-lg lowercase">zombie run</span>
        )}
        <Link to="/me" aria-label="Your profile" className="press grid h-12 w-12 place-items-center rounded-full bg-ink text-night">
          <Crosshair size={22} />
        </Link>
      </header>

      <InstallCard />

      {/* The game, and the most common thing people come here to do: type a code and join. */}
      <section className="relative mb-6 overflow-hidden rounded-[32px] bg-sun bg-[length:420px] bg-topo px-4 pb-4 pt-6">
        <Wordmark className="mx-auto text-[clamp(38px,12.5vw,58px)]" />
        <div className="mt-2 flex justify-center">
          <span className="font-display rounded-full bg-panel px-3.5 py-1.5 text-[13px] uppercase">Kochi · outdoor tag</span>
        </div>
        <HeroScene />
        <div className="relative z-10 flex items-center gap-1.5 rounded-full border-2 border-ink bg-panel p-1.5">
          <label htmlFor="code" className="sr-only">
            Game code
          </label>
          <input
            id="code"
            className="font-mono min-w-0 flex-1 bg-transparent px-3 text-center text-2xl font-extrabold uppercase tracking-[.3em] outline-none placeholder:text-dim/45"
            placeholder="CODE"
            maxLength={4}
            autoCapitalize="characters"
            autoComplete="off"
            enterKeyHint="go"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/[^a-zA-Z]/g, '').toUpperCase())}
            onKeyDown={(e) => e.key === 'Enter' && go()}
          />
          <button className="btn-brand px-6" disabled={code.length !== 4} onClick={go}>
            Join <ArrowRight size={18} strokeWidth={2.6} />
          </button>
        </div>
      </section>

      <h2 className="font-display mb-1 text-[30px]">Play</h2>
      <Carousel>
        {rooms.slice(0, 6).map((r) => {
          const mine = !!getSession(r.code)?.playerId;
          return (
            <PlayCard
              key={r.code}
              to={mine ? `/play/${r.code}` : `/join/${r.code}`}
              title={r.title}
              meta={`${r.players} player${r.players === 1 ? '' : 's'} · ${PHASE_LABEL[r.phase] ?? r.phase}`}
              cta={mine ? 'Rejoin' : 'Join'}
              bg="bg-sun"
              team="survivor"
              mood={r.phase === 'live' ? 'scared' : 'idle'}
            />
          );
        })}
        {/* Only hosts run games: players join with a code or from the list above. */}
        {host && <PlayCard to="/host" title="Host a game" meta="Draw the area, share the code" cta="Start" bg="bg-raise" team="zombie" mood="idle" />}
        {host && <PlayCard to="/sim" title="Watch bots play" meta="A full round, fast-forward" cta="Watch" bg="bg-panel" team="survivor" mood="scared" />}
      </Carousel>

      {host && (
        <Link to="/hq" className="card press mt-3 flex items-center gap-3 p-4">
          <span className="grid h-11 w-11 place-items-center rounded-full bg-ink text-night">
            <KeyRound size={20} strokeWidth={2.4} />
          </span>
          <div className="flex-1">
            <div className="font-extrabold">Host HQ</div>
            <div className="text-sm text-dim">Running games, game logs, plan an event</div>
          </div>
          <ChevronRight size={20} />
        </Link>
      )}

      <div className="mb-2 mt-7 flex items-end justify-between">
        <h2 className="font-display text-[22px]">Upcoming in Kochi</h2>
        <Link to="/events" className="text-sm font-bold underline decoration-2 underline-offset-4">
          All events
        </Link>
      </div>
      {events.length === 0 && !host ? (
        <div className="card flex items-center gap-3 p-4">
          <Mascot team="survivor" mood="idle" size={46} />
          <div className="flex-1 text-sm text-dim">No events yet. The next game night shows up here.</div>
        </div>
      ) : events.length === 0 ? (
        <Link to="/events/new" className="card press flex items-center gap-3 p-4">
          <Mascot team="survivor" mood="idle" size={46} />
          <div className="flex-1 text-sm text-dim">
            No events yet. <span className="font-bold text-ink">Plan the first one</span>
          </div>
          <ChevronRight size={20} />
        </Link>
      ) : (
        <div className="flex flex-col gap-2">
          {events.slice(0, 3).map((e) => (
            <LinkCard key={e.id} to={`/events/${e.id}`}>
              <GameBadge color={GAMES[e.game].color} emoji={GAMES[e.game].emoji} />
              <div className="min-w-0 flex-1">
                <div className="truncate font-bold">{e.title}</div>
                <div className="truncate text-sm text-dim">
                  {fmtDateTime(e.startsAt)} · {e.place}
                </div>
              </div>
              <div className="text-right text-xs text-dim">
                <div className="font-mono text-base font-extrabold text-ink">{e.going}</div>
                going
                <div>{relTime(e.startsAt)}</div>
              </div>
            </LinkCard>
          ))}
        </div>
      )}

      <Link to="/leaderboard" className="card press mt-3 flex items-center gap-3 p-4">
        <span className="grid h-11 w-11 place-items-center rounded-full border-2 border-ink bg-sun">
          <Trophy size={20} strokeWidth={2.4} />
        </span>
        <div className="flex-1">
          <div className="font-extrabold">Leaderboard</div>
          <div className="text-sm text-dim">Top zombies and survivors this week</div>
        </div>
        <ChevronRight size={20} />
      </Link>
    </div>
  );
}

/** The hero's one illustration: a zombie lunging at two survivors who are trying to leave the frame. */
function HeroScene() {
  return (
    <div className="pointer-events-none relative -mx-4 -mb-6 h-[236px]" aria-hidden>
      <Sparkle size={26} fill="#fff" className="absolute left-[10%] top-6" />
      <Sparkle size={16} fill="#fff" className="absolute right-[14%] top-3" />
      <Sparkle size={12} fill="var(--color-sun)" className="absolute right-[34%] top-[46%]" />
      <Mascot team="survivor" mood="scared" size={98} className="mascot-bob absolute bottom-10 left-[4%] [animation-delay:-.8s]" />
      <Mascot team="survivor" mood="scared" size={72} className="mascot-bob absolute bottom-[92px] right-[6%] [animation-delay:-2s]" />
      <Mascot team="zombie" mood="happy" size={200} live className="mascot-bob absolute -bottom-4 left-1/2 -translate-x-[42%]" />
    </div>
  );
}

/** Horizontal, snapping row of cards with page dots; characters may break out of the top of a card. */
function Carousel({ children }: { children: ReactNode[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState(0);
  const items = children.flat().filter(Boolean);
  const onScroll = () => {
    const el = ref.current;
    if (!el) return;
    const first = el.firstElementChild as HTMLElement | null;
    const w = first ? first.offsetWidth + 12 : el.clientWidth;
    setPage(Math.round(el.scrollLeft / w));
  };
  return (
    <>
      <div ref={ref} onScroll={onScroll} className="no-scrollbar -mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-px-4 px-4 pb-2 pt-10">
        {items}
      </div>
      {items.length > 1 && (
        <div className="mt-2 flex justify-center gap-1.5" aria-hidden>
          {items.map((_, i) => (
            <span
              key={i}
              className={`h-1.5 rounded-full transition-[width,background-color] duration-200 ease-[var(--ease-out)] ${i === page ? 'w-6 bg-sun ring-[1.5px] ring-ink' : 'w-1.5 bg-ink'}`}
            />
          ))}
        </div>
      )}
    </>
  );
}

/** `bg` is a background class (bg-sun, bg-raise, bg-panel), so a yellow card keeps black ink in dark mode. */
function PlayCard({ to, title, meta, cta, bg, team, mood }: { to: string; title: string; meta: string; cta: string; bg: string; team: Team; mood: Mood }) {
  return (
    <Link to={to} className={`press relative flex h-[188px] w-[76%] shrink-0 snap-start flex-col rounded-[28px] p-5 ${bg}`}>
      <div className="max-w-[60%]">
        <div className="font-display text-[22px] leading-[1.05]">{title}</div>
        <div className="mt-1.5 text-sm font-semibold text-ink/65">{meta}</div>
      </div>
      <Mascot team={team} mood={mood} size={124} className="pointer-events-none absolute -top-9 right-1" />
      <span className="mt-auto inline-flex w-full items-center justify-between rounded-full border-2 border-ink bg-panel px-5 py-3 font-bold">
        {cta} <ArrowRight size={18} strokeWidth={2.6} />
      </span>
    </Link>
  );
}

/** "Install the app" nudge: one tap on Android/Chrome, the Share → Add to Home Screen steps on iPhone. */
function InstallCard() {
  const inst = useInstall();
  const [steps, setSteps] = useState(false);
  if (!inst.show) return null;
  return (
    <>
      <section className="card rise relative mb-4 flex items-center gap-3 overflow-hidden p-4">
        <img src="/pwa-192.png" alt="" className="h-12 w-12 shrink-0 rounded-[14px]" />
        <div className="min-w-0 flex-1">
          <div className="font-extrabold leading-tight">Install Zombie Run</div>
          <div className="text-sm leading-snug text-dim">Full screen, faster, and it stays on your home screen.</div>
        </div>
        <button className="btn-brand btn-sm shrink-0" onClick={() => (inst.canPrompt ? inst.install() : setSteps(true))}>
          <Download size={16} /> Install
        </button>
        <button aria-label="Not now" className="absolute right-1.5 top-1.5 grid h-7 w-7 place-items-center rounded-full text-dim active:bg-raise" onClick={inst.dismiss}>
          <X size={14} />
        </button>
      </section>
      <Sheet open={steps} onClose={() => setSteps(false)} title="Add to your home screen">
        <ol className="mb-5 space-y-4">
          <li className="flex items-center gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-raise">
              <Share size={20} />
            </span>
            <span>
              Tap <b>Share</b> in Safari's toolbar.
            </span>
          </li>
          <li className="flex items-center gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-raise">
              <SquarePlus size={20} />
            </span>
            <span>
              Scroll down and tap <b>Add to Home Screen</b>.
            </span>
          </li>
          <li className="flex items-center gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-xl">
              <img src="/pwa-192.png" alt="" className="h-10 w-10" />
            </span>
            <span>Open Zombie Run from the new icon. It runs full screen, like any app.</span>
          </li>
        </ol>
        <button className="btn-ghost w-full" onClick={() => setSteps(false)}>
          Got it
        </button>
      </Sheet>
    </>
  );
}
