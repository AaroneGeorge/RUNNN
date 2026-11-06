import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { Store } from '../src/store.ts';
import { WorldId, normalizeNullifier, worldConfigFromEnv, type WorldConfig } from '../src/worldid.ts';

const cfg: WorldConfig = {
  appId: 'app_test123',
  rpId: 'rp_test123',
  signingKey: randomBytes(32).toString('hex'),
  action: 'runnn-login',
  environment: 'production',
  verifyBase: 'https://portal.test',
};

const NULLIFIER = '0x' + 'ab'.repeat(32);

function result(nonce: string, over: Record<string, unknown> = {}) {
  return {
    protocol_version: '4.0',
    nonce,
    action: 'runnn-login',
    environment: 'production',
    integrity_bundle: { version: 2 },
    responses: [{ identifier: 'selfie', proof: ['0x1', '0x2', '0x3', '0x4', '0x5'], nullifier: NULLIFIER, issuer_schema_id: 11, expires_at_min: 0, sybil_score: 3 }],
    ...over,
  };
}

function portal(reply: { status?: number; body: unknown }) {
  const calls: { url: string; body: unknown }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)) });
    return new Response(JSON.stringify(reply.body), { status: reply.status ?? 200 });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

const ok = { body: { success: true, environment: 'production', nullifier: NULLIFIER, results: [{ identifier: 'selfie', success: true, nullifier: NULLIFIER }] } };

describe('World ID config', () => {
  it('stays off without credentials', () => {
    expect(worldConfigFromEnv({})).toBeNull();
  });
  it('reads env and defaults the action and environment', () => {
    const c = worldConfigFromEnv({ WORLD_APP_ID: 'app_x', WORLD_RP_ID: 'rp_x', WORLD_RP_SIGNING_KEY: 'aa' })!;
    expect(c.action).toBe('runnn-login');
    expect(c.environment).toBe('production');
    expect(() => worldConfigFromEnv({ WORLD_APP_ID: 'x', WORLD_RP_ID: 'rp_x', WORLD_RP_SIGNING_KEY: 'aa' })).toThrow();
  });
});

describe('World ID verification', () => {
  it('signs an RP context on the server', () => {
    const w = new WorldId(cfg);
    const c = w.createContext();
    expect(c.rp_id).toBe('rp_test123');
    expect(c.signature).toMatch(/^0x[0-9a-f]{130}$/i);
    expect(c.expires_at).toBeGreaterThan(c.created_at);
  });

  it('forwards the result to the portal and returns a normalised nullifier', async () => {
    const { calls, fetchImpl } = portal(ok);
    const w = new WorldId(cfg, fetchImpl);
    const ctx = w.createContext();
    const r = await w.verifyResult(result(ctx.nonce));
    expect(r.nullifier).toBe(BigInt(NULLIFIER).toString());
    expect(r.sybilScore).toBe(3);
    expect(calls[0].url).toBe('https://portal.test/api/v4/verify/rp_test123');
    expect((calls[0].body as { nonce: string }).nonce).toBe(ctx.nonce);
  });

  it('refuses a nonce it never issued, and refuses to replay one', async () => {
    const { fetchImpl } = portal(ok);
    const w = new WorldId(cfg, fetchImpl);
    await expect(w.verifyResult(result('0x1234'))).rejects.toThrow(/expired/);
    const ctx = w.createContext();
    await w.verifyResult(result(ctx.nonce));
    await expect(w.verifyResult(result(ctx.nonce))).rejects.toThrow(/expired/);
  });

  it('expires nonces after five minutes', async () => {
    let t = 1_000_000;
    const { fetchImpl } = portal(ok);
    const w = new WorldId(cfg, fetchImpl, () => t);
    const ctx = w.createContext();
    t += 6 * 60_000;
    await expect(w.verifyResult(result(ctx.nonce))).rejects.toThrow(/expired/);
  });

  it('rejects the wrong action, environment, protocol or credential before calling the portal', async () => {
    const { calls, fetchImpl } = portal(ok);
    const w = new WorldId(cfg, fetchImpl);
    const n = () => w.createContext().nonce;
    await expect(w.verifyResult(result(n(), { action: 'other' }))).rejects.toThrow(/different action/);
    await expect(w.verifyResult(result(n(), { environment: 'staging' }))).rejects.toThrow(/environment/);
    await expect(w.verifyResult(result(n(), { protocol_version: '3.0' }))).rejects.toThrow(/4.0/);
    await expect(w.verifyResult(result(n(), { responses: [{ identifier: 'proof_of_human', nullifier: NULLIFIER }] }))).rejects.toThrow(/Selfie/);
    expect(calls).toHaveLength(0);
  });

  it('surfaces portal failures', async () => {
    const { fetchImpl } = portal({ status: 400, body: { success: false, code: 'all_verifications_failed', detail: 'Proof invalid' } });
    const w = new WorldId(cfg, fetchImpl);
    await expect(w.verifyResult(result(w.createContext().nonce))).rejects.toThrow(/Proof invalid/);
  });

  it('normalises nullifiers', () => {
    expect(normalizeNullifier('0x0A')).toBe('10');
    expect(normalizeNullifier('10')).toBe('10');
    expect(() => normalizeNullifier('nope')).toThrow();
  });
});

describe('World ID sign-in in the store', () => {
  it('creates a verified profile, then signs the same human back in', () => {
    const s = new Store();
    const a = s.loginWithWorld('123', 'Sam');
    expect(a.created).toBe(true);
    expect(a.profile.humanVerified).toBe(true);
    const b = s.loginWithWorld('123', 'Someone else');
    expect(b.profile.id).toBe(a.profile.id);
    expect(b.token).toBe(a.token);
  });

  it('verifies a signed-in guest and keeps their XP', () => {
    const s = new Store();
    const guest = s.createProfile('Guest');
    s.db.prepare('UPDATE profiles SET xp = 300 WHERE id = ?').run(guest.profile.id);
    const r = s.loginWithWorld('456', undefined, guest.token);
    expect(r.linked).toBe(true);
    expect(r.profile.id).toBe(guest.profile.id);
    expect(r.profile.xp).toBe(300);
    expect(r.profile.humanVerified).toBe(true);
  });

  it('never attaches a second World ID to a verified profile', () => {
    const s = new Store();
    const a = s.loginWithWorld('1', 'A');
    expect(() => s.loginWithWorld('2', 'B', a.token)).toThrow(/different World ID/);
  });

  it('marks unverified profiles as such', () => {
    const s = new Store();
    expect(s.createProfile('X').profile.humanVerified).toBe(false);
  });
});
