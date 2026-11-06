import { randomBytes, randomInt } from 'node:crypto';

/** A rule violation the player should see as a toast, not a server error. */
export class GameError extends Error {}

export const token = (bytes = 12) => randomBytes(bytes).toString('base64url');

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function roomCode(): string {
  let s = '';
  for (let i = 0; i < 4; i++) s += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return s;
}

/** A 4-digit code not already in `taken`. */
export function freshClaimCode(taken: Set<string>): string {
  for (;;) {
    const c = String(randomInt(1000, 10000));
    if (!taken.has(c)) return c;
  }
}

export function clock(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

const BOT_NAMES = [
  'Ada', 'Bo', 'Cy', 'Dot', 'Eli', 'Fen', 'Gus', 'Hal', 'Ivy', 'Jo', 'Kit', 'Lu', 'Mo', 'Ned', 'Oz', 'Pip',
  'Quin', 'Rex', 'Sid', 'Tam', 'Uma', 'Vic', 'Wren', 'Xan', 'Yan', 'Zed',
];

export function botName(i: number): string {
  const base = BOT_NAMES[i % BOT_NAMES.length];
  const round = Math.floor(i / BOT_NAMES.length);
  return `🤖 ${base}${round ? ` ${round + 1}` : ''}`;
}

export const listNames = (names: string[]) =>
  names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
