import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { GAMES, KOCHI_SPOTS, type CreateEventRequest, type EventItem, type GameId } from '@kalikkam/shared';
import { api, ensureProfile } from '../lib/api.ts';
import { getHost, getProfile, getSession, lastName } from '../lib/storage.ts';
import { fmtDateTime, relTime } from '../lib/time.ts';
import { ActionBar, Avatar, Empty, ErrorBox, GameBadge, LinkCard, Range, Spinner, TopBar, shareText } from '../components/ui.tsx';
import { WorldCheck } from '../components/WorldCheck.tsx';
import { CalendarDays, CalendarPlus, Check, Clock, MapPin, Mic, Navigation, Plus, Share2, Users } from 'lucide-react';

export function EventsPage() {
  const [events, setEvents] = useState<EventItem[] | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    api<EventItem[]>('/api/events')
      .then(setEvents)
      .catch((e) => setErr(e.message));
  }, []);
  return (
    <div className="page">
      <TopBar
        title="Events"
        back={false}
        right={
          // Hosts plan events; everyone can see, share and RSVP.
          getHost() ? (
            <Link to="/events/new" className="btn-brand btn-sm">
              <Plus size={16} strokeWidth={3} /> Plan
            </Link>
          ) : undefined
        }
      />
      {err && <ErrorBox>{err}</ErrorBox>}
      {!events && !err && <Spinner />}
      {events && events.length === 0 && (
        <Empty title="Nothing planned yet">
          {getHost() ? (
            <>
              Plan the first game night in Kochi.{' '}
              <Link to="/events/new" className="font-bold text-brand">
                Plan one →
              </Link>
            </>
          ) : (
            'The next game night shows up here. Check back soon.'
          )}
        </Empty>
      )}
      <div className="flex flex-col gap-2">
        {events?.map((e) => (
          <LinkCard key={e.id} to={`/events/${e.id}`}>
            <DateTile ms={e.startsAt} color={GAMES[e.game].color} />
            <div className="min-w-0 flex-1">
              <div className="truncate font-bold">
                {GAMES[e.game].emoji} {e.title}
              </div>
              <div className="flex items-center gap-1 truncate text-sm text-dim">
                <Clock size={13} className="shrink-0" /> {fmtTime(e.startsAt)} · {relTime(e.startsAt)}
              </div>
              <div className="flex items-center gap-1 truncate text-sm text-dim">
                <MapPin size={13} className="shrink-0" /> <span className="truncate">{e.place}</span>
              </div>
            </div>
            <div className="flex flex-col items-end gap-1.5">
              {e.myRsvp && (
                <span className="chip bg-brand/15 text-brand">
                  <Check size={12} strokeWidth={3} /> {e.myRsvp === 'going' ? 'Going' : 'Waitlist'}
                </span>
              )}
              <span className="flex items-center gap-1 text-xs font-semibold text-dim">
                <Users size={12} /> {e.going}/{e.capacity}
              </span>
            </div>
          </LinkCard>
        ))}
      </div>
    </div>
  );
}

const fmtTime = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

/** Calendar-style date block: month on top, big day number. */
function DateTile({ ms, color }: { ms: number; color: string }) {
  const d = new Date(ms);
  return (
    <div className="grid h-14 w-13 shrink-0 grid-rows-[auto_1fr] overflow-hidden rounded-2xl border border-line bg-deep text-center">
      <div className="py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-night" style={{ background: color }}>
        {d.toLocaleDateString([], { month: 'short' })}
      </div>
      <div className="grid place-items-center font-mono text-xl font-bold leading-none">{d.getDate()}</div>
    </div>
  );
}

function toLocalInput(ms: number) {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function EventNewPage() {
  const nav = useNavigate();
  const game: GameId = 'zombies';
  const [title, setTitle] = useState('');
  const nextSat = (() => {
    const d = new Date();
    d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7 || 7));
    d.setHours(17, 30, 0, 0);
    return d.getTime();
  })();
  const [when, setWhen] = useState(toLocalInput(nextSat));
  const [place, setPlace] = useState('');
  const [spot, setSpot] = useState<{ lat: number; lng: number } | null>(null);
  const [capacity, setCapacity] = useState(30);
  const [notes, setNotes] = useState('');
  const [name, setName] = useState(lastName());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const hasProfile = !!getProfile();

  const submit = async () => {
    setBusy(true);
    setErr('');
    try {
      await ensureProfile(name.trim() || 'Host');
      const body: CreateEventRequest = {
        title: title.trim() || `${GAMES[game].name} at ${place.trim()}`,
        game,
        startsAt: new Date(when).getTime(),
        place: place.trim(),
        lat: spot?.lat ?? null,
        lng: spot?.lng ?? null,
        capacity,
        notes,
      };
      const e = await api<EventItem>('/api/events', { body });
      nav(`/events/${e.id}`, { replace: true });
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <TopBar title="Plan an event" />
      {!hasProfile && (
        <>
          <label className="label" htmlFor="ename">
            Your name
          </label>
          <input id="ename" className="field mb-4" value={name} maxLength={24} onChange={(e) => setName(e.target.value)} placeholder="Host name" />
        </>
      )}
      <label className="label" htmlFor="etitle">
        Title
      </label>
      <input id="etitle" className="field mb-4" maxLength={80} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={`${GAMES[game].name} at Marine Drive`} />
      <label className="label" htmlFor="ewhen">
        When
      </label>
      <input id="ewhen" type="datetime-local" className="field mb-4" value={when} onChange={(e) => setWhen(e.target.value)} />
      <label className="label" htmlFor="eplace">
        Where
      </label>
      <input id="eplace" className="field mb-2" maxLength={120} value={place} onChange={(e) => setPlace(e.target.value)} placeholder="Meeting point, e.g. Marine Drive, near the Rainbow Bridge" />
      <div className="-mx-4 mb-4 no-scrollbar flex gap-2 overflow-x-auto px-4">
        {KOCHI_SPOTS.map((s) => (
          <button
            key={s.name}
            className={`btn-sm inline-flex shrink-0 items-center gap-1.5 rounded-xl border font-bold ${spot?.lat === s.lat ? 'border-brand text-brand' : 'border-line text-dim'}`}
            onClick={() => {
              setSpot({ lat: s.lat, lng: s.lng });
              if (!place) setPlace(s.name);
            }}
          >
            <MapPin size={14} /> {s.name}
          </button>
        ))}
      </div>
      <div className="card mb-4 p-4">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-sm font-semibold">Max players</span>
          <span className="font-mono text-sm font-bold text-brand">{capacity}</span>
        </div>
        <Range label="Max players" min={4} max={150} value={capacity} onChange={setCapacity} />
      </div>
      <label className="label" htmlFor="enotes">
        Notes
      </label>
      <textarea id="enotes" className="field mb-4 min-h-24" maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Wear running shoes. Bring water. Vests provided." />
      {err && (
        <div className="mb-4">
          <ErrorBox>{err}</ErrorBox>
        </div>
      )}
      <ActionBar>
        <button className="btn-brand w-full text-lg" disabled={busy || !place.trim() || (!hasProfile && !name.trim())} onClick={submit}>
          {busy ? 'Creating…' : place.trim() ? 'Create event' : 'Add a meeting point'}
        </button>
      </ActionBar>
    </div>
  );
}

function icsFor(e: EventItem) {
  const fmt = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const esc = (s: string) => s.replace(/[,;\\]/g, (c) => `\\${c}`).replace(/\n/g, '\\n');
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Kalikkam//EN',
    'BEGIN:VEVENT',
    `UID:${e.id}@kalikkam`,
    `DTSTAMP:${fmt(Date.now())}`,
    `DTSTART:${fmt(e.startsAt)}`,
    `DTEND:${fmt(e.startsAt + 2 * 3600_000)}`,
    `SUMMARY:${esc(e.title)}`,
    `LOCATION:${esc(e.place)}`,
    `DESCRIPTION:${esc(`${GAMES[e.game].name}. ${e.notes}\n${location.origin}/events/${e.id}`)}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}

export function EventPage() {
  const id = useParams().id!;
  const nav = useNavigate();
  const [ev, setEv] = useState<EventItem | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState(lastName());
  const [cancelAsk, setCancelAsk] = useState(false);
  const [checking, setChecking] = useState(false);
  const [notice, setNotice] = useState('');
  const me = getProfile();

  useEffect(() => {
    api<EventItem>(`/api/events/${id}`)
      .then(setEv)
      .catch((e) => setErr(e.message));
  }, [id]);

  if (err) {
    return (
      <div className="page">
        <TopBar title="Event" />
        <ErrorBox>{err}</ErrorBox>
      </div>
    );
  }
  if (!ev) return <Spinner />;
  const g = GAMES[ev.game];
  // Any signed-in host can start or cancel an event's game.
  const isHost = !!getHost();
  const full = ev.going >= ev.capacity;

  const rsvp = async (on: boolean) => {
    setBusy(true);
    try {
      if (on) await ensureProfile(name.trim() || 'Player');
      setEv(await api<EventItem>(`/api/events/${id}/rsvp`, { method: on ? 'POST' : 'DELETE' }));
    } catch (e) {
      setErr((e as Error).message);
    }
    setBusy(false);
  };

  const download = () => {
    const blob = new Blob([icsFor(ev)], { type: 'text/calendar' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${ev.title.replace(/[^\w]+/g, '-')}.ics`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  const pct = Math.min(100, (ev.going / Math.max(1, ev.capacity)) * 100);
  return (
    <div className="page">
      <TopBar title="" back="/events" />
      <div
        className="relative mb-4 overflow-hidden rounded-[28px] p-5"
        style={{ background: `color-mix(in srgb, ${g.color} 16%, var(--color-panel))` }}
      >
        <div className="mb-4 flex items-center gap-3">
          <GameBadge color={g.color} emoji={g.emoji} size="lg" />
          <div className="min-w-0">
            <div className="text-xs font-bold uppercase tracking-[.14em] text-dim">{g.name}</div>
            <div className="truncate text-sm text-dim">hosted by {ev.hostName}</div>
          </div>
        </div>
        <h1 className="text-[28px] font-extrabold leading-[1.1] tracking-tight">{ev.title}</h1>
        {ev.myRsvp && (
          <span className="chip mt-3 bg-brand/15 text-brand">
            <Check size={12} strokeWidth={3} /> {ev.myRsvp === 'going' ? "You're going" : "You're on the waitlist"}
          </span>
        )}
      </div>

      <div className="card mb-4 divide-y divide-line">
        <div className="flex items-center gap-3 p-4">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-raise text-ink">
            <CalendarDays size={18} />
          </span>
          <div>
            <div className="font-bold">{fmtDateTime(ev.startsAt)}</div>
            <div className="text-sm text-dim">{relTime(ev.startsAt)}</div>
          </div>
        </div>
        <div className="flex items-center gap-3 p-4">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-raise text-blood">
            <MapPin size={18} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="font-bold">{ev.place}</div>
          </div>
          {ev.lat !== null && ev.lng !== null && (
            <a
              className="btn-ghost btn-sm shrink-0"
              href={`https://www.google.com/maps/dir/?api=1&destination=${ev.lat},${ev.lng}`}
              target="_blank"
              rel="noreferrer"
            >
              <Navigation size={14} /> Go
            </a>
          )}
        </div>
        <div className="p-4">
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-raise text-brand">
              <Users size={18} />
            </span>
            <div className="flex-1">
              <div className="font-bold">
                {ev.going} / {ev.capacity} going
              </div>
              <div className="text-sm text-dim">{full ? (ev.waitlist ? `Full · ${ev.waitlist} on the waitlist` : 'Full') : `${ev.capacity - ev.going} spots left`}</div>
            </div>
          </div>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-line">
            <div className="h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
          </div>
        </div>
      </div>

      {ev.notes && <p className="card mb-4 whitespace-pre-wrap p-4 text-[15px] leading-relaxed">{ev.notes}</p>}

      {ev.roomCode && (
        <Link to={getSession(ev.roomCode)?.playerId ? `/play/${ev.roomCode}` : `/join/${ev.roomCode}`} className="btn-brand mb-4 w-full text-lg">
          <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-brand-ink" /> Game is live · Join {ev.roomCode}
        </Link>
      )}

      <div className="mb-6 grid grid-cols-2 gap-2">
        <button className="btn-ghost" onClick={() => shareText(`${g.emoji} ${ev.title}: ${fmtDateTime(ev.startsAt)} at ${ev.place}. Who's in?`, `${location.origin}/events/${ev.id}`)}>
          <Share2 size={18} /> Share
        </button>
        <button className="btn-ghost" onClick={download}>
          <CalendarPlus size={18} /> Calendar
        </button>
      </div>

      <h2 className="label">Who's going · {ev.going}</h2>
      <div className="card mb-6 divide-y divide-line">
        {ev.attendees.map((a) => (
          <Link key={a.id} to={`/u/${a.id}`} className="flex items-center gap-3 px-4 py-3 active:bg-raise">
            <Avatar name={a.name} />
            <span className="min-w-0 flex-1 truncate font-semibold">{a.name}</span>
            {a.id === ev.hostId && <span className="chip bg-brand/15 text-brand">host</span>}
          </Link>
        ))}
      </div>

      {isHost && (
        <div className="flex flex-col gap-2">
          <button className="btn-ghost" onClick={() => nav(`/host?game=${ev.game}&event=${ev.id}&title=${encodeURIComponent(ev.title)}`)}>
            <Mic size={18} className="text-brand" /> Start the game for this event
          </button>
          <button
            className="py-2 text-sm font-semibold text-blood"
            onClick={async () => {
              if (!cancelAsk) return setCancelAsk(true);
              await api(`/api/events/${ev.id}`, { method: 'DELETE' }).catch(() => undefined);
              nav('/events');
            }}
          >
            {cancelAsk ? 'Tap again to cancel the event' : 'Cancel event'}
          </button>
        </div>
      )}

      <WorldCheck
        open={checking}
        onClose={() => {
          setChecking(false);
          setNotice('You closed the World ID check, so no spot was claimed.');
        }}
        onVerified={() => {
          setChecking(false);
          void rsvp(true);
        }}
        onFailed={(why) => {
          setChecking(false);
          setNotice(why);
        }}
      />
      <ActionBar>
        {notice && <p className="mb-2 rounded-2xl bg-blood/10 px-4 py-2.5 text-sm font-semibold text-blood">{notice}</p>}
        {!me && !ev.myRsvp && (
          <input aria-label="Your name" className="field" maxLength={24} placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} />
        )}
        {ev.myRsvp ? (
          !isHost && (
            <button className="btn-ghost w-full" disabled={busy} onClick={() => rsvp(false)}>
              Can't make it anymore
            </button>
          )
        ) : (
          <>
            <button
              className="btn-brand w-full text-lg"
              disabled={busy || checking || (!me && !name.trim())}
              onClick={async () => {
                setNotice('');
                if (!ev.needsHuman) return rsvp(true);
                // One spot per person: a World ID check first, bound to this profile.
                await ensureProfile(name.trim() || 'Player');
                setChecking(true);
              }}
            >
              {checking ? 'Waiting for World ID…' : full ? 'Join the waitlist' : "I'm in!"}
            </button>
            {ev.needsHuman && <p className="mt-2 text-center text-xs font-semibold text-dim">One spot per person: a quick World ID check first.</p>}
          </>
        )}
      </ActionBar>
    </div>
  );
}
