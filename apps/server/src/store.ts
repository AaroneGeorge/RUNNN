// Persistence for the community side: profiles, events, RSVPs, game results.
// node:sqlite (built into Node 22.13+) — one file, zero native deps.

import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes, randomInt, scryptSync, timingSafeEqual } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  BADGES,
  EMAIL_RE,
  HOST_NAME_RE,
  levelForXp,
  normalizeEmail,
  normalizeHostName,
  xpForResult,
  type Badge,
  type CreateEventRequest,
  type EventItem,
  type GameHistoryRow,
  type GameId,
  type GameResult,
  type HighScoreRow,
  type HostGameLog,
  type HostGameRow,
  type LeaderRow,
  type Profile,
} from '@kalikkam/shared';

const id = (n = 8) => randomBytes(n).toString('hex');

/** Something the user can fix (bad email, wrong code, too many tries): shown to them as is. */
export class AuthError extends Error {}

const CODE_TTL_MS = 10 * 60_000;
const CODE_MAX_TRIES = 5;
const RESEND_AFTER_MS = 30_000;
const MAX_SENDS_PER_HOUR = 5;
const hashCode = (email: string, code: string) => createHash('sha256').update(`${email}:${code}`).digest();

const HOST_SESSION_MS = 30 * 86400_000;
const hashPassword = (password: string, salt: Uint8Array) => scryptSync(password, salt, 32);
/** Hashed against when the username doesn't exist, so a wrong username takes as long as a wrong password. */
const DUMMY_SALT = randomBytes(16);

export class Store {
  db: DatabaseSync;
  /** With World ID set up, claiming an event spot needs a verified profile (index.ts sets this). */
  requireHuman = false;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS profiles (
        id TEXT PRIMARY KEY, token TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
        created_at INTEGER NOT NULL, xp INTEGER NOT NULL DEFAULT 0,
        games INTEGER NOT NULL DEFAULT 0, wins INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS badges (
        profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        badge_id TEXT NOT NULL, earned_at INTEGER NOT NULL,
        PRIMARY KEY (profile_id, badge_id)
      );
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, game TEXT NOT NULL,
        starts_at INTEGER NOT NULL, place TEXT NOT NULL, lat REAL, lng REAL,
        capacity INTEGER NOT NULL, notes TEXT NOT NULL DEFAULT '',
        host_id TEXT NOT NULL REFERENCES profiles(id), room_code TEXT,
        created_at INTEGER NOT NULL, cancelled INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS rsvps (
        event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        status TEXT NOT NULL, created_at INTEGER NOT NULL,
        PRIMARY KEY (event_id, profile_id)
      );
      CREATE TABLE IF NOT EXISTS results (
        id INTEGER PRIMARY KEY AUTOINCREMENT, room_code TEXT NOT NULL, game TEXT NOT NULL,
        title TEXT NOT NULL, ended_at INTEGER NOT NULL, players INTEGER NOT NULL,
        headline TEXT NOT NULL, event_id TEXT, json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS player_results (
        result_id INTEGER NOT NULL REFERENCES results(id) ON DELETE CASCADE,
        profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        role TEXT, won INTEGER NOT NULL, score INTEGER NOT NULL, xp INTEGER NOT NULL,
        stats TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS pr_profile ON player_results(profile_id);
      CREATE TABLE IF NOT EXISTS hosts (
        username TEXT PRIMARY KEY, pass_hash BLOB NOT NULL, salt BLOB NOT NULL,
        profile_id TEXT REFERENCES profiles(id), created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS host_sessions (
        token TEXT PRIMARY KEY, username TEXT NOT NULL REFERENCES hosts(username) ON DELETE CASCADE,
        created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS world_humans (
        action TEXT NOT NULL, nullifier TEXT NOT NULL,
        profile_id TEXT NOT NULL UNIQUE REFERENCES profiles(id) ON DELETE CASCADE,
        credential TEXT NOT NULL, sybil_score INTEGER, verified_at INTEGER NOT NULL,
        PRIMARY KEY (action, nullifier)
      );
      CREATE TABLE IF NOT EXISTS wallets (
        profile_id TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
        address TEXT NOT NULL UNIQUE, sealed_key TEXT NOT NULL,
        top_ups INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS game_logs (
        result_id INTEGER PRIMARY KEY REFERENCES results(id) ON DELETE CASCADE,
        json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS ev_starts ON events(starts_at);
      CREATE TABLE IF NOT EXISTS email_codes (
        email TEXT PRIMARY KEY, code_hash BLOB NOT NULL, expires_at INTEGER NOT NULL,
        tries INTEGER NOT NULL DEFAULT 0, sent_at INTEGER NOT NULL,
        window_start INTEGER NOT NULL, sends INTEGER NOT NULL
      );
    `);
    // Profiles made before email sign-in existed have no email column yet.
    const cols = this.db.prepare('PRAGMA table_info(profiles)').all() as { name: string }[];
    if (!cols.some((c) => c.name === 'email')) this.db.exec('ALTER TABLE profiles ADD COLUMN email TEXT');
    this.db.exec('CREATE UNIQUE INDEX IF NOT EXISTS profiles_email ON profiles(email) WHERE email IS NOT NULL');
    // Points per board (null when the player wasn't on that side); results saved before points have none.
    const prCols = this.db.prepare('PRAGMA table_info(player_results)').all() as { name: string }[];
    for (const c of ['survivor_points', 'zombie_points']) {
      if (!prCols.some((x) => x.name === c)) this.db.exec(`ALTER TABLE player_results ADD COLUMN ${c} INTEGER`);
    }
  }

  // ---- email sign-in ---------------------------------------------------------------

  /** Make a 6-digit code for `email` (only its hash is stored). Rate-limited per address. */
  startEmailLogin(rawEmail: string, now = Date.now()): { email: string; code: string } {
    const email = normalizeEmail(rawEmail ?? '');
    if (email.length > 254 || !EMAIL_RE.test(email)) throw new AuthError('That email address looks wrong.');
    const row = this.db.prepare('SELECT sent_at, window_start, sends FROM email_codes WHERE email = ?').get(email) as
      | { sent_at: number; window_start: number; sends: number }
      | undefined;
    if (row && now - row.sent_at < RESEND_AFTER_MS) throw new AuthError('A code is on its way. Ask for another in a few seconds.');
    const fresh = !row || now - row.window_start > 3600_000;
    if (!fresh && row!.sends >= MAX_SENDS_PER_HOUR) throw new AuthError('Too many codes for this email. Try again in an hour.');
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    this.db
      .prepare(
        `INSERT INTO email_codes (email, code_hash, expires_at, tries, sent_at, window_start, sends) VALUES (?, ?, ?, 0, ?, ?, 1)
         ON CONFLICT(email) DO UPDATE SET code_hash = excluded.code_hash, expires_at = excluded.expires_at, tries = 0,
           sent_at = excluded.sent_at, window_start = ?, sends = ?`,
      )
      .run(email, hashCode(email, code), now + CODE_TTL_MS, now, now, fresh ? now : row!.window_start, fresh ? 1 : row!.sends + 1);
    return { email, code };
  }

  /**
   * Check a code and sign in. The address's profile if it has one; otherwise the guest profile signing in
   * (`guestPid`) keeps its XP and gets the email; otherwise a new profile.
   */
  verifyEmailLogin(rawEmail: string, rawCode: string, guestPid: string | null, now = Date.now()): { pid: string; token: string; created: boolean; email: string } {
    const email = normalizeEmail(rawEmail ?? '');
    const code = String(rawCode ?? '').replace(/\D/g, '');
    const row = this.db.prepare('SELECT code_hash, expires_at, tries FROM email_codes WHERE email = ?').get(email) as
      | { code_hash: Uint8Array; expires_at: number; tries: number }
      | undefined;
    if (!row || now > row.expires_at) throw new AuthError('That code has expired. Ask for a new one.');
    if (row.tries >= CODE_MAX_TRIES) throw new AuthError('Too many wrong tries. Ask for a new code.');
    const ok = code.length === 6 && timingSafeEqual(Buffer.from(row.code_hash), hashCode(email, code));
    if (!ok) {
      this.db.prepare('UPDATE email_codes SET tries = tries + 1 WHERE email = ?').run(email);
      const left = CODE_MAX_TRIES - row.tries - 1;
      throw new AuthError(left > 0 ? `Wrong code. ${left} ${left === 1 ? 'try' : 'tries'} left.` : 'Too many wrong tries. Ask for a new code.');
    }
    this.db.prepare('DELETE FROM email_codes WHERE email = ?').run(email);
    const owner = this.db.prepare('SELECT id, token FROM profiles WHERE email = ?').get(email) as { id: string; token: string } | undefined;
    if (owner) return { pid: owner.id, token: owner.token, created: false, email };
    if (guestPid) {
      const guest = this.db.prepare('SELECT id, token, email FROM profiles WHERE id = ?').get(guestPid) as { id: string; token: string; email: string | null } | undefined;
      if (guest && !guest.email) {
        this.db.prepare('UPDATE profiles SET email = ? WHERE id = ?').run(email, guest.id);
        return { pid: guest.id, token: guest.token, created: false, email };
      }
    }
    const made = this.createProfile(email.split('@')[0]);
    this.db.prepare('UPDATE profiles SET email = ? WHERE id = ?').run(email, made.profile.id);
    return { pid: made.profile.id, token: made.token, created: true, email };
  }

  emailOf(pid: string): string | null {
    return ((this.db.prepare('SELECT email FROM profiles WHERE id = ?').get(pid) as { email: string | null } | undefined)?.email) ?? null;
  }

  // ---- profiles -------------------------------------------------------------

  createProfile(name: string): { profile: Profile; token: string } {
    const pid = id(6);
    const token = id(24);
    const clean = cleanName(name);
    this.db.prepare('INSERT INTO profiles (id, token, name, created_at) VALUES (?, ?, ?, ?)').run(pid, token, clean, Date.now());
    return { profile: this.profile(pid)!, token };
  }

  profileIdForToken(token: string | null | undefined): string | null {
    if (!token) return null;
    const row = this.db.prepare('SELECT id FROM profiles WHERE token = ?').get(token) as { id: string } | undefined;
    return row?.id ?? null;
  }

  renameProfile(pid: string, name: string) {
    this.db.prepare('UPDATE profiles SET name = ? WHERE id = ?').run(cleanName(name), pid);
  }

  profile(pid: string): Profile | null {
    const r = this.db.prepare('SELECT * FROM profiles WHERE id = ?').get(pid) as any;
    if (!r) return null;
    const badges = (this.db.prepare('SELECT badge_id FROM badges WHERE profile_id = ? ORDER BY earned_at').all(pid) as any[])
      .map((b) => BADGES[b.badge_id])
      .filter(Boolean) as Badge[];
    const best = this.db
      .prepare('SELECT MAX(survivor_points) AS survivor, MAX(zombie_points) AS zombie FROM player_results WHERE profile_id = ?')
      .get(pid) as { survivor: number | null; zombie: number | null };
    return {
      id: r.id,
      name: r.name,
      createdAt: r.created_at,
      xp: r.xp,
      level: levelForXp(r.xp),
      gamesPlayed: r.games,
      wins: r.wins,
      best: { survivor: best.survivor, zombie: best.zombie },
      verifiedHuman: this.isVerifiedHuman(pid),
      badges,
    };
  }

  history(pid: string, limit = 30): GameHistoryRow[] {
    return (
      this.db
        .prepare(
          `SELECT r.room_code, r.game, r.title, r.ended_at, pr.role, pr.won, pr.xp, pr.survivor_points, pr.zombie_points
           FROM player_results pr JOIN results r ON r.id = pr.result_id
           WHERE pr.profile_id = ? ORDER BY r.ended_at DESC LIMIT ?`,
        )
        .all(pid, limit) as any[]
    ).map((r) => ({
      roomCode: r.room_code,
      game: r.game,
      title: r.title,
      endedAt: r.ended_at,
      role: r.role,
      won: !!r.won,
      points: { survivor: r.survivor_points, zombie: r.zombie_points },
      xp: r.xp,
    }));
  }

  /** Best single-game score per player on one board, highest first. */
  highScores(board: 'survivor' | 'zombie', sinceMs: number | null, limit = 50): HighScoreRow[] {
    const col = board === 'survivor' ? 'pr.survivor_points' : 'pr.zombie_points';
    return (
      this.db
        .prepare(
          `SELECT p.id, p.name, p.xp, MAX(${col}) AS best, COUNT(*) AS games
           FROM player_results pr JOIN results r ON r.id = pr.result_id JOIN profiles p ON p.id = pr.profile_id
           WHERE ${col} IS NOT NULL AND r.ended_at >= ? GROUP BY p.id ORDER BY best DESC, MIN(r.ended_at) LIMIT ?`,
        )
        .all(sinceMs ?? 0, limit) as any[]
    ).map((r) => ({ id: r.id, name: r.name, level: levelForXp(r.xp), best: r.best, games: r.games }));
  }

  leaderboard(sinceMs: number | null, limit = 50): LeaderRow[] {
    if (sinceMs === null) {
      return (this.db.prepare('SELECT id, name, xp, wins, games FROM profiles WHERE games > 0 ORDER BY xp DESC LIMIT ?').all(limit) as any[]).map(
        (r) => ({ id: r.id, name: r.name, xp: r.xp, level: levelForXp(r.xp), wins: r.wins, gamesPlayed: r.games }),
      );
    }
    return (
      this.db
        .prepare(
          `SELECT p.id, p.name, p.xp AS total, SUM(pr.xp) AS xp, SUM(pr.won) AS wins, COUNT(*) AS games
           FROM player_results pr JOIN results r ON r.id = pr.result_id JOIN profiles p ON p.id = pr.profile_id
           WHERE r.ended_at >= ? GROUP BY p.id ORDER BY xp DESC LIMIT ?`,
        )
        .all(sinceMs, limit) as any[]
    ).map((r) => ({ id: r.id, name: r.name, xp: r.xp, level: levelForXp(r.total), wins: r.wins, gamesPlayed: r.games }));
  }

  // ---- results ---------------------------------------------------------------

  /**
   * Save a finished game and award XP + badges to every linked profile.
   * Returns per-profile XP so the server can tell players what they earned.
   */
  saveResult(
    room: { code: string; game: GameId; title: string; eventId: string | null },
    result: GameResult,
    profileOf: (playerId: string) => string | null,
    /** The round's game log (scans, credits, host actions, GPS health). */
    journal: unknown[] = [],
  ): Map<string, { xp: number; badges: Badge[] }> {
    const awarded = new Map<string, { xp: number; badges: Badge[] }>();
    const tx = this.db.prepare('BEGIN');
    tx.run();
    try {
      const info = this.db
        .prepare('INSERT INTO results (room_code, game, title, ended_at, players, headline, event_id, json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(room.code, room.game, room.title, result.endedAt, result.rows.length, result.headline, room.eventId, JSON.stringify(result));
      const rid = Number(info.lastInsertRowid);
      this.db.prepare('INSERT INTO game_logs (result_id, json) VALUES (?, ?)').run(rid, JSON.stringify(journal));
      const seen = new Set<string>();
      for (const row of result.rows) {
        const pid = profileOf(row.id);
        if (!pid || seen.has(pid)) continue;
        seen.add(pid);
        // Eliminated for leaving the play area: only the XP for turning up.
        const xp = row.status === 'eliminated' ? xpForResult(false, 0) : xpForResult(row.won, row.stats.infections ?? 0);
        // `score` is a leftover column from an older points system; always 0. Points live in the two columns after it.
        this.db
          .prepare(
            'INSERT INTO player_results (result_id, profile_id, role, won, score, xp, stats, survivor_points, zombie_points) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          )
          .run(rid, pid, row.role, row.won ? 1 : 0, 0, xp, JSON.stringify(row.stats), row.points?.survivor ?? null, row.points?.zombie ?? null);
        this.db.prepare('UPDATE profiles SET xp = xp + ?, games = games + 1, wins = wins + ? WHERE id = ?').run(xp, row.won ? 1 : 0, pid);
        const prof = this.db.prepare('SELECT games, wins FROM profiles WHERE id = ?').get(pid) as any;
        const earned: string[] = ['first_game'];
        if (row.won) earned.push('first_win');
        if (prof.games >= 10) earned.push('regular');
        if (prof.games >= 50) earned.push('legend');
        const s = row.stats;
        if ((s.infections ?? 0) >= 3) earned.push('patient_zero');
        if (row.role === 'survivor' && row.status === 'active' && row.won) earned.push('last_stand');
        const fresh: Badge[] = [];
        for (const b of earned) {
          const r = this.db.prepare('INSERT OR IGNORE INTO badges (profile_id, badge_id, earned_at) VALUES (?, ?, ?)').run(pid, b, Date.now());
          if (r.changes) fresh.push(BADGES[b]);
        }
        awarded.set(row.id, { xp, badges: fresh });
      }
      this.db.prepare('COMMIT').run();
    } catch (e) {
      this.db.prepare('ROLLBACK').run();
      throw e;
    }
    return awarded;
  }

  // ---- World ID: one profile per human ---------------------------------------------

  isVerifiedHuman(pid: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM world_humans WHERE profile_id = ?').get(pid);
  }

  /**
   * Record that `pid` belongs to the person behind `nullifier` (World's RP-scoped ID for this action).
   * The same person can verify the same profile again; a second profile is refused.
   */
  recordHuman(pid: string, action: string, nullifier: string, credential: string, sybilScore: number | null, now = Date.now()) {
    const owner = this.db.prepare('SELECT profile_id FROM world_humans WHERE action = ? AND nullifier = ?').get(action, nullifier) as
      | { profile_id: string }
      | undefined;
    if (owner && owner.profile_id !== pid) {
      throw new AuthError('You already verified another Kalikkam profile. Sign in to that one (e.g. with your email) to claim spots.');
    }
    if (owner) return;
    this.db
      .prepare('INSERT INTO world_humans (action, nullifier, profile_id, credential, sybil_score, verified_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(action, nullifier, pid, credential, sybilScore, now);
  }

  // ---- Kalikkam wallets (Arc Testnet, made after the World ID check) ------------------

  wallet(pid: string): { address: string; sealed: string; topUps: number } | null {
    const r = this.db.prepare('SELECT address, sealed_key, top_ups FROM wallets WHERE profile_id = ?').get(pid) as
      | { address: string; sealed_key: string; top_ups: number }
      | undefined;
    return r ? { address: r.address, sealed: r.sealed_key, topUps: r.top_ups } : null;
  }

  saveWallet(pid: string, address: string, sealed: string, now = Date.now()) {
    this.db.prepare('INSERT OR IGNORE INTO wallets (profile_id, address, sealed_key, created_at) VALUES (?, ?, ?, ?)').run(pid, address, sealed, now);
  }

  countTopUp(pid: string) {
    this.db.prepare('UPDATE wallets SET top_ups = top_ups + 1 WHERE profile_id = ?').run(pid);
  }

  // ---- host accounts -------------------------------------------------------------

  /** Create a host account, or change its password (which signs that host out everywhere). */
  setHostPassword(rawUser: string, password: string) {
    const username = normalizeHostName(rawUser);
    if (!HOST_NAME_RE.test(username)) throw new AuthError('A host username is 3–24 letters, digits, dots, dashes or underscores.');
    if (password.length < 8) throw new AuthError('Use a password of at least 8 characters.');
    const salt = randomBytes(16);
    this.db
      .prepare(
        `INSERT INTO hosts (username, pass_hash, salt, created_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(username) DO UPDATE SET pass_hash = excluded.pass_hash, salt = excluded.salt`,
      )
      .run(username, hashPassword(password, salt), salt, Date.now());
    this.db.prepare('DELETE FROM host_sessions WHERE username = ?').run(username);
  }

  /** True if `password` is this host's password. */
  checkHostPassword(rawUser: string, password: string): boolean {
    const row = this.db.prepare('SELECT pass_hash, salt FROM hosts WHERE username = ?').get(normalizeHostName(rawUser)) as
      | { pass_hash: Uint8Array; salt: Uint8Array }
      | undefined;
    const hash = hashPassword(password, row?.salt ?? DUMMY_SALT);
    return !!row && timingSafeEqual(hash, Buffer.from(row.pass_hash));
  }

  removeHost(rawUser: string): boolean {
    return this.db.prepare('DELETE FROM hosts WHERE username = ?').run(normalizeHostName(rawUser)).changes > 0;
  }

  hostNames(): string[] {
    return (this.db.prepare('SELECT username FROM hosts ORDER BY username').all() as { username: string }[]).map((r) => r.username);
  }

  /** Sign a host in. They're also signed in to their own player profile (made on first sign-in). */
  hostLogin(rawUser: string, password: string, now = Date.now()): { username: string; token: string; pid: string; profileToken: string } {
    const username = normalizeHostName(rawUser);
    if (!this.checkHostPassword(username, password)) throw new AuthError('Wrong username or password.');
    const row = this.db.prepare('SELECT profile_id FROM hosts WHERE username = ?').get(username) as { profile_id: string | null };
    let pid = row.profile_id && this.profile(row.profile_id) ? row.profile_id : null;
    if (!pid) {
      pid = this.createProfile(username).profile.id;
      this.db.prepare('UPDATE hosts SET profile_id = ? WHERE username = ?').run(pid, username);
    }
    const token = id(24);
    this.db.prepare('INSERT INTO host_sessions (token, username, created_at, expires_at) VALUES (?, ?, ?, ?)').run(token, username, now, now + HOST_SESSION_MS);
    const profileToken = (this.db.prepare('SELECT token FROM profiles WHERE id = ?').get(pid) as { token: string }).token;
    return { username, token, pid, profileToken };
  }

  hostForToken(token: string | null | undefined, now = Date.now()): { username: string; pid: string | null } | null {
    if (!token) return null;
    const r = this.db
      .prepare('SELECT s.username, h.profile_id FROM host_sessions s JOIN hosts h ON h.username = s.username WHERE s.token = ? AND s.expires_at > ?')
      .get(token, now) as { username: string; profile_id: string | null } | undefined;
    return r ? { username: r.username, pid: r.profile_id } : null;
  }

  hostLogout(token: string) {
    this.db.prepare('DELETE FROM host_sessions WHERE token = ?').run(token);
  }

  /** Finished games for the host dashboard, newest first, with what each game's log says. */
  recentGames(limit = 30): HostGameRow[] {
    const rows = this.db
      .prepare(
        `SELECT r.id, r.room_code, r.title, r.ended_at, r.players, r.headline, l.json AS log
         FROM results r LEFT JOIN game_logs l ON l.result_id = r.id ORDER BY r.ended_at DESC LIMIT ?`,
      )
      .all(limit) as { id: number; room_code: string; title: string; ended_at: number; players: number; headline: string; log: string | null }[];
    return rows.map((r) => {
      const log = (r.log ? JSON.parse(r.log) : []) as { kind: string; how?: string; outcome?: string; action?: string; reason?: string | null; gaps?: number }[];
      const infections = { scan: 0, code: 0, unknown: 0 };
      for (const e of log) if (e.kind === 'infect' && e.how && e.how in infections) infections[e.how as keyof typeof infections]++;
      return {
        id: r.id,
        code: r.room_code,
        title: r.title,
        endedAt: r.ended_at,
        players: r.players,
        headline: r.headline,
        endReason: log.find((e) => e.kind === 'host' && e.action === 'end')?.reason ?? null,
        infections,
        eliminated: log.filter((e) => e.kind === 'out' && e.outcome === 'eliminated').length,
        gpsDropouts: log.filter((e) => e.kind === 'gps' && (e.gaps ?? 0) > 0).length,
        hasLog: log.length > 0,
      };
    });
  }

  gameLog(resultId: number): HostGameLog | null {
    const r = this.db
      .prepare('SELECT r.json AS result, l.json AS log FROM results r LEFT JOIN game_logs l ON l.result_id = r.id WHERE r.id = ?')
      .get(resultId) as { result: string; log: string | null } | undefined;
    return r ? { result: JSON.parse(r.result), log: r.log ? JSON.parse(r.log) : [] } : null;
  }

  // ---- events ------------------------------------------------------------------

  createEvent(hostId: string, req: CreateEventRequest): EventItem {
    const eid = id(5);
    this.db
      .prepare(
        `INSERT INTO events (id, title, game, starts_at, place, lat, lng, capacity, notes, host_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        eid,
        req.title.trim().slice(0, 80),
        req.game,
        req.startsAt,
        req.place.trim().slice(0, 120),
        req.lat ?? null,
        req.lng ?? null,
        Math.max(2, Math.min(500, Math.round(req.capacity))),
        (req.notes ?? '').trim().slice(0, 1000),
        hostId,
        Date.now(),
      );
    this.rsvp(eid, hostId);
    return this.event(eid, hostId)!;
  }

  event(eid: string, viewer: string | null): EventItem | null {
    const r = this.db
      .prepare('SELECT e.*, p.name AS host_name FROM events e JOIN profiles p ON p.id = e.host_id WHERE e.id = ? AND e.cancelled = 0')
      .get(eid) as any;
    if (!r) return null;
    const rs = this.db
      .prepare('SELECT r.profile_id, r.status, p.name FROM rsvps r JOIN profiles p ON p.id = r.profile_id WHERE r.event_id = ? ORDER BY r.created_at')
      .all(eid) as any[];
    const mine = viewer ? rs.find((x) => x.profile_id === viewer) : undefined;
    return {
      id: r.id,
      title: r.title,
      game: r.game,
      startsAt: r.starts_at,
      place: r.place,
      lat: r.lat,
      lng: r.lng,
      capacity: r.capacity,
      notes: r.notes,
      hostId: r.host_id,
      hostName: r.host_name,
      going: rs.filter((x) => x.status === 'going').length,
      waitlist: rs.filter((x) => x.status === 'waitlist').length,
      myRsvp: mine ? mine.status : null,
      needsHuman: this.requireHuman && !mine && !(viewer && this.isVerifiedHuman(viewer)),
      roomCode: r.room_code,
      attendees: rs.filter((x) => x.status === 'going').map((x) => ({ id: x.profile_id, name: x.name })),
    };
  }

  events(viewer: string | null): EventItem[] {
    const ids = this.db
      .prepare('SELECT id FROM events WHERE cancelled = 0 AND starts_at > ? ORDER BY starts_at LIMIT 100')
      .all(Date.now() - 3 * 3600_000) as any[];
    return ids.map((r) => this.event(r.id, viewer)!).filter(Boolean);
  }

  rsvp(eid: string, pid: string): 'going' | 'waitlist' {
    const ev = this.db.prepare('SELECT capacity FROM events WHERE id = ? AND cancelled = 0').get(eid) as any;
    if (!ev) throw new Error('Event not found');
    const existing = this.db.prepare('SELECT status FROM rsvps WHERE event_id = ? AND profile_id = ?').get(eid, pid) as any;
    if (existing) return existing.status;
    const going = (this.db.prepare("SELECT COUNT(*) AS n FROM rsvps WHERE event_id = ? AND status = 'going'").get(eid) as any).n;
    const status = going < ev.capacity ? 'going' : 'waitlist';
    this.db.prepare('INSERT INTO rsvps (event_id, profile_id, status, created_at) VALUES (?, ?, ?, ?)').run(eid, pid, status, Date.now());
    return status;
  }

  /** Cancel an RSVP; promotes the first waitlisted person if a seat freed up. */
  unrsvp(eid: string, pid: string): string | null {
    const r = this.db.prepare('SELECT status FROM rsvps WHERE event_id = ? AND profile_id = ?').get(eid, pid) as any;
    if (!r) return null;
    this.db.prepare('DELETE FROM rsvps WHERE event_id = ? AND profile_id = ?').run(eid, pid);
    if (r.status !== 'going') return null;
    const next = this.db
      .prepare("SELECT profile_id FROM rsvps WHERE event_id = ? AND status = 'waitlist' ORDER BY created_at LIMIT 1")
      .get(eid) as any;
    if (!next) return null;
    this.db.prepare("UPDATE rsvps SET status = 'going' WHERE event_id = ? AND profile_id = ?").run(eid, next.profile_id);
    return next.profile_id;
  }

  linkRoom(eid: string, code: string | null) {
    this.db.prepare('UPDATE events SET room_code = ? WHERE id = ?').run(code, eid);
  }

  cancelEvent(eid: string) {
    this.db.prepare('UPDATE events SET cancelled = 1 WHERE id = ?').run(eid);
  }
}

function cleanName(name: string): string {
  return (name ?? '').replace(/\s+/g, ' ').trim().slice(0, 24) || 'Player';
}
