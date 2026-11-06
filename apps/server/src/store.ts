import { createHash, randomBytes, randomInt, scryptSync, timingSafeEqual } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  BADGES,
  badgesFor,
  cleanName,
  levelForXp,
  type Badge,
  type CreateEventBody,
  type EventDetail,
  type EventSummary,
  type GameId,
  type GameResult,
  type HistoryItem,
  type LeaderboardBoard,
  type LeaderboardPeriod,
  type LeaderboardRow,
  type MeResponse,
  type Profile,
  type RsvpStatus,
  xpForResult,
} from '@runnn/shared';

export class StoreError extends Error {
  constructor(
    msg: string,
    public status = 400,
  ) {
    super(msg);
  }
}

const SESSION_MS = 30 * 86400_000;
const CODE_TTL_MS = 10 * 60_000;
const CODE_TRIES = 5;
const CODE_RESEND_MS = 30_000;
const CODE_SENDS_PER_HOUR = 5;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

const id = (bytes = 9) => randomBytes(bytes).toString('base64url');
const sha = (s: string) => createHash('sha256').update(s).digest();
const DUMMY_SALT = randomBytes(16);
const hashPassword = (pw: string, salt: Buffer) => scryptSync(pw, salt, 64);

export const normalizeEmail = (e: unknown) => (typeof e === 'string' ? e.trim().toLowerCase() : '');

type Row = Record<string, any>;

export interface SavedRoundRow {
  playerId: string;
  profileId: string;
  xp: number;
  newBadges: string[];
}

export interface SaveResultInput {
  roomCode: string;
  game: GameId;
  title: string;
  eventId: string | null;
  organiserProfileId: string | null;
  result: GameResult;
  log: unknown;
}

export interface FinishedRound {
  id: number;
  roomCode: string;
  game: GameId;
  title: string;
  endedAt: number;
  players: number;
  headline: string;
  summary: { scans: number; conversions: number; codeAttempts: number; eliminated: number; sos: number } | null;
}

export class Store {
  db: DatabaseSync;

  constructor(path = ':memory:') {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 3000;

      CREATE TABLE IF NOT EXISTS profiles (
        id TEXT PRIMARY KEY, token TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
        created_at INTEGER NOT NULL, xp INTEGER NOT NULL DEFAULT 0,
        games INTEGER NOT NULL DEFAULT 0, wins INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS badges (
        profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        badge_id TEXT NOT NULL, earned_at INTEGER NOT NULL, PRIMARY KEY (profile_id, badge_id));
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, game TEXT NOT NULL, starts_at INTEGER NOT NULL,
        place TEXT NOT NULL, lat REAL, lng REAL, capacity INTEGER NOT NULL, notes TEXT NOT NULL DEFAULT '',
        host_id TEXT NOT NULL REFERENCES profiles(id), room_code TEXT,
        created_at INTEGER NOT NULL, cancelled INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS rsvps (
        event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        status TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (event_id, profile_id));
      CREATE TABLE IF NOT EXISTS results (
        id INTEGER PRIMARY KEY AUTOINCREMENT, room_code TEXT NOT NULL, game TEXT NOT NULL,
        title TEXT NOT NULL, ended_at INTEGER NOT NULL, players INTEGER NOT NULL,
        headline TEXT NOT NULL, event_id TEXT, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS player_results (
        result_id INTEGER NOT NULL REFERENCES results(id) ON DELETE CASCADE,
        profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        role TEXT, won INTEGER NOT NULL, xp INTEGER NOT NULL, stats TEXT NOT NULL,
        runner_points INTEGER, hunter_points INTEGER);
      CREATE INDEX IF NOT EXISTS pr_profile ON player_results(profile_id);
      CREATE TABLE IF NOT EXISTS organisers (
        username TEXT PRIMARY KEY, pass_hash BLOB NOT NULL, salt BLOB NOT NULL,
        profile_id TEXT REFERENCES profiles(id), created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS organiser_sessions (
        token TEXT PRIMARY KEY, username TEXT NOT NULL REFERENCES organisers(username) ON DELETE CASCADE,
        created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS game_logs (
        result_id INTEGER PRIMARY KEY REFERENCES results(id) ON DELETE CASCADE, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS email_codes (
        email TEXT PRIMARY KEY, code_hash BLOB NOT NULL, expires_at INTEGER NOT NULL,
        tries INTEGER NOT NULL DEFAULT 0, sent_at INTEGER NOT NULL,
        window_start INTEGER NOT NULL, sends INTEGER NOT NULL);
    `);
    this.migrate();
  }

  /** Idempotent, runs on every boot: add whatever is missing. */
  private migrate() {
    const cols = this.db.prepare('PRAGMA table_info(profiles)').all() as { name: string }[];
    if (!cols.some((c) => c.name === 'email')) this.db.exec('ALTER TABLE profiles ADD COLUMN email TEXT');
    this.db.exec('CREATE UNIQUE INDEX IF NOT EXISTS profiles_email ON profiles(email) WHERE email IS NOT NULL');
    this.db.exec('CREATE INDEX IF NOT EXISTS results_ended ON results(ended_at)');
    if (!cols.some((c) => c.name === 'world_nullifier')) {
      this.db.exec('ALTER TABLE profiles ADD COLUMN world_nullifier TEXT');
      this.db.exec('ALTER TABLE profiles ADD COLUMN world_verified_at INTEGER');
    }
    // One human (per app + action) can own exactly one profile.
    this.db.exec('CREATE UNIQUE INDEX IF NOT EXISTS profiles_world ON profiles(world_nullifier) WHERE world_nullifier IS NOT NULL');
  }

  close() {
    this.db.close();
  }

  private tx<T>(fn: () => T): T {
    this.db.exec('BEGIN');
    try {
      const out = fn();
      this.db.exec('COMMIT');
      return out;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  // ───────────────────────────── profiles ─────────────────────────────

  createProfile(rawName: unknown, now = Date.now()): { profile: Profile; token: string } {
    const name = cleanName(rawName);
    if (!name) throw new StoreError('Pick a name first.');
    const pid = id();
    const token = id(24);
    this.db
      .prepare('INSERT INTO profiles (id, token, name, created_at) VALUES (?, ?, ?, ?)')
      .run(pid, token, name, now);
    return { profile: this.profile(pid)!, token };
  }

  profileIdByToken(token: unknown): string | null {
    if (typeof token !== 'string' || !token) return null;
    const r = this.db.prepare('SELECT id FROM profiles WHERE token = ?').get(token) as Row | undefined;
    return r ? (r.id as string) : null;
  }

  profile(pid: string): Profile | null {
    const r = this.db.prepare('SELECT * FROM profiles WHERE id = ?').get(pid) as Row | undefined;
    if (!r) return null;
    const best = this.db
      .prepare('SELECT MAX(runner_points) AS r, MAX(hunter_points) AS h FROM player_results WHERE profile_id = ?')
      .get(pid) as Row;
    const badges = (
      this.db.prepare('SELECT badge_id, earned_at FROM badges WHERE profile_id = ? ORDER BY earned_at').all(pid) as Row[]
    )
      .filter((b) => BADGES[b.badge_id])
      .map((b): Badge => ({ ...BADGES[b.badge_id], earnedAt: b.earned_at }));
    return {
      id: r.id,
      name: r.name,
      createdAt: r.created_at,
      xp: r.xp,
      level: levelForXp(r.xp),
      gamesPlayed: r.games,
      wins: r.wins,
      best: { runner: best.r ?? null, hunter: best.h ?? null },
      badges,
      humanVerified: r.world_nullifier != null,
    };
  }

  rename(pid: string, rawName: unknown): Profile {
    const name = cleanName(rawName);
    if (!name) throw new StoreError('Pick a name first.');
    this.db.prepare('UPDATE profiles SET name = ? WHERE id = ?').run(name, pid);
    return this.profile(pid)!;
  }

  history(pid: string, limit = 30): HistoryItem[] {
    const rows = this.db
      .prepare(
        `SELECT r.id, r.game, r.title, r.ended_at, r.headline, pr.role, pr.won, pr.xp, pr.runner_points, pr.hunter_points
         FROM player_results pr JOIN results r ON r.id = pr.result_id
         WHERE pr.profile_id = ? ORDER BY r.ended_at DESC LIMIT ?`,
      )
      .all(pid, limit) as Row[];
    return rows.map((r) => ({
      resultId: r.id,
      game: r.game,
      title: r.title,
      endedAt: r.ended_at,
      role: r.role,
      won: !!r.won,
      xp: r.xp,
      points: { runner: r.runner_points, hunter: r.hunter_points },
      headline: r.headline,
    }));
  }

  me(pid: string): MeResponse | null {
    const profile = this.profile(pid);
    if (!profile) return null;
    const e = this.db.prepare('SELECT email FROM profiles WHERE id = ?').get(pid) as Row;
    return { profile, history: this.history(pid), email: e.email ?? null };
  }

  // ───────────────────────────── email sign-in ─────────────────────────────

  /** Returns the code to send. Only its hash is stored. */
  startEmail(rawEmail: unknown, now = Date.now()): { email: string; code: string } {
    const email = normalizeEmail(rawEmail);
    if (!EMAIL_RE.test(email) || email.length > 254) throw new StoreError('That does not look like an email address.');
    const prev = this.db.prepare('SELECT * FROM email_codes WHERE email = ?').get(email) as Row | undefined;
    let windowStart = now;
    let sends = 1;
    if (prev) {
      if (now - prev.sent_at < CODE_RESEND_MS) throw new StoreError('Code just sent. Wait 30 seconds before asking again.', 429);
      if (now - prev.window_start < 3600_000) {
        if (prev.sends >= CODE_SENDS_PER_HOUR) throw new StoreError('Too many codes for this address. Try again in an hour.', 429);
        windowStart = prev.window_start;
        sends = prev.sends + 1;
      }
    }
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    this.db
      .prepare(
        `INSERT INTO email_codes (email, code_hash, expires_at, tries, sent_at, window_start, sends)
         VALUES (?, ?, ?, 0, ?, ?, ?)
         ON CONFLICT(email) DO UPDATE SET code_hash = excluded.code_hash, expires_at = excluded.expires_at,
           tries = 0, sent_at = excluded.sent_at, window_start = excluded.window_start, sends = excluded.sends`,
      )
      .run(email, sha(`${email}:${code}`), now + CODE_TTL_MS, now, windowStart, sends);
    return { email, code };
  }

  /**
   * On success: the address's own profile if it has one; else attach the email to the
   * signed-in guest (their XP survives); else a fresh profile.
   */
  verifyEmail(rawEmail: unknown, rawCode: unknown, guestToken?: unknown, now = Date.now()) {
    const email = normalizeEmail(rawEmail);
    const code = typeof rawCode === 'string' ? rawCode.trim() : '';
    const row = this.db.prepare('SELECT * FROM email_codes WHERE email = ?').get(email) as Row | undefined;
    if (!row || row.expires_at < now) throw new StoreError('That code has expired. Ask for a new one.');
    if (row.tries >= CODE_TRIES) throw new StoreError('Too many wrong codes. Ask for a new one.', 429);
    const want = Buffer.from(row.code_hash as Uint8Array);
    const got = sha(`${email}:${code}`);
    if (!/^\d{6}$/.test(code) || !timingSafeEqual(want, got)) {
      this.db.prepare('UPDATE email_codes SET tries = tries + 1 WHERE email = ?').run(email);
      throw new StoreError('Wrong code.');
    }
    this.db.prepare('DELETE FROM email_codes WHERE email = ?').run(email);

    const owner = this.db.prepare('SELECT id, token FROM profiles WHERE email = ?').get(email) as Row | undefined;
    if (owner) return { token: owner.token as string, profile: this.profile(owner.id)!, linked: false };

    const guestId = this.profileIdByToken(guestToken);
    if (guestId) {
      this.db.prepare('UPDATE profiles SET email = ? WHERE id = ?').run(email, guestId);
      const t = this.db.prepare('SELECT token FROM profiles WHERE id = ?').get(guestId) as Row;
      return { token: t.token as string, profile: this.profile(guestId)!, linked: true };
    }

    const { profile, token } = this.createProfile(email.split('@')[0], now);
    this.db.prepare('UPDATE profiles SET email = ? WHERE id = ?').run(email, profile.id);
    return { token, profile, linked: false };
  }

  // ───────────────────────────── World ID ─────────────────────────────

  /**
   * Sign in with a verified World ID nullifier. Same rules as email: the human's own profile
   * if they have one; else mark the signed-in guest as verified (their XP survives); else a new profile.
   */
  loginWithWorld(nullifier: string, rawName?: unknown, guestToken?: unknown, now = Date.now()) {
    if (!/^\d{1,78}$/.test(nullifier)) throw new StoreError('Bad World ID nullifier.');
    const owner = this.db.prepare('SELECT id, token FROM profiles WHERE world_nullifier = ?').get(nullifier) as Row | undefined;
    if (owner) return { token: owner.token as string, profile: this.profile(owner.id)!, linked: false, created: false };

    const guestId = this.profileIdByToken(guestToken);
    if (guestId) {
      const g = this.db.prepare('SELECT world_nullifier FROM profiles WHERE id = ?').get(guestId) as Row;
      if (g.world_nullifier && g.world_nullifier !== nullifier)
        throw new StoreError('This profile is already verified by a different World ID.', 409);
      this.db.prepare('UPDATE profiles SET world_nullifier = ?, world_verified_at = ? WHERE id = ?').run(nullifier, now, guestId);
      const t = this.db.prepare('SELECT token FROM profiles WHERE id = ?').get(guestId) as Row;
      return { token: t.token as string, profile: this.profile(guestId)!, linked: true, created: false };
    }

    const { profile, token } = this.createProfile(cleanName(rawName) || 'Runner', now);
    this.db.prepare('UPDATE profiles SET world_nullifier = ?, world_verified_at = ? WHERE id = ?').run(nullifier, now, profile.id);
    return { token, profile: this.profile(profile.id)!, linked: false, created: true };
  }

  // ───────────────────────────── organisers ─────────────────────────────

  addOrganiser(rawUser: unknown, password: string, now = Date.now()) {
    const username = typeof rawUser === 'string' ? rawUser.trim().toLowerCase() : '';
    if (!/^[a-z0-9_.-]{3,32}$/.test(username)) throw new StoreError('Username: 3–32 of a-z 0-9 _ . -');
    if (password.length < 8) throw new StoreError('Password needs at least 8 characters.');
    const salt = randomBytes(16);
    this.db
      .prepare(
        `INSERT INTO organisers (username, pass_hash, salt, created_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(username) DO UPDATE SET pass_hash = excluded.pass_hash, salt = excluded.salt`,
      )
      .run(username, hashPassword(password, salt), salt, now);
    this.db.prepare('DELETE FROM organiser_sessions WHERE username = ?').run(username);
    return username;
  }

  hasOrganiser(username: string) {
    return !!this.db.prepare('SELECT 1 FROM organisers WHERE username = ?').get(username.toLowerCase());
  }

  removeOrganiser(username: string): boolean {
    return this.db.prepare('DELETE FROM organisers WHERE username = ?').run(username.toLowerCase()).changes > 0;
  }

  listOrganisers(): { username: string; createdAt: number }[] {
    return (this.db.prepare('SELECT username, created_at FROM organisers ORDER BY username').all() as Row[]).map((r) => ({
      username: r.username,
      createdAt: r.created_at,
    }));
  }

  /**
   * Hashes against a dummy salt when the username does not exist, so a wrong username
   * takes as long as a wrong password.
   */
  login(rawUser: unknown, password: unknown, profileToken?: unknown, now = Date.now()) {
    const username = typeof rawUser === 'string' ? rawUser.trim().toLowerCase() : '';
    const pw = typeof password === 'string' ? password : '';
    const row = this.db.prepare('SELECT * FROM organisers WHERE username = ?').get(username) as Row | undefined;
    const got = hashPassword(pw, row ? Buffer.from(row.salt) : DUMMY_SALT);
    if (!row || !timingSafeEqual(got, Buffer.from(row.pass_hash))) return null;

    let pid: string | null = row.profile_id ?? null;
    if (!pid || !this.profile(pid)) {
      pid = this.profileIdByToken(profileToken) ?? this.createProfile(username, now).profile.id;
      this.db.prepare('UPDATE organisers SET profile_id = ? WHERE username = ?').run(pid, username);
    }
    const token = id(24);
    this.db
      .prepare('INSERT INTO organiser_sessions (token, username, created_at, expires_at) VALUES (?, ?, ?, ?)')
      .run(token, username, now, now + SESSION_MS);
    this.db.prepare('DELETE FROM organiser_sessions WHERE expires_at < ?').run(now);
    const p = this.db.prepare('SELECT token FROM profiles WHERE id = ?').get(pid) as Row;
    return { token, username, profileId: pid, profileToken: p.token as string };
  }

  organiser(token: unknown, now = Date.now()): { username: string; profileId: string | null } | null {
    if (typeof token !== 'string' || !token) return null;
    const r = this.db
      .prepare(
        `SELECT o.username, o.profile_id FROM organiser_sessions s JOIN organisers o ON o.username = s.username
         WHERE s.token = ? AND s.expires_at > ?`,
      )
      .get(token, now) as Row | undefined;
    return r ? { username: r.username, profileId: r.profile_id ?? null } : null;
  }

  logout(token: unknown) {
    if (typeof token === 'string') this.db.prepare('DELETE FROM organiser_sessions WHERE token = ?').run(token);
  }

  // ───────────────────────────── events ─────────────────────────────

  createEvent(hostId: string, b: Partial<CreateEventBody>, now = Date.now()): EventDetail {
    const title = cleanName(b.title).slice(0, 60) || '';
    const place = typeof b.place === 'string' ? b.place.trim().slice(0, 120) : '';
    const startsAt = Number(b.startsAt);
    const capacity = Math.round(Number(b.capacity));
    if (!title) throw new StoreError('Give the event a title.');
    if (!place) throw new StoreError('Say where to meet.');
    if (!Number.isFinite(startsAt) || startsAt < now - 3600_000) throw new StoreError('Pick a start time in the future.');
    if (!Number.isFinite(capacity) || capacity < 3 || capacity > 200) throw new StoreError('Capacity is 3–200.');
    const lat = Number.isFinite(b.lat) ? Number(b.lat) : null;
    const lng = Number.isFinite(b.lng) ? Number(b.lng) : null;
    const notes = typeof b.notes === 'string' ? b.notes.trim().slice(0, 1000) : '';
    const eid = id(6);
    this.db
      .prepare(
        `INSERT INTO events (id, title, game, starts_at, place, lat, lng, capacity, notes, host_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(eid, title, b.game ?? 'chase', startsAt, place, lat, lng, capacity, notes, hostId, now);
    this.rsvp(eid, hostId, now);
    return this.event(eid, hostId)!;
  }

  private summary(r: Row, viewer: string | null): EventSummary {
    const counts = this.db
      .prepare(
        `SELECT SUM(status = 'going') AS going, SUM(status = 'waitlist') AS wait FROM rsvps WHERE event_id = ?`,
      )
      .get(r.id) as Row;
    const mine = viewer
      ? ((this.db.prepare('SELECT status FROM rsvps WHERE event_id = ? AND profile_id = ?').get(r.id, viewer) as Row | undefined)
          ?.status ?? null)
      : null;
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
      host: { id: r.host_id, name: r.host_name },
      roomCode: r.room_code,
      going: counts.going ?? 0,
      waitlist: counts.wait ?? 0,
      cancelled: !!r.cancelled,
      mine,
    };
  }

  events(viewer: string | null, now = Date.now()): EventSummary[] {
    const rows = this.db
      .prepare(
        `SELECT e.*, p.name AS host_name FROM events e JOIN profiles p ON p.id = e.host_id
         WHERE e.starts_at > ? ORDER BY e.starts_at LIMIT 100`,
      )
      .all(now - 6 * 3600_000) as Row[];
    return rows.map((r) => this.summary(r, viewer));
  }

  event(eid: string, viewer: string | null): EventDetail | null {
    const r = this.db
      .prepare('SELECT e.*, p.name AS host_name FROM events e JOIN profiles p ON p.id = e.host_id WHERE e.id = ?')
      .get(eid) as Row | undefined;
    if (!r) return null;
    const attendees = (
      this.db
        .prepare(
          `SELECT p.id, p.name, p.xp, r.status FROM rsvps r JOIN profiles p ON p.id = r.profile_id
           WHERE r.event_id = ? ORDER BY r.status = 'waitlist', r.created_at`,
        )
        .all(eid) as Row[]
    ).map((a) => ({ id: a.id, name: a.name, level: levelForXp(a.xp), status: a.status as RsvpStatus }));
    return { ...this.summary(r, viewer), attendees };
  }

  cancelEvent(eid: string, byProfile: string, isOrganiser: boolean) {
    const r = this.db.prepare('SELECT host_id FROM events WHERE id = ?').get(eid) as Row | undefined;
    if (!r) throw new StoreError('No such event.', 404);
    if (r.host_id !== byProfile && !isOrganiser) throw new StoreError('Only the host can cancel this.', 403);
    this.db.prepare('UPDATE events SET cancelled = 1 WHERE id = ?').run(eid);
  }

  setEventRoom(eid: string, code: string) {
    this.db.prepare('UPDATE events SET room_code = ? WHERE id = ?').run(code, eid);
  }

  rsvp(eid: string, pid: string, now = Date.now()): RsvpStatus {
    return this.tx(() => {
      const e = this.db.prepare('SELECT capacity, cancelled FROM events WHERE id = ?').get(eid) as Row | undefined;
      if (!e) throw new StoreError('No such event.', 404);
      if (e.cancelled) throw new StoreError('This event was cancelled.');
      const existing = this.db
        .prepare('SELECT status FROM rsvps WHERE event_id = ? AND profile_id = ?')
        .get(eid, pid) as Row | undefined;
      if (existing) return existing.status as RsvpStatus;
      const going = (this.db.prepare(`SELECT COUNT(*) AS n FROM rsvps WHERE event_id = ? AND status = 'going'`).get(eid) as Row)
        .n as number;
      const status: RsvpStatus = going < e.capacity ? 'going' : 'waitlist';
      this.db
        .prepare('INSERT INTO rsvps (event_id, profile_id, status, created_at) VALUES (?, ?, ?, ?)')
        .run(eid, pid, status, now);
      return status;
    });
  }

  /** Leaving frees a seat: the longest-waiting person moves up. */
  unrsvp(eid: string, pid: string) {
    this.tx(() => {
      const r = this.db.prepare('DELETE FROM rsvps WHERE event_id = ? AND profile_id = ? RETURNING status').get(eid, pid) as
        | Row
        | undefined;
      if (r?.status !== 'going') return;
      const next = this.db
        .prepare(`SELECT profile_id FROM rsvps WHERE event_id = ? AND status = 'waitlist' ORDER BY created_at LIMIT 1`)
        .get(eid) as Row | undefined;
      if (next)
        this.db.prepare(`UPDATE rsvps SET status = 'going' WHERE event_id = ? AND profile_id = ?`).run(eid, next.profile_id);
    });
  }

  // ───────────────────────────── results ─────────────────────────────

  saveResult(input: SaveResultInput): { resultId: number; rows: SavedRoundRow[] } {
    const { result } = input;
    return this.tx(() => {
      const r = this.db
        .prepare(
          `INSERT INTO results (room_code, game, title, ended_at, players, headline, event_id, json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.roomCode,
          input.game,
          input.title,
          result.endedAt,
          result.rows.filter((x) => !x.isBot).length,
          result.headline,
          input.eventId,
          JSON.stringify(result),
        );
      const resultId = Number(r.lastInsertRowid);
      this.db.prepare('INSERT INTO game_logs (result_id, json) VALUES (?, ?)').run(resultId, JSON.stringify(input.log ?? []));

      const saved: SavedRoundRow[] = [];
      const seen = new Set<string>();
      for (const row of result.rows) {
        if (row.isBot || !row.profileId || seen.has(row.profileId) || !this.profile(row.profileId)) continue;
        seen.add(row.profileId);
        const xp = xpForResult(row.won, row.conversions);
        this.db
          .prepare(
            `INSERT INTO player_results (result_id, profile_id, role, won, xp, stats, runner_points, hunter_points)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            resultId,
            row.profileId,
            row.team,
            row.won ? 1 : 0,
            xp,
            JSON.stringify({ conversions: row.conversions, survivedSecs: row.survivedSecs, status: row.status }),
            row.points.runner,
            row.points.hunter,
          );
        this.db
          .prepare('UPDATE profiles SET xp = xp + ?, games = games + 1, wins = wins + ? WHERE id = ?')
          .run(xp, row.won ? 1 : 0, row.profileId);
        const p = this.db.prepare('SELECT games, wins FROM profiles WHERE id = ?').get(row.profileId) as Row;
        const earned = badgesFor({
          gamesPlayed: p.games,
          wins: p.wins,
          won: row.won,
          dealt: row.team,
          survivedWholeRound: row.team === 'runner' && row.role === 'runner' && row.status !== 'eliminated',
          conversions: row.conversions,
          wasConverted: row.team === 'runner' && row.role === 'hunter',
          organised: false,
        });
        saved.push({ playerId: row.playerId, profileId: row.profileId, xp, newBadges: this.award(row.profileId, earned, result.endedAt) });
      }
      if (input.organiserProfileId && this.profile(input.organiserProfileId) && result.rows.some((x) => !x.isBot)) {
        this.award(input.organiserProfileId, ['organiser'], result.endedAt);
      }
      return { resultId, rows: saved };
    });
  }

  private award(pid: string, ids: string[], at: number): string[] {
    const fresh: string[] = [];
    for (const b of ids) {
      const r = this.db
        .prepare('INSERT OR IGNORE INTO badges (profile_id, badge_id, earned_at) VALUES (?, ?, ?)')
        .run(pid, b, at);
      if (r.changes) fresh.push(b);
    }
    return fresh;
  }

  rounds(limit = 50): FinishedRound[] {
    const rows = this.db
      .prepare(
        `SELECT r.id, r.room_code, r.game, r.title, r.ended_at, r.players, r.headline, l.json AS log
         FROM results r LEFT JOIN game_logs l ON l.result_id = r.id ORDER BY r.ended_at DESC LIMIT ?`,
      )
      .all(limit) as Row[];
    return rows.map((r) => {
      let summary: FinishedRound['summary'] = null;
      try {
        const log = JSON.parse(r.log ?? '[]') as { kind: string; outcome?: string }[];
        summary = {
          scans: log.filter((e) => e.kind === 'scan' && e.outcome === 'started').length,
          conversions: log.filter((e) => e.kind === 'convert').length,
          codeAttempts: log.filter((e) => e.kind === 'code').length,
          eliminated: log.filter((e) => e.kind === 'out' && e.outcome === 'eliminated').length,
          sos: log.filter((e) => e.kind === 'sos' && e.outcome === 'on').length,
        };
      } catch {
        /* keep null */
      }
      return {
        id: r.id,
        roomCode: r.room_code,
        game: r.game,
        title: r.title,
        endedAt: r.ended_at,
        players: r.players,
        headline: r.headline,
        summary,
      };
    });
  }

  round(rid: number): { result: GameResult; log: unknown[]; title: string; roomCode: string } | null {
    const r = this.db
      .prepare('SELECT r.json, r.title, r.room_code, l.json AS log FROM results r LEFT JOIN game_logs l ON l.result_id = r.id WHERE r.id = ?')
      .get(rid) as Row | undefined;
    if (!r) return null;
    return { result: JSON.parse(r.json), log: JSON.parse(r.log ?? '[]'), title: r.title, roomCode: r.room_code };
  }

  leaderboard(board: LeaderboardBoard, period: LeaderboardPeriod, now = Date.now(), limit = 50): LeaderboardRow[] {
    const since = period === 'week' ? now - 7 * 86400_000 : period === 'month' ? now - 30 * 86400_000 : 0;
    let rows: Row[];
    if (board === 'xp') {
      rows = (
        since === 0
          ? this.db.prepare('SELECT id, name, xp, xp AS value FROM profiles WHERE xp > 0 ORDER BY xp DESC, created_at LIMIT ?').all(limit)
          : this.db
              .prepare(
                `SELECT p.id, p.name, p.xp, SUM(pr.xp) AS value FROM player_results pr
                 JOIN results r ON r.id = pr.result_id JOIN profiles p ON p.id = pr.profile_id
                 WHERE r.ended_at >= ? GROUP BY p.id ORDER BY value DESC LIMIT ?`,
              )
              .all(since, limit)
      ) as Row[];
    } else {
      const col = board === 'runner' ? 'runner_points' : 'hunter_points';
      rows = this.db
        .prepare(
          `SELECT p.id, p.name, p.xp, MAX(pr.${col}) AS value FROM player_results pr
           JOIN results r ON r.id = pr.result_id JOIN profiles p ON p.id = pr.profile_id
           WHERE pr.${col} IS NOT NULL AND r.ended_at >= ? GROUP BY p.id ORDER BY value DESC LIMIT ?`,
        )
        .all(since, limit) as Row[];
    }
    let rank = 0;
    let last: number | null = null;
    return rows.map((r, i) => {
      if (r.value !== last) {
        rank = i + 1;
        last = r.value;
      }
      return { rank, id: r.id, name: r.name, level: levelForXp(r.xp), value: r.value };
    });
  }
}
