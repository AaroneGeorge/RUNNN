import type { Boundary, LatLng } from './geo.ts';
import type { GameId, Team, TeamPoints } from './games.ts';

export type Phase = 'lobby' | 'countdown' | 'live' | 'paused' | 'ended';
export type Role = 'organiser' | Team;
export type Status = 'active' | 'converted' | 'spectating' | 'eliminated';
export type EndReason = 'time' | 'allCaught' | 'noHunters' | 'organiser' | 'weather' | 'safety' | 'other';

export const END_REASON_LABEL: Record<EndReason, string> = {
  time: 'Time is up',
  allCaught: 'Every runner was caught',
  noHunters: 'No hunters left',
  organiser: 'Ended by the organiser',
  weather: 'Stopped for weather',
  safety: 'Stopped for safety',
  other: 'Ended early',
};

export type HostCmd =
  | { cmd: 'start' }
  | { cmd: 'pause' }
  | { cmd: 'resume' }
  | { cmd: 'end'; reason?: EndReason }
  | { cmd: 'rematch' }
  | { cmd: 'kick'; target: string }
  | { cmd: 'addBots'; n: number }
  | { cmd: 'removeBots' }
  | { cmd: 'clearSos'; target: string }
  | { cmd: 'speed'; speed: number };

export type ClientMsg =
  | {
      t: 'join';
      code: string;
      name: string;
      bib?: string;
      playerId?: string;
      secret?: string;
      organiserKey?: string;
      profileToken?: string;
      spectate?: boolean;
    }
  | { t: 'pos'; lat: number; lng: number; acc: number }
  | { t: 'act'; action: string; code?: string }
  /** One camera frame saw this QR. Sent repeatedly while it stays in view. */
  | { t: 'scan'; qr: string }
  | ({ t: 'host' } & HostCmd)
  | { t: 'sos'; on: boolean }
  /** Simulation spectating: look through a bot on this side, or the whole map. */
  | { t: 'watch'; team: Team | null }
  | { t: 'ping' };

export type ToastKind = 'info' | 'good' | 'bad' | 'alert';

export type ServerMsg =
  | { t: 'joined'; playerId: string; secret: string; code: string; isHost: boolean }
  | { t: 'view'; view: RoomView }
  | { t: 'toast'; text: string; kind: ToastKind; vibrate?: number[]; sound?: SoundCue }
  | { t: 'error'; msg: string; fatal?: boolean }
  | { t: 'pong'; serverNow: number };

export type SoundCue = 'caught' | 'converted' | 'scan' | 'broke' | 'out' | 'start' | 'end' | 'release' | 'sos';

export interface ActionDef {
  id: string;
  label: string;
  /** Needs a typed code (e.g. the hunter's claim code). */
  needsCode?: boolean;
  codeLabel?: string;
  /** Optional second, code-free variant label (e.g. "I don't know who"). */
  confirm?: string;
  danger?: boolean;
  /** Wall-clock time until which the action is on cooldown. */
  cooldownUntil?: number;
}

export interface Stage {
  key: string;
  label: string;
  endsAt: number | null;
}

/** Someone on your radar: metres east/north of you. Never a name, never a player id. */
export interface Blip {
  key: string;
  e: number;
  n: number;
  team: Team;
}

export interface Radar {
  range: number;
  blips: Blip[];
}

export interface ChaseHud {
  game: 'chase';
  released: boolean;
  releaseAt: number | null;
  counts: { hunters: number; runners: number; out: number };
  radar: Radar | null;
  /** For a hunter: the scan in progress. */
  scanning: { name: string; bib: string; startedAt: number; holdMs: number } | null;
  /** For a runner: someone has a camera on your back right now. */
  beingScanned: { startedAt: number; holdMs: number } | null;
}

export type Hud = ChaseHud;

export interface GpsHealth {
  fixes: number;
  gaps: number;
  bestAcc: number | null;
  worstAcc: number | null;
  lastAt: number | null;
}

export interface MeView {
  id: string;
  name: string;
  bib: string;
  isHost: boolean;
  isBot: boolean;
  plays: boolean;
  noBib: boolean;
  team: Team | null;
  role: Role | null;
  status: Status;
  points: TeamPoints;
  stats: Record<string, number>;
  claimCode: string;
  pos: { lat: number; lng: number; acc: number; at: number } | null;
  /** Wall clock deadline for getting back inside, if outside. */
  outDeadline: number | null;
  sos: boolean;
  actions: ActionDef[];
  hint: string;
  roleIntro: string;
  color: string;
  emoji: string;
  profileId: string | null;
}

export interface PlayerSummary {
  id: string;
  name: string;
  isBot: boolean;
  isHost: boolean;
  plays: boolean;
  connected: boolean;
  status: Status;
  /** Only what this viewer may know. */
  role: Role | null;
  points: TeamPoints;
  emoji: string;
  color: string;
  /** Only to the organiser (and to the player themselves). */
  bib?: string;
  claimCode?: string;
  gpsAge?: number | null;
  gpsAcc?: number | null;
  sos?: boolean;
  suspicious?: boolean;
}

export interface MapMarker {
  id: string;
  lat: number;
  lng: number;
  label: string;
  color: string;
  emoji: string;
  me?: boolean;
  acc?: number;
  sos?: boolean;
}

export interface FeedItem {
  id: number;
  at: number;
  text: string;
  kind: ToastKind;
}

export interface ResultRow {
  playerId: string;
  profileId: string | null;
  name: string;
  isBot: boolean;
  team: Team | null;
  role: Role | null;
  status: Status;
  points: TeamPoints;
  conversions: number;
  survivedSecs: number;
  won: boolean;
  xp?: number;
}

export interface GameResult {
  reason: EndReason;
  winner: Team | null;
  headline: string;
  endedAt: number;
  durationSecs: number;
  rows: ResultRow[];
  top: { runner: { names: string[]; points: number } | null; hunter: { names: string[]; points: number } | null };
  eliminated: string[];
}

export interface RoomView {
  code: string;
  game: GameId;
  title: string;
  phase: Phase;
  config: Record<string, number>;
  boundary: Boundary;
  serverNow: number;
  startedAt: number | null;
  endsAt: number | null;
  stage: Stage | null;
  me: MeView;
  players: PlayerSummary[];
  markers: MapMarker[];
  hud: Hud;
  feed: FeedItem[];
  result: GameResult | null;
  sim: { speed: number; watching: Team | null } | null;
  /** For the organiser only: key that re-claims the organiser seat from another device. */
  organiserKey?: string;
}

export interface RoomListing {
  code: string;
  title: string;
  game: GameId;
  phase: Phase;
  players: number;
  center: LatLng;
  createdAt: number;
}

export interface RoomPreview extends RoomListing {
  boundary: Boundary;
  config: Record<string, number>;
  sim: boolean;
}

export interface CreateRoomBody {
  title: string;
  game: GameId;
  boundary: Boundary;
  config: Record<string, number>;
  organiserPlays?: boolean;
  sim?: boolean;
  speed?: number;
  bots?: number;
  eventId?: string;
}

export const ROOM_CODE_RE = /^[A-Z2-9]{4}$/;
export const BIB_RE = /^\d{3}$/;
export const BIB_QR_RE = /^RN1:(\d{3}):([A-Z2-9]{8})$/;
export const CLAIM_CODE_RE = /^\d{4}$/;
export const OUT_GRACE_SECS = 30;
export const NAME_MAX = 24;

export function parseBibQr(text: string): { bib: string; sig: string } | null {
  const m = BIB_QR_RE.exec(text.trim());
  return m ? { bib: m[1], sig: m[2] } : null;
}

export function cleanName(x: unknown): string {
  return typeof x === 'string'
    ? x
        .replace(/[\u0000-\u001f\u007f]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, NAME_MAX)
    : '';
}
