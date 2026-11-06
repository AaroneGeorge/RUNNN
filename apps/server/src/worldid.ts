/**
 * World ID Selfie Check sign-in.
 *
 * Flow:
 *   1. The client asks for a signed RP context (`createContext`). The signing key never leaves the server.
 *   2. The client opens an IDKit request with the `selfieCheck` preset; the user completes it in World App.
 *   3. The client posts the IDKit result back; `verifyResult` checks it against the nonce we issued,
 *      forwards it unchanged to the Developer Portal verify endpoint, and returns the nullifier.
 *
 * The nullifier is unique per World ID per app per action, so it identifies the same human on
 * every device without revealing who they are. The portal only checks the proof; replay of the
 * same nullifier for a *different* account is prevented by the unique index in the store.
 */
import { signRequest } from '@worldcoin/idkit-core/signing';

export type WorldEnv = 'production' | 'staging' | 'sandbox';

export interface WorldConfig {
  appId: string;
  rpId: string;
  signingKey: string;
  action: string;
  environment: WorldEnv;
  verifyBase: string;
}

export interface WorldPublicConfig {
  enabled: boolean;
  app_id?: string;
  action?: string;
  environment?: WorldEnv;
}

export interface RpContext {
  rp_id: string;
  nonce: string;
  created_at: number;
  expires_at: number;
  signature: string;
}

export class WorldError extends Error {
  constructor(
    msg: string,
    public status = 400,
  ) {
    super(msg);
  }
}

const ENVS: WorldEnv[] = ['production', 'staging', 'sandbox'];

export function worldConfigFromEnv(env: NodeJS.ProcessEnv = process.env): WorldConfig | null {
  const appId = env.WORLD_APP_ID ?? '';
  const rpId = env.WORLD_RP_ID ?? '';
  const signingKey = env.WORLD_RP_SIGNING_KEY ?? '';
  if (!appId || !rpId || !signingKey) return null;
  if (!appId.startsWith('app_')) throw new Error('WORLD_APP_ID must look like app_…');
  if (!rpId.startsWith('rp_')) throw new Error('WORLD_RP_ID must look like rp_…');
  const environment = (ENVS.includes(env.WORLD_ENV as WorldEnv) ? env.WORLD_ENV : 'production') as WorldEnv;
  return {
    appId,
    rpId,
    signingKey,
    action: env.WORLD_ACTION || 'runnn-login',
    environment,
    verifyBase: (env.WORLD_VERIFY_BASE || 'https://developer.world.org').replace(/\/+$/, ''),
  };
}

type Fetch = typeof fetch;

interface SelfieResponse {
  identifier: string;
  nullifier: string;
  issuer_schema_id?: number;
  sybil_score?: number;
}

interface IdkitResult {
  protocol_version: string;
  nonce: string;
  action?: string;
  environment: string;
  responses: SelfieResponse[];
  [k: string]: unknown;
}

const NONCE_TTL_MS = 5 * 60_000;
const MAX_PENDING = 5000;

/** Decimal string, so the same human always maps to the same key whatever hex casing comes back. */
export function normalizeNullifier(n: string): string {
  const s = n.trim();
  if (!/^(0x[0-9a-fA-F]{1,64}|\d{1,78})$/.test(s)) throw new WorldError('Malformed World ID nullifier.');
  return BigInt(s).toString(10);
}

export class WorldId {
  /** Nonces we signed and have not seen come back yet: nonce → expiry (ms). */
  private pending = new Map<string, number>();

  constructor(
    readonly cfg: WorldConfig,
    private fetchImpl: Fetch = fetch,
    private now: () => number = Date.now,
  ) {}

  publicConfig(): WorldPublicConfig {
    return { enabled: true, app_id: this.cfg.appId, action: this.cfg.action, environment: this.cfg.environment };
  }

  createContext(): RpContext {
    this.sweep();
    if (this.pending.size >= MAX_PENDING) throw new WorldError('Too many sign-ins in progress. Try again in a minute.', 429);
    const s = signRequest({ signingKeyHex: this.cfg.signingKey, action: this.cfg.action, ttl: NONCE_TTL_MS / 1000 });
    this.pending.set(s.nonce, this.now() + NONCE_TTL_MS);
    return { rp_id: this.cfg.rpId, nonce: s.nonce, created_at: s.createdAt, expires_at: s.expiresAt, signature: s.sig };
  }

  private sweep() {
    const t = this.now();
    for (const [n, exp] of this.pending) if (exp < t) this.pending.delete(n);
  }

  /** Checks the result, verifies it with World, and returns the user's nullifier for this app + action. */
  async verifyResult(raw: unknown): Promise<{ nullifier: string; sybilScore: number | null }> {
    const r = raw as IdkitResult;
    if (!r || typeof r !== 'object' || !Array.isArray(r.responses)) throw new WorldError('Missing World ID result.');
    if (r.protocol_version !== '4.0') throw new WorldError('This sign-in needs World ID 4.0. Update World App and try again.');
    if (r.action !== this.cfg.action) throw new WorldError('That proof was made for a different action.');
    // Never trust the client about the environment: a staging proof must not log anyone into production.
    if (r.environment !== this.cfg.environment) throw new WorldError('That proof was made in the wrong World ID environment.');
    const selfie = r.responses.find((x) => x && x.identifier === 'selfie');
    if (!selfie || typeof selfie.nullifier !== 'string') throw new WorldError('That proof is not a Selfie Check.');

    this.sweep();
    if (typeof r.nonce !== 'string' || !this.pending.has(r.nonce)) throw new WorldError('This sign-in request expired. Start again.');
    // One shot: a nonce is consumed even if verification fails, so a result cannot be replayed.
    this.pending.delete(r.nonce);

    let res: Response;
    try {
      res = await this.fetchImpl(`${this.cfg.verifyBase}/api/v4/verify/${encodeURIComponent(this.cfg.rpId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(r),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new WorldError('Could not reach World ID to check the proof. Try again.', 502);
    }
    const body = (await res.json().catch(() => ({}))) as {
      success?: boolean;
      code?: string;
      detail?: string;
      environment?: string;
      nullifier?: string;
      results?: { identifier?: string; success?: boolean; nullifier?: string }[];
    };
    if (!res.ok || body.success !== true) {
      const why = body.detail || body.code || `status ${res.status}`;
      throw new WorldError(`World ID could not verify that proof (${why}).`, res.status === 404 ? 502 : 400);
    }
    if (body.environment && body.environment !== this.cfg.environment) throw new WorldError('World ID answered for the wrong environment.');
    const item = body.results?.find((x) => x.identifier === 'selfie');
    if (item && item.success === false) throw new WorldError('World ID rejected the Selfie Check.');
    const nullifier = normalizeNullifier(item?.nullifier ?? body.nullifier ?? selfie.nullifier);
    if (nullifier !== normalizeNullifier(selfie.nullifier)) throw new WorldError('World ID returned a different nullifier.');
    return { nullifier, sybilScore: typeof selfie.sybil_score === 'number' ? selfie.sybil_score : null };
  }
}
