// Wire protocol between the PWA and the game server (JSON over WebSocket).
// The server is authoritative: clients send intents, the server sends each
// player a personalised RoomView (what that player is allowed to see).

import type { Boundary } from './geo.ts';
import type { GameId, Team, TeamPoints } from './games.ts';

export type Phase = 'lobby' | 'countdown' | 'live' | 'paused' | 'ended';
export type Role = 'host' | Team;
/** 'eliminated': stayed outside the play area past the grace time; out of the round, no points. */
export type Status = 'active' | 'infected' | 'spectating' | 'eliminated';

export interface PlayerSummary {
  id: string;
  name: string;
  isBot: boolean;
  isHost: boolean;
  connected: boolean;
  role: Role | null;
  status: Status;
  sos: boolean;
  /** Host only: vest number + GPS health. */
  vest?: string;
  noVest?: boolean;
  gpsAgeSec?: number;
  gpsAcc?: number;
  suspicious?: boolean;
  /** Host only: the player's catch code (for settling a dispute). */
  catchCode?: string;
  /** Paid entry games: this player paid the $1 entry. */
  paid?: boolean;
}

/** A $1 entry game (Arc Testnet, test USDC): the pot so far. */
export interface EntryView {
  fee: number;
  pot: number;
  paid: number;
  myPaid: boolean;
  /** The pot's round id on the contract, and where to see it. */
  round: string;
  pool: string;
  explorer: string;
}

/** What happened to the pot after the game. Amounts in USDC. */
export interface Payout {
  status: 'pending' | 'paid' | 'refunded' | 'failed';
  splits: { id: string; name: string; amount: number }[];
  txHash?: string;
  explorer: string;
  error?: string;
}

export type MarkerKind = 'player' | 'sos';

export interface MapMarker {
  id: string;
  kind: MarkerKind;
  lat: number;
  lng: number;
  /** Metres, for circles (SOS). */
  radius?: number;
  color?: string;
  emoji?: string;
  label?: string;
  self?: boolean;
  faded?: boolean;
}

export interface ActionDef {
  id: string;
  label: string;
  /** 'scan' = open the camera and hold it on a survivor's back QR. 'code' = type the catching zombie's code. */
  input?: 'scan' | 'code';
  confirm?: string;
  style?: 'primary' | 'danger' | 'ghost';
  cooldownUntil?: number;
  disabled?: boolean;
}

/** Someone on your radar: metres east/north of you. Never a name or player id. */
export interface Blip {
  /** Stable per player and room, so a dot can glide between updates. */
  key: string;
  e: number;
  n: number;
  team: Team;
}

export type Hud =
  | { kind: 'none' }
  | {
      kind: 'zombies';
      survivors: number;
      zombies: number;
      /** Everyone within `range` metres of you, or null without a fresh GPS fix (or as referee). */
      radar: { range: number; blips: Blip[] } | null;
      zombieReleaseAt: number | null;
      /** Zombie: the survivor whose QR you're holding the camera on. */
      scanning: { name: string; endsAt: number; totalMs: number } | null;
      /** Survivor: someone is scanning your back. `zombies` > 1 doesn't speed it up, it's just shown. */
      beingScanned: { endsAt: number; totalMs: number; zombies: number } | null;
      /** Your points so far, or null for a referee. */
      points: TeamPoints | null;
    };

export interface FeedItem {
  id: number;
  at: number;
  text: string;
  kind: 'info' | 'good' | 'bad' | 'alert';
}

export interface ResultRow {
  id: string;
  name: string;
  role: Role | null;
  status: Status;
  won: boolean;
  /** Survivor points for everyone dealt survivor; zombie points for everyone who was a zombie by the end. */
  points: TeamPoints;
  stats: Record<string, number>;
}

export interface GameResult {
  /** Paid entry games: the pot's payout. */
  payout?: Payout;
  headline: string;
  lines: string[];
  rows: ResultRow[];
  endedAt: number;
}

export interface Stage {
  key: string;
  label: string;
  endsAt: number | null;
}

export interface MeView {
  id: string;
  name: string;
  vest: string;
  role: Role | null;
  status: Status;
  isHost: boolean;
  plays: boolean;
  outOfBounds: boolean;
  /** While outside the play area in a live game: when you'll be eliminated (wall clock). */
  outDeadline: number | null;
  /** Zombies only: your private catch code. A survivor you catch types it to give you the infection. */
  catchCode: string | null;
  gpsOk: boolean;
  actions: ActionDef[];
  /** Short line under the HUD. */
  hint: string;
  /** Your own signed vest QR (what's printed on your back), or null for referees. */
  vestQr: string | null;
  /** Joined without a printed vest: can only be infected with "I got tagged". */
  noVest: boolean;
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
  /** Set for $1 entry games. */
  entry: EntryView | null;
  /** Set for bots-only simulation rooms. */
  sim: { speed: number } | null;
  /** Set when a simulation host is watching through this bot's screen (`me` is the bot). */
  watching?: { id: string; name: string } | null;
}

/** Why a host ended a game early (saved in the game log). */
export type EndReason = 'testing' | 'broken' | 'done' | 'other';
export const END_REASONS: { id: EndReason; label: string }[] = [
  { id: 'testing', label: 'We were testing' },
  { id: 'broken', label: 'Something broke' },
  { id: 'done', label: 'Done for now' },
  { id: 'other', label: 'Other' },
];
export function isEndReason(x: unknown): x is EndReason {
  return END_REASONS.some((r) => r.id === x);
}

/** Out of the play area this long (game clock) and you're eliminated. */
export const OUT_GRACE_SECS = 30;
/** Catch codes: 4 digits, unique within a game. */
export const CATCH_CODE_RE = /^\d{4}$/;

export type HostCmd =
  | { cmd: 'start' }
  | { cmd: 'pause' }
  | { cmd: 'resume' }
  | { cmd: 'end'; reason?: EndReason }
  | { cmd: 'rematch' }
  | { cmd: 'kick'; target: string }
  | { cmd: 'addBots'; n: number }
  | { cmd: 'removeBots' }
  | { cmd: 'clearSos'; target: string };

export type ClientMsg =
  | {
      t: 'join';
      code: string;
      name: string;
      vest?: string;
      playerId?: string;
      secret?: string;
      hostKey?: string;
      profileToken?: string;
    }
  | { t: 'pos'; lat: number; lng: number; acc: number }
  /** `code`: for 'gotTagged', the catching zombie's catch code; empty = "I don't know". */
  | { t: 'act'; action: string; code?: string }
  /** Zombie's camera sees a vest QR right now. Sent repeatedly while it stays in view. */
  | { t: 'scan'; qr: string }
  | ({ t: 'host' } & HostCmd)
  | { t: 'sos'; on: boolean }
  /** Simulation host only: see the game through a bot's screen. Same team again = a different bot; null = referee map. */
  | { t: 'watch'; team: Team | null }
  | { t: 'ping' };

export type ServerMsg =
  | { t: 'joined'; playerId: string; secret: string; code: string; isHost: boolean }
  | { t: 'view'; view: RoomView }
  | { t: 'toast'; text: string; kind: FeedItem['kind']; vibrate?: number[] }
  | { t: 'error'; msg: string; fatal?: boolean }
  | { t: 'pong'; serverNow: number };

export interface CreateRoomRequest {
  game: GameId;
  title?: string;
  boundary: Boundary;
  config?: Record<string, number>;
  hostName: string;
  hostPlays: boolean;
  eventId?: string;
  profileToken?: string;
  /** $1 entry in test USDC on Arc Testnet; the pot goes to the winners (hackathon demo). */
  entry?: boolean;
  /** Bots-only simulation: the host watches as referee and the game starts by itself. */
  sim?: { bots: number; speed: number };
}

export const SIM_SPEEDS = [1, 2, 4, 8] as const;

export interface CreateRoomResponse {
  code: string;
  hostKey: string;
}

export interface RoomListing {
  code: string;
  game: GameId;
  title: string;
  phase: Phase;
  players: number;
  createdAt: number;
}

export const VEST_RE = /^\d{3}$/;

/**
 * Printed vest QR: "KLK1:<vest>:<sig>". The signature is an HMAC only the server can make,
 * so a QR can't be faked from a vest number, and any vest printed from the Kit is valid in any game.
 */
export const VEST_QR_RE = /^KLK1:(\d{3}):([A-Z2-9]{8})$/;
export function parseVestQr(text: string): { vest: string; sig: string } | null {
  const m = text.trim().match(VEST_QR_RE);
  return m ? { vest: m[1], sig: m[2] } : null;
}
export const CODE_RE = /^[A-Z]{4}$/;
