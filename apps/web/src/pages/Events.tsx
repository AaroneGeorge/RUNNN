import { CalendarPlus, MapPin, Users } from 'lucide-react';
import { useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { GAMES, type EventDetail, type EventSummary } from '@runnn/shared';
import { CalendarScene } from '../components/Scenes.tsx';
import { Avatar, Button, Card, ConfigSlider, Empty, ErrorBox, Field, IconButton, Input, ListRow, Loading, Page, Pill, Section, TextArea } from '../components/ui.tsx';
import { api, useApi } from '../lib/api.ts';
import { rankTitle } from '../lib/rank.ts';
import { useOrganiser, useProfileToken } from '../lib/storage.ts';
import { toLocalInput, when } from '../lib/time.ts';
import { notify, toastError } from '../lib/toast.ts';

function EventCard({ e }: { e: EventSummary }) {
  const nav = useNavigate();
  return (
    <Card className="mb-2" onClick={() => nav(`/events/${e.id}`)}>
      <div className="flex items-start gap-3">
        <div className="grid size-14 shrink-0 place-items-center rounded-2xl bg-accent text-center leading-none font-black text-accent-ink">
          <div>
            <div className="text-xl">{new Date(e.startsAt).getDate()}</div>
            <div className="text-[10px] uppercase">{new Date(e.startsAt).toLocaleDateString([], { month: 'short' })}</div>
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-lg font-extrabold">{e.title}</h3>
            {e.cancelled && <Pill tone="alarm">Cancelled</Pill>}
          </div>
          <div className="text-sm text-dim">
            {when(e.startsAt)} · {e.place}
          </div>
          <div className="mt-1.5 flex gap-2">
            <Pill>
              {e.going}/{e.capacity} going
            </Pill>
            {e.waitlist > 0 && <Pill>{e.waitlist} waiting</Pill>}
            {e.mine && <Pill tone="good">{e.mine === 'going' ? 'You’re going' : 'Waitlisted'}</Pill>}
          </div>
        </div>
      </div>
    </Card>
  );
}

export function Events() {
  const org = useOrganiser();
  const nav = useNavigate();
  const { data, error, loading, reload } = useApi<{ events: EventSummary[] }>('/events');
  return (
    <Page
      title="Events"
      actions={
        org && (
          <IconButton label="New event" onClick={() => nav('/events/new')}>
            <CalendarPlus className="size-5" />
          </IconButton>
        )
      }
    >
      {loading && !data && <Loading />}
      {error && <ErrorBox onRetry={reload}>{error}</ErrorBox>}
      {data?.events.length === 0 && (
        <Empty
          art={<CalendarScene />}
          title="Nothing scheduled"
          body={org ? 'Put a game in the calendar so people can RSVP.' : 'When an organiser schedules a game it shows up here.'}
          action={org && <Button onClick={() => nav('/events/new')}>Schedule a game</Button>}
        />
      )}
      {data?.events.map((e) => <EventCard key={e.id} e={e} />)}
    </Page>
  );
}

export function NewEvent() {
  const org = useOrganiser();
  const nav = useNavigate();
  const [title, setTitle] = useState('');
  const [place, setPlace] = useState('');
  const [startsAt, setStartsAt] = useState(() => {
    const d = new Date(Date.now() + 3 * 86400_000);
    d.setHours(18, 0, 0, 0);
    return toLocalInput(d.getTime());
  });
  const [capacity, setCapacity] = useState(30);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  if (!org) return <Navigate to="/welcome" replace />;

  const save = async () => {
    setBusy(true);
    try {
      const e = await api<EventDetail>('/events', {
        body: { title, place, startsAt: new Date(startsAt).getTime(), capacity, notes, game: 'chase' },
      });
      notify('Event created', 'good');
      nav(`/events/${e.id}`, { replace: true });
    } catch (err) {
      toastError(err);
      setBusy(false);
    }
  };

  return (
    <Page title="New event" back="/events">
      <Field label="Title">
        <Input value={title} maxLength={60} onChange={(e) => setTitle(e.target.value)} placeholder="Thursday chase" />
      </Field>
      <Field label="Meeting point" help="Where people find you. Be specific: “north gate, by the fountain”.">
        <Input value={place} maxLength={120} onChange={(e) => setPlace(e.target.value)} />
      </Field>
      <Field label="Starts">
        <Input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
      </Field>
      <ConfigSlider field={{ key: 'cap', label: 'Capacity', min: 3, max: 200, step: 1 }} value={capacity} onChange={setCapacity} />
      <Field label="Notes" help="What to wear, what to bring, where to leave bags.">
        <TextArea value={notes} maxLength={1000} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      <Button block size="lg" loading={busy} disabled={!title || !place} onClick={save}>
        Create event
      </Button>
    </Page>
  );
}

export function EventPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const org = useOrganiser();
  const profile = useProfileToken();
  const { data: e, error, setData } = useApi<EventDetail>(`/events/${id}`, [profile]);
  const [busy, setBusy] = useState(false);
  if (error) return <Page title="Event" back="/events"><ErrorBox>{error}</ErrorBox></Page>;
  if (!e) return <Loading />;

  const rsvp = async (on: boolean) => {
    if (!profile) return nav('/me');
    setBusy(true);
    try {
      setData(await api<EventDetail>(`/events/${e.id}/rsvp`, { method: on ? 'POST' : 'DELETE', body: on ? {} : undefined }));
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (!confirm('Cancel this event for everyone?')) return;
    try {
      setData(await api<EventDetail>(`/events/${e.id}`, { method: 'DELETE' }));
    } catch (err) {
      toastError(err);
    }
  };

  return (
    <Page title={e.title} back="/events">
      {e.cancelled && <ErrorBox>This event was cancelled.</ErrorBox>}
      <Card className="mt-2">
        <div className="text-2xl font-black">{when(e.startsAt)}</div>
        <div className="mt-2 flex items-center gap-2 text-dim">
          <MapPin className="size-4" /> {e.place}
        </div>
        <div className="mt-1 flex items-center gap-2 text-dim">
          <Users className="size-4" /> {e.going}/{e.capacity} going{e.waitlist ? `, ${e.waitlist} waiting` : ''}
        </div>
        <div className="mt-1 text-dim">
          {GAMES[e.game]?.emoji} {GAMES[e.game]?.name} · hosted by {e.host.name}
        </div>
        {e.notes && <p className="mt-3 whitespace-pre-wrap">{e.notes}</p>}
        {e.lat !== null && e.lng !== null && (
          <a className="mt-3 inline-block text-sm font-bold underline" href={`https://www.openstreetmap.org/?mlat=${e.lat}&mlon=${e.lng}#map=17/${e.lat}/${e.lng}`} target="_blank" rel="noreferrer">
            Open in maps
          </a>
        )}
      </Card>

      {e.roomCode && !e.cancelled && (
        <Card className="mt-3 bg-accent text-accent-ink ring-0">
          <div className="font-extrabold">The game is open: code {e.roomCode}</div>
          <Link to={`/join/${e.roomCode}`}>
            <Button variant="dark" block className="mt-2">
              Join now
            </Button>
          </Link>
        </Card>
      )}

      {!e.cancelled && (
        <div className="mt-4">
          {e.mine ? (
            <Button variant="secondary" block loading={busy} onClick={() => rsvp(false)}>
              {e.mine === 'going' ? 'I can’t make it' : 'Leave the waitlist'}
            </Button>
          ) : (
            <Button block size="lg" loading={busy} onClick={() => rsvp(true)}>
              {profile ? (e.going >= e.capacity ? 'Join the waitlist' : 'I’m going') : 'Make a profile to RSVP'}
            </Button>
          )}
        </div>
      )}

      {org && !e.cancelled && (
        <div className="mt-2 grid grid-cols-2 gap-2">
          <Button
            variant="dark"
            onClick={() => nav(`/host?event=${e.id}&title=${encodeURIComponent(e.title.slice(0, 24))}`)}
          >
            Open game
          </Button>
          <Button variant="secondary" onClick={cancel}>
            Cancel event
          </Button>
        </div>
      )}

      <Section title={`Who’s coming · ${e.attendees.length}`}>
        <Card className="py-1">
          {e.attendees.map((a) => (
            <ListRow
              key={a.id}
              onClick={() => nav(`/u/${a.id}`)}
              left={<Avatar name={a.name} size={34} />}
              title={a.name}
              sub={`Level ${a.level} · ${rankTitle(a.level)}`}
              right={a.status === 'waitlist' && <Pill>waitlist</Pill>}
            />
          ))}
        </Card>
      </Section>
    </Page>
  );
}
