// Community API types (profiles, events, leaderboard).

import type { GameId, TeamPoints } from './games.ts';
import type { GameResult, Phase } from './protocol.ts';

export interface Profile {
  id: string;
  name: string;
  createdAt: number;
  xp: number;
  level: number;
  gamesPlayed: number;
  wins: number;
  /** Best single-game score on each board, or null if they never played that side. */
  best: TeamPoints;
  /** Proved with World ID that this is the only Kalikkam profile of a real person. */
  verifiedHuman: boolean;
  badges: Badge[];
}

export interface Badge {
  id: string;
  name: string;
  emoji: string;
  desc: string;
}

/** What `/api/me` and sign-in return: your own profile, plus the private bits only you see. */
export interface SignInResponse {
  profile: Profile;
  token: string;
  email: string | null;
  /** True when this sign-in created the profile (the app then asks for a player name). */
  created: boolean;
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Paid games (Arc Testnet, test USDC): the entry each player pays, and one "Get test USDC" top-up (an entry plus gas). */
export const ENTRY_USDC = 0.5;
export const TOP_UP_USDC = 0.6;

/** A player's Kalikkam wallet on Arc Testnet: made by the server after the World ID check, no wallet app needed. */
export interface WalletView {
  address: string;
  balance: number;
  topUpsLeft: number;
  explorer: string;
}

/** World ID setup the app needs to show the check (public values only; the signing key stays on the server). */
export interface WorldConfig {
  enabled: boolean;
  app_id: `app_${string}` | null;
  rp_id: string | null;
  action: string;
  environment: 'production' | 'staging';
  /** selfie: needs World to enable Selfie Check for the app. proof_of_human: Orb. device: any World App (demo only, weak). */
  credential: 'selfie' | 'proof_of_human' | 'device';
}

/** Host accounts: a username and password set by the organisers. Only hosts create games and events. */
export const HOST_NAME_RE = /^[a-z0-9._-]{3,24}$/;
export const normalizeHostName = (u: string) => u.trim().toLowerCase();

/** What `/api/host/login` returns. The host is also signed in to their own player profile. */
export interface HostSession {
  username: string;
  token: string;
  profile: Profile;
  profileToken: string;
}

/** A game that's running, for the host dashboard (with the key to open it as host). */
export interface HostRoomRow {
  code: string;
  title: string;
  phase: Phase;
  players: number;
  createdAt: number;
  hostKey: string;
  sim: boolean;
}

/** A finished game, for the host dashboard: the result plus what its log says went wrong. */
export interface HostGameRow {
  id: number;
  code: string;
  title: string;
  endedAt: number;
  players: number;
  headline: string;
  /** Why the host ended it early, if they did. */
  endReason: string | null;
  /** How each infection was credited. */
  infections: { scan: number; code: number; unknown: number };
  eliminated: number;
  /** Players whose phone dropped off for 20 s or more at least once. */
  gpsDropouts: number;
  hasLog: boolean;
}

export interface HostGameLog {
  result: GameResult;
  log: ({ t: number; kind: string } & Record<string, unknown>)[];
}
export const normalizeEmail = (e: string) => e.trim().toLowerCase();

export interface GameHistoryRow {
  roomCode: string;
  game: GameId;
  title: string;
  endedAt: number;
  role: string | null;
  won: boolean;
  points: TeamPoints;
  xp: number;
}

export interface EventItem {
  id: string;
  title: string;
  game: GameId;
  startsAt: number;
  place: string;
  lat: number | null;
  lng: number | null;
  capacity: number;
  notes: string;
  hostId: string;
  hostName: string;
  going: number;
  waitlist: number;
  myRsvp: 'going' | 'waitlist' | null;
  /** Claiming a spot needs a World ID check first (one spot per person). */
  needsHuman: boolean;
  roomCode: string | null;
  attendees: { id: string; name: string }[];
}

export interface CreateEventRequest {
  title: string;
  game: GameId;
  startsAt: number;
  place: string;
  lat?: number | null;
  lng?: number | null;
  capacity: number;
  notes?: string;
}

export interface LeaderRow {
  id: string;
  name: string;
  xp: number;
  level: number;
  wins: number;
  gamesPlayed: number;
}

/** The leaderboards: the two high-score boards (best single game) and total XP. */
export type Board = 'zombie' | 'survivor' | 'xp';
export function isBoard(x: unknown): x is Board {
  return x === 'zombie' || x === 'survivor' || x === 'xp';
}

/** One player's best single-game score on a high-score board. */
export interface HighScoreRow {
  id: string;
  name: string;
  level: number;
  best: number;
  /** Games they played on that side. */
  games: number;
}

/** XP needed to reach level n is 100 * n * (n - 1) / 2: 0, 100, 300, 600, … */
export function levelForXp(xp: number): number {
  let lvl = 1;
  while (100 * ((lvl * (lvl + 1)) / 2) <= xp) lvl++;
  return lvl;
}

export function xpForLevel(lvl: number): number {
  return (100 * lvl * (lvl - 1)) / 2;
}

export const BADGES: Record<string, Badge> = {
  first_game: { id: 'first_game', name: 'First Game', emoji: '🎟️', desc: 'Played your first game' },
  first_win: { id: 'first_win', name: 'First Win', emoji: '🏆', desc: 'Won a game' },
  regular: { id: 'regular', name: 'Regular', emoji: '🎖️', desc: 'Played 10 games' },
  legend: { id: 'legend', name: 'Legend', emoji: '👑', desc: 'Played 50 games' },
  patient_zero: { id: 'patient_zero', name: 'Patient Zero', emoji: '🧟', desc: '3+ infections in one Zombie Run game' },
  last_stand: { id: 'last_stand', name: 'Last Stand', emoji: '🛡️', desc: 'Still uninfected when the timer ran out' },
};

/** XP for one finished game. */
export function xpForResult(won: boolean, infections: number): number {
  return 10 + (won ? 25 : 0) + Math.min(25, infections * 5);
}
