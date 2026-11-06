import { beforeEach, describe, expect, it } from 'vitest';
import { hashSignal } from '@worldcoin/idkit-core/hashing';
import { AuthError, Store } from '../src/store.ts';
import { WORLD_ACTION, WorldError, verifyWorldProof } from '../src/world.ts';

beforeEach(() => {
  Object.assign(process.env, {
    WORLD_APP_ID: 'app_test',
    WORLD_RP_ID: 'rp_test',
    WORLD_RP_SIGNING_KEY: '0x' + '11'.repeat(32),
    WORLD_ENV: 'staging',
    WORLD_CREDENTIAL: 'selfie',
  });
});

/** An IDKit 4.0 result for `profileId`, as World App would send it back. */
function result(profileId: string, over: Record<string, unknown> = {}, item: Record<string, unknown> = {}) {
  return {
    protocol_version: '4.0',
    nonce: '0x01',
    action: WORLD_ACTION,
    environment: 'staging',
    responses: [{ identifier: 'selfie', signal_hash: hashSignal(profileId), proof: ['1', '2', '3', '4', '5'], nullifier: '123456789', issuer_schema_id: 11, expires_at_min: 0, sybil_score: 3, ...item }],
    ...over,
  };
}

/** Stands in for the Developer Portal's verify endpoint. */
const portal = (status: number, body: unknown) => {
  const calls: { url: string; body: unknown }[] = [];
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)) });
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { f, calls };
};

describe('World ID proof check', () => {
  it('accepts a proof the portal confirms, bound to this profile', async () => {
    const { f, calls } = portal(200, { success: true, environment: 'staging' });
    const v = await verifyWorldProof(result('p1'), 'p1', f);
    expect(v).toEqual({ nullifier: '123456789', credential: 'selfie', sybilScore: 3 });
    expect(calls[0].url).toBe('https://developer.world.org/api/v4/verify/rp_test');
  });

  it('refuses a proof made for another profile, without asking the portal', async () => {
    const { f, calls } = portal(200, { success: true, environment: 'staging' });
    await expect(verifyWorldProof(result('someone-else'), 'p1', f)).rejects.toThrow(/another profile/);
    expect(calls).toHaveLength(0);
  });

  it('refuses the wrong environment, action or credential', async () => {
    const { f } = portal(200, { success: true, environment: 'staging' });
    await expect(verifyWorldProof(result('p1', { environment: 'production' }), 'p1', f)).rejects.toThrow(WorldError);
    await expect(verifyWorldProof(result('p1', { action: 'other' }), 'p1', f)).rejects.toThrow(/different action/);
    await expect(verifyWorldProof(result('p1', {}, { identifier: 'proof_of_human' }), 'p1', f)).rejects.toThrow(/Selfie Check/);
    await expect(verifyWorldProof({ protocol_version: '3.0' }, 'p1', f)).rejects.toThrow(/4\.0/);
  });

  it('accepts a legacy 3.0 proof for Orb or device checks, never for Selfie Check', async () => {
    const legacy = { protocol_version: '3.0', nonce: '0x01', action: WORLD_ACTION, environment: 'staging', responses: [{ identifier: 'device', signal_hash: hashSignal('p1'), proof: '0x00', merkle_root: '0x01', nullifier: '0x2a' }] };
    const { f } = portal(200, { success: true, environment: 'staging' });
    await expect(verifyWorldProof(legacy, 'p1', f)).rejects.toThrow(/4\.0/);
    process.env.WORLD_CREDENTIAL = 'device';
    expect(await verifyWorldProof(legacy, 'p1', f)).toEqual({ nullifier: '42', credential: 'device (3.0)', sybilScore: null });
    await expect(verifyWorldProof(legacy, 'someone-else', f)).rejects.toThrow(/another profile/);
    process.env.WORLD_CREDENTIAL = 'proof_of_human';
    expect((await verifyWorldProof(legacy, 'p1', f)).credential).toBe('proof_of_human (3.0)');
  });

  it('refuses a proof the portal rejects', async () => {
    const { f } = portal(400, { success: false, code: 'invalid_proof' });
    await expect(verifyWorldProof(result('p1'), 'p1', f)).rejects.toThrow(/rejected/);
    const staging = portal(200, { success: true, environment: 'production' });
    await expect(verifyWorldProof(result('p1'), 'p1', staging.f)).rejects.toThrow(/rejected/);
  });
});

describe('one profile per human', () => {
  it('lets a person re-verify their own profile but not a second one', () => {
    const s = new Store(':memory:');
    const a = s.createProfile('Nandhu').profile.id;
    const b = s.createProfile('Nandhu').profile.id; // the same person on a new browser
    expect(s.profile(a)!.verifiedHuman).toBe(false);
    s.recordHuman(a, WORLD_ACTION, '42', 'selfie', 2);
    s.recordHuman(a, WORLD_ACTION, '42', 'selfie', 2); // again: fine
    expect(s.profile(a)!.verifiedHuman).toBe(true);
    expect(() => s.recordHuman(b, WORLD_ACTION, '42', 'selfie', 2)).toThrow(AuthError);
    expect(s.profile(b)!.verifiedHuman).toBe(false);
  });

  it('marks events as needing the check until the viewer is verified', () => {
    const s = new Store(':memory:');
    s.requireHuman = true;
    const host = s.createProfile('Host').profile.id;
    const ev = s.createEvent(host, { title: 'Game night', game: 'zombies', startsAt: Date.now() + 86400_000, place: 'Marine Drive', capacity: 2 });
    const p = s.createProfile('Anu').profile.id;
    expect(s.event(ev.id, p)!.needsHuman).toBe(true);
    s.recordHuman(p, WORLD_ACTION, '7', 'selfie', null);
    expect(s.event(ev.id, p)!.needsHuman).toBe(false);
  });
});
