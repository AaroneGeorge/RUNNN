import type { GameId, Team, TeamPoints } from './games.ts';

export interface Badge {
  id: string;
  name: string;
  emoji: string;
  desc: string;
  earnedAt?: number;
}

export interface Profile {
  id: string;
  name: string;
  createdAt: number;
  xp: number;
  level: number;
  gamesPlayed: number;
  wins: number;
  best: TeamPoints;
  badges: Badge[];
}

export interface HistoryItem {
  resultId: number;
  game: GameId;
  title: string;
  endedAt: number;
  role: string | null;
  won: boolean;
  xp: number;
  points: TeamPoints;
  headline: string;
}

export interface MeResponse {
  profile: Profile;
  history: HistoryItem[];
  email: string | null;
}

export type RsvpStatus = 'going' | 'waitlist';

export interface EventSummary {
  id: string;
  title: string;
  game: GameId;
  startsAt: number;
  place: string;
  lat: number | null;
  lng: number | null;
  capacity: number;
  notes: string;
  host: { id: string; name: string };
  roomCode: string | null;
  going: number;
  waitlist: number;
  cancelled: boolean;
  /** The viewer's own RSVP, when signed in. */
  mine: RsvpStatus | null;
}

export interface EventDetail extends EventSummary {
  attendees: { id: string; name: string; level: number; status: RsvpStatus }[];
}

export interface CreateEventBody {
  title: string;
  game: GameId;
  startsAt: number;
  place: string;
  lat?: number | null;
  lng?: number | null;
  capacity: number;
  notes?: string;
}

export type LeaderboardBoard = 'xp' | Team;
export type LeaderboardPeriod = 'all' | 'month' | 'week';

export interface LeaderboardRow {
  rank: number;
  id: string;
  name: string;
  level: number;
  value: number;
}

/** XP to reach level n = 100·n·(n−1)/2 → 0, 100, 300, 600, 1000 … */
export function levelForXp(xp: number): number {
  let lvl = 1;
  while (100 * ((lvl * (lvl + 1)) / 2) <= xp) lvl++;
  return lvl;
}

export const xpForLevel = (lvl: number) => (100 * lvl * (lvl - 1)) / 2;

export function levelProgress(xp: number): { level: number; into: number; span: number } {
  const level = levelForXp(xp);
  const base = xpForLevel(level);
  return { level, into: xp - base, span: xpForLevel(level + 1) - base };
}

/** Showing up is always worth something. */
export function xpForResult(won: boolean, conversions: number): number {
  return 10 + (won ? 25 : 0) + Math.min(25, conversions * 5);
}

export const BADGES: Record<string, Badge> = {
  first_game: { id: 'first_game', name: 'First Game', emoji: '🎟️', desc: 'Played your first game' },
  first_win: { id: 'first_win', name: 'First Win', emoji: '🏆', desc: 'Won a game' },
  regular: { id: 'regular', name: 'Regular', emoji: '🎖️', desc: 'Played 10 games' },
  survivor: { id: 'survivor', name: 'Survivor', emoji: '🫥', desc: 'Lasted a whole round as a runner' },
  pack_leader: { id: 'pack_leader', name: 'Pack Leader', emoji: '🐺', desc: 'Caught 3 runners in one round' },
  turncoat: { id: 'turncoat', name: 'Turncoat', emoji: '🔄', desc: 'Got caught, then caught someone' },
  organiser: { id: 'organiser', name: 'Organiser', emoji: '📋', desc: 'Ran a game for other people' },
};

export interface BadgeInput {
  gamesPlayed: number;
  wins: number;
  won: boolean;
  dealt: Team | null;
  survivedWholeRound: boolean;
  conversions: number;
  wasConverted: boolean;
  organised: boolean;
}

/** Badges earned by this result (the store ignores ones already held). */
export function badgesFor(i: BadgeInput): string[] {
  const out: string[] = [];
  if (i.gamesPlayed >= 1) out.push('first_game');
  if (i.won) out.push('first_win');
  if (i.gamesPlayed >= 10) out.push('regular');
  if (i.dealt === 'runner' && i.survivedWholeRound) out.push('survivor');
  if (i.conversions >= 3) out.push('pack_leader');
  if (i.wasConverted && i.conversions >= 1) out.push('turncoat');
  if (i.organised) out.push('organiser');
  return out;
}
