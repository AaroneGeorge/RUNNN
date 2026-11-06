import { ChevronRight, RefreshCw } from 'lucide-react';
import { Navigate, useNavigate, useParams } from 'react-router';
import type { GameResult, RoomListing } from '@runnn/shared';
import { Button, Card, Empty, ErrorBox, IconButton, KeyValue, ListRow, Loading, Page, Pill, Section } from '../components/ui.tsx';
import { Points } from '../game/bits.tsx';
import { api, useApi } from '../lib/api.ts';
import { setOrganiser, setSession, useOrganiser } from '../lib/storage.ts';
import { ago, clock } from '../lib/time.ts';

interface OrgRoom extends RoomListing {
  sim: boolean;
  organiserKey: string;
}

interface Round {
  id: number;
  roomCode: string;
  title: string;
  endedAt: number;
  players: number;
  headline: string;
  summary: { scans: number; conversions: number; codeAttempts: number; eliminated: number; sos: number } | null;
}

export function HQ() {
  const org = useOrganiser();
  const nav = useNavigate();
  const rooms = useApi<{ rooms: OrgRoom[] }>(org ? '/organiser/rooms' : null);
  const games = useApi<{ games: Round[] }>(org ? '/organiser/games' : null);
  if (!org) return <Navigate to="/welcome" replace />;

  const open = (r: OrgRoom) => {
    setSession(r.code, { organiserKey: r.organiserKey, name: org.username });
    nav(r.sim ? `/watch/${r.code}` : `/play/${r.code}`);
  };

  return (
    <Page
      title="HQ"
      back="/"
      actions={
        <IconButton
          label="Refresh"
          onClick={() => {
            rooms.reload();
            games.reload();
          }}
        >
          <RefreshCw className="size-5" />
        </IconButton>
      }
    >
      <Section title="Live rooms">
        {rooms.loading && !rooms.data && <Loading />}
        {rooms.error && <ErrorBox onRetry={rooms.reload}>{rooms.error}</ErrorBox>}
        {rooms.data?.rooms.length === 0 && <Card className="text-center text-sm text-dim">No rooms running.</Card>}
        {rooms.data?.rooms.map((r) => (
          <Card key={r.code} className="mb-2" onClick={() => open(r)}>
            <ListRow
              title={
                <span className="flex items-center gap-2">
                  {r.title} {r.sim && <Pill>sim</Pill>}
                </span>
              }
              sub={`${r.code} · ${r.players} players · ${r.phase} · ${ago(r.createdAt)}`}
              right={<ChevronRight className="size-5 text-dim" />}
            />
          </Card>
        ))}
      </Section>

      <Section title="Finished rounds">
        {games.loading && !games.data && <Loading />}
        {games.data?.games.length === 0 && <Empty title="No rounds yet" body="Finished rounds and their logs show up here." />}
        <Card className="py-1">
          {games.data?.games.map((g) => (
            <ListRow
              key={g.id}
              onClick={() => nav(`/hq/games/${g.id}`)}
              title={g.title}
              sub={`${ago(g.endedAt)} · ${g.players} players · ${g.headline}`}
              right={
                g.summary && (
                  <span className="text-right text-xs text-dim">
                    {g.summary.conversions} caught
                    <br />
                    {g.summary.sos > 0 && <span className="font-bold text-alarm">{g.summary.sos} SOS</span>}
                  </span>
                )
              }
            />
          ))}
        </Card>
      </Section>

      <div className="mt-8">
        <Button
          variant="secondary"
          block
          onClick={async () => {
            await api('/organiser/logout', { method: 'POST', body: {} }).catch(() => {});
            setOrganiser(null);
            nav('/');
          }}
        >
          Sign out of organiser
        </Button>
      </div>
    </Page>
  );
}

interface LogLine {
  t: number;
  kind: string;
  [k: string]: unknown;
}

function describe(e: LogLine, names: Map<string, string>): string {
  const n = (id: unknown) => (typeof id === 'string' ? (names.get(id) ?? id.slice(0, 5)) : 'someone');
  switch (e.kind) {
    case 'start':
      return 'Round started';
    case 'release':
      return 'Hunters released';
    case 'scan':
      return e.outcome === 'started' ? `${n(e.p)} started scanning ${n(e.target)}` : `${n(e.p)} lost ${n(e.target)} after ${e.held}s`;
    case 'convert':
      return `${e.p ? n(e.p) : 'Unknown hunter'} caught ${n(e.target)} (${e.how})`;
    case 'code':
      return `${n(e.p)} claim code: ${e.outcome}`;
    case 'out':
      return `${n(e.p)} ${e.outcome === 'warned' ? 'left the area' : e.outcome === 'back' ? 'came back in' : 'was eliminated'}`;
    case 'sos':
      return `${n(e.p)} SOS ${e.outcome}`;
    case 'host':
      return `Organiser: ${e.action}${e.target ? ` ${n(e.target)}` : ''}`;
    case 'gps':
      return e.outcome === 'implausible' ? `${n(e.p)} moved implausibly fast (${e.mps} m/s)` : 'GPS health recorded';
    case 'join':
      return `${n(e.p)} joined${e.late ? ' late' : ''}`;
    case 'end':
      return `Round ended: ${e.reason}`;
    default:
      return e.kind;
  }
}

export function HQRound() {
  const { id } = useParams();
  const org = useOrganiser();
  const r = useApi<{ result: GameResult; log: LogLine[]; title: string; roomCode: string }>(org ? `/organiser/games/${id}` : null);
  if (!org) return <Navigate to="/welcome" replace />;
  if (r.error) return <Page title="Round" back="/hq"><ErrorBox>{r.error}</ErrorBox></Page>;
  if (!r.data) return <Loading />;
  const { result, log, title } = r.data;
  const names = new Map<string, string>();
  for (const e of log) if (e.kind === 'start' && Array.isArray(e.roster)) for (const p of e.roster as { p: string; name: string }[]) names.set(p.p, p.name);
  for (const row of result.rows) names.set(row.playerId, row.name);
  const health = log.find((e) => e.kind === 'gps' && Array.isArray(e.health))?.health as
    | { p: string; fixes: number; gaps: number; bestAcc: number | null; worstAcc: number | null }[]
    | undefined;

  return (
    <Page title={title} back="/hq">
      <Card>
        <div className="font-extrabold">{result.headline}</div>
        <KeyValue
          items={[
            ['Ended', new Date(result.endedAt).toLocaleString()],
            ['Length', clock(result.durationSecs * 1000)],
            ['Winner', result.winner ?? 'none'],
          ]}
        />
      </Card>
      <Section title="Scores">
        <Card className="py-1">
          {result.rows.map((x) => (
            <ListRow key={x.playerId} title={`${x.name}${x.won ? ' 🏆' : ''}`} sub={`${x.team} → ${x.role} · ${x.status}`} right={<Points points={x.points} className="text-sm" />} />
          ))}
        </Card>
      </Section>
      {health && health.length > 0 && (
        <Section title="GPS health">
          <Card className="py-1">
            {health.map((h) => (
              <ListRow key={h.p} title={names.get(h.p) ?? h.p} sub={`${h.fixes} fixes · ${h.gaps} gaps · ±${h.bestAcc ?? '?'}–${h.worstAcc ?? '?'} m`} />
            ))}
          </Card>
        </Section>
      )}
      <Section title={`Round log · ${log.length}`}>
        <Card className="font-mono text-xs">
          {log.map((e, i) => (
            <div key={i} className="flex gap-3 py-0.5">
              <span className="w-12 shrink-0 text-right text-dim">{clock(e.t * 1000)}</span>
              <span>{describe(e, names)}</span>
            </div>
          ))}
        </Card>
      </Section>
    </Page>
  );
}
