// Game catalogue: names, rules text, tunable settings. Drives the host's
// create form on the client and config validation on the server.

export type GameId = 'zombies';

export interface ConfigField {
  key: string;
  label: string;
  unit?: string;
  min: number;
  max: number;
  step: number;
  /** Values are stored in seconds but shown to hosts in minutes. */
  minutes?: boolean;
  help?: string;
}

export interface GameMeta {
  id: GameId;
  name: string;
  emoji: string;
  tagline: string;
  minPlayers: number;
  needsVests: boolean;
  color: string;
  rules: string[];
  hostTips: string[];
  defaults: Record<string, number>;
  fields: ConfigField[];
}

export const GAMES: Record<GameId, GameMeta> = {
  zombies: {
    id: 'zombies',
    name: 'Zombie Run',
    emoji: '🧟',
    tagline: 'Infection tag with QR codes on your back. Survive until the timer runs out.',
    minPlayers: 3,
    needsVests: true,
    color: '#ffc21a',
    rules: [
      'When the game starts, the app deals the teams at random: about 4 in 10 players become zombies, always fewer than the survivors. Nobody picks.',
      'Everyone wears a printed QR code on their back.',
      'Your RADAR shows the players within about 10 m of you as coloured dots: zombies and survivors. No names, no map.',
      'To infect a survivor, a zombie points their camera at that QR and holds it there for a few seconds. The survivor\'s phone screams "You\'re being infected!". Run and the scan breaks.',
      'If the scan holds all the way, the survivor becomes a zombie.',
      "Caught without a scan (no printed vest, or the camera won't read)? Tap \"I got infected\" and type the 4-digit catch code from that zombie's phone, so they get the points.",
      "Stay inside the play area. Step outside and you have 30 seconds to get back in, or you're out of the round with no points.",
      'Points are what count, on two leaderboards. Survivors score 10 points a minute for as long as they stay uninfected. Zombies score 25 points for every survivor they infect. A survivor who gets infected keeps their survivor points and starts scoring as a zombie.',
      'The round still has a result: survivors win if anyone is uninfected when the timer runs out, zombies win if they infect everyone.',
    ],
    hostTips: [
      'Teams are dealt at random when you press Start, and dealt again on every rematch. Nobody, the host included, can pick or switch a team.',
      'Zombies get a head start delay so survivors can scatter.',
      'Ask players to keep the app open and the screen on. The radar needs it.',
      'Print vests from the Kit and pin the QR flat on each player\'s back, between the shoulders. No covering it.',
      'Scanning means getting close, so brief everyone: no grabbing or pushing, just chase.',
    ],
    defaults: {
      durationSecs: 1200,
      zombieDelaySecs: 60,
      scanSecs: 5,
      radarRange: 10,
      tagMaxDistance: 60,
    },
    fields: [
      { key: 'durationSecs', label: 'Round length', unit: 'min', min: 300, max: 3600, step: 60, minutes: true },
      { key: 'scanSecs', label: 'Scan hold to infect', unit: 's', min: 5, max: 10, step: 1, help: 'How long a zombie must keep the camera on a survivor\'s QR.' },
      { key: 'radarRange', label: 'Radar range', unit: 'm', min: 5, max: 50, step: 1, help: 'Players see everyone within this distance. Phone GPS is off by 5–20 m, so widen it if dots keep vanishing.' },
      { key: 'zombieDelaySecs', label: 'Zombie head-start delay', unit: 's', min: 0, max: 300, step: 15 },
      { key: 'tagMaxDistance', label: 'Max GPS distance for a tag', unit: 'm', min: 20, max: 200, step: 5, help: 'Anti-cheat: rejects a scan if both phones report good GPS and are further apart than this (e.g. scanning a photo of a QR).' },
    ],
  },
};

export const GAME_LIST: GameMeta[] = [GAMES.zombies];

export type Team = 'zombie' | 'survivor';
export const TEAMS: Team[] = ['zombie', 'survivor'];
export function isTeam(x: unknown): x is Team {
  return x === 'zombie' || x === 'survivor';
}

/**
 * Zombies are dealt at random when a game starts. Each game draws its zombie share between 35 % and
 * 45 % (40 % on average), then rounds players × share up or down at random, so small games vary too.
 * There is always at least 1 zombie and always fewer zombies than survivors (except 2 players: 1 and 1).
 */
export const ZOMBIE_SHARE = { min: 0.35, max: 0.45 } as const;
const fitZombies = (n: number, k: number) => Math.min(Math.max(k, 1), Math.max(1, Math.floor((n - 1) / 2)));
export function zombieCount(n: number, rand: () => number = Math.random): number {
  if (n < 2) return 0;
  const share = ZOMBIE_SHARE.min + (ZOMBIE_SHARE.max - ZOMBIE_SHARE.min) * rand();
  return fitZombies(n, Math.floor(n * share + rand()));
}
/**
 * Points, on two separate leaderboards. Survivors score for time alive (10 a minute, counted by the second
 * and rounded down); zombies score a flat 25 per infection. An infected survivor keeps their survivor
 * points and scores as a zombie from then on.
 */
export const POINTS = { perInfection: 25, survivorPerMinute: 10 } as const;
export const survivorPoints = (secs: number) => Math.floor((Math.max(0, secs) * POINTS.survivorPerMinute) / 60);
export const zombiePoints = (infections: number) => infections * POINTS.perInfection;
/** A player's points on each board; null when they were never on that side. */
export interface TeamPoints {
  survivor: number | null;
  zombie: number | null;
}

/** The fewest and the most zombies `zombieCount(n)` can deal. */
export function zombieRange(n: number): [number, number] {
  if (n < 2) return [0, 0];
  return [fitZombies(n, Math.floor(n * ZOMBIE_SHARE.min)), fitZombies(n, Math.ceil(n * ZOMBIE_SHARE.max))];
}

export function isGameId(x: unknown): x is GameId {
  return typeof x === 'string' && x in GAMES;
}

/** Fill defaults and clamp every value into the field's allowed range. */
export function normalizeConfig(game: GameId, input: unknown): Record<string, number> {
  const meta = GAMES[game];
  const src = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const out: Record<string, number> = { ...meta.defaults };
  for (const f of meta.fields) {
    const v = Number(src[f.key]);
    if (Number.isFinite(v)) out[f.key] = Math.min(f.max, Math.max(f.min, Math.round(v / f.step) * f.step));
  }
  return out;
}

/** Small Kochi starting points for the boundary editor (approximate). */
export const KOCHI_SPOTS = [
  { name: 'Marine Drive walkway', lat: 9.9822, lng: 76.2763 },
  { name: 'Fort Kochi beach', lat: 9.9667, lng: 76.2417 },
  { name: 'Subhash Bose Park', lat: 9.9785, lng: 76.2795 },
  { name: 'Kakkanad Infopark', lat: 10.0115, lng: 76.3637 },
  { name: 'CUSAT campus', lat: 10.0436, lng: 76.3245 },
];
