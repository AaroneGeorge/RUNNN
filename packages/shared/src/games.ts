export type GameId = 'chase';
export type Team = 'hunter' | 'runner';

export interface ConfigField {
  key: string;
  label: string;
  unit?: string;
  min: number;
  max: number;
  step: number;
  /** Stored in seconds, shown in minutes. */
  minutes?: boolean;
  help?: string;
}

export interface GameMeta {
  id: GameId;
  name: string;
  emoji: string;
  minPlayers: number;
  needsBibs: boolean;
  tagline: string;
  rules: string[];
  hostTips: string[];
  defaults: Record<string, number>;
  fields: ConfigField[];
}

export const GAMES: Record<GameId, GameMeta> = {
  chase: {
    id: 'chase',
    name: 'Chase',
    emoji: '🏃',
    minPlayers: 3,
    needsBibs: true,
    tagline: 'Hunters scan the QR on your back. Every runner they catch joins the hunt.',
    rules: [
      'The app deals the sides at random when the round starts. Nobody picks, not even the organiser.',
      'Everyone wears a numbered bib QR between the shoulders.',
      'Runners get a head start. Hunters are frozen until the release.',
      'To catch a runner, a hunter holds their camera on the runner’s bib until the ring fills.',
      'If the camera loses the bib for more than a second, the scan breaks and the runner got away.',
      'A caught runner becomes a hunter, keeps the runner points they earned and starts scoring as a hunter.',
      'If the camera will not work, the caught runner taps “I got caught” and types the hunter’s 4-digit claim code.',
      'Stay inside the area. Outside for more than 30 seconds and you are out for the round.',
      'Runners score 10 points per minute alive. Hunters score 25 points per catch.',
      'The round ends when time runs out, when every runner is caught, or when no hunters are left.',
    ],
    hostTips: [
      'Print bibs at A5 or bigger on matte paper, QR at least 10 cm wide.',
      'Walk the edge of the area with everyone before you start.',
      'Phone GPS is off by 5–20 m. Pick an area with clear edges like paths, fences or walls.',
      'Agree on an SOS meeting point. The SOS button alerts you on your screen.',
    ],
    defaults: {
      durationSecs: 1200,
      releaseDelaySecs: 60,
      holdSecs: 5,
      radarRange: 10,
      tagMaxDistance: 60,
    },
    fields: [
      { key: 'durationSecs', label: 'Round length', unit: 'min', min: 300, max: 3600, step: 60, minutes: true },
      { key: 'holdSecs', label: 'Camera hold to convert', unit: 's', min: 5, max: 10, step: 1 },
      {
        key: 'radarRange',
        label: 'Radar range',
        unit: 'm',
        min: 5,
        max: 50,
        step: 1,
        help: 'Phone GPS is off by 5–20 m, so widen it if dots keep vanishing.',
      },
      { key: 'releaseDelaySecs', label: 'Head-start delay', unit: 's', min: 0, max: 300, step: 15 },
      {
        key: 'tagMaxDistance',
        label: 'Max GPS distance for a tag',
        unit: 'm',
        min: 20,
        max: 200,
        step: 5,
        help: 'Anti-cheat: rejects a scan if both phones have good GPS and are further apart.',
      },
    ],
  },
};

export const GAME_IDS = Object.keys(GAMES) as GameId[];
export const isGameId = (x: unknown): x is GameId => typeof x === 'string' && x in GAMES;

/** Fill defaults and clamp every value into its field range. Never trust a posted config. */
export function normalizeConfig(game: GameId, input: unknown): Record<string, number> {
  const meta = GAMES[game];
  const src = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const out: Record<string, number> = { ...meta.defaults };
  for (const f of meta.fields) {
    const raw = src[f.key];
    if (raw === undefined || raw === null || raw === '') continue;
    const v = Number(raw);
    if (Number.isFinite(v)) out[f.key] = Math.min(f.max, Math.max(f.min, Math.round(v / f.step) * f.step));
  }
  return out;
}

export const HUNTER_SHARE = { min: 0.35, max: 0.45 } as const;

const fit = (n: number, k: number) => Math.min(Math.max(k, 1), Math.max(1, Math.floor((n - 1) / 2)));

/**
 * Random share per round, then randomised rounding so small games vary too.
 * Always at least one hunter and always fewer hunters than runners.
 */
export function hunterCount(n: number, rand: () => number = Math.random): number {
  if (n < 2) return 0;
  const share = HUNTER_SHARE.min + (HUNTER_SHARE.max - HUNTER_SHARE.min) * rand();
  return fit(n, Math.floor(n * share + rand()));
}

/** Fisher–Yates on a copy. */
export function shuffle<T>(xs: readonly T[], rand: () => number = Math.random): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const POINTS = { perConversion: 25, runnerPerMinute: 10 } as const;
export const runnerPoints = (secs: number) => Math.floor((Math.max(0, secs) * POINTS.runnerPerMinute) / 60);
export const hunterPoints = (conversions: number) => conversions * POINTS.perConversion;

/** null = they were never on that side. */
export interface TeamPoints {
  runner: number | null;
  hunter: number | null;
}

export const TEAM_LABEL: Record<Team, string> = { hunter: 'Hunter', runner: 'Runner' };
export const TEAM_PLURAL: Record<Team, string> = { hunter: 'Hunters', runner: 'Runners' };
