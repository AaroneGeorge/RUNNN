// World ID 4.0: "one Kalikkam profile per human", required to claim a spot at a capped event.
// The browser shows World's widget; this server signs each request, checks the proof with the Developer Portal,
// and keeps the RP-scoped nullifier so the same person can't verify a second profile.
// Config comes from the environment (apps/server/.env, git-ignored): WORLD_APP_ID, WORLD_RP_ID,
// WORLD_RP_SIGNING_KEY, WORLD_ENV (staging | production), WORLD_CREDENTIAL (selfie | proof_of_human).
import { signRequest } from '@worldcoin/idkit-core/signing';
import { hashSignal } from '@worldcoin/idkit-core/hashing';
import type { WorldConfig } from '@kalikkam/shared';

export const WORLD_ACTION = 'verify-human';
const VERIFY_URL = 'https://developer.world.org/api/v4/verify/';

export function worldConfig(): WorldConfig {
  const { WORLD_APP_ID, WORLD_RP_ID, WORLD_RP_SIGNING_KEY } = process.env;
  const enabled = !!(WORLD_APP_ID?.startsWith('app_') && WORLD_RP_ID && WORLD_RP_SIGNING_KEY);
  return {
    enabled,
    app_id: enabled ? (WORLD_APP_ID as `app_${string}`) : null,
    rp_id: enabled ? WORLD_RP_ID! : null,
    action: WORLD_ACTION,
    environment: process.env.WORLD_ENV === 'production' ? 'production' : 'staging',
    // Selfie Check: the lightest credential that still makes "one spot per person" hold (see docs/world-id.md).
    // World has to switch Selfie Check on for each app ("feature unavailable" until then). Until it does, use
    // proof_of_human (Orb, 4.0 with a legacy 3.0 fallback) or device (any World App, 3.0 only: a demo stopgap, not Sybil-proof).
    credential: CREDENTIALS.find((c) => c === process.env.WORLD_CREDENTIAL) ?? 'selfie',
  };
}
const CREDENTIALS = ['selfie', 'proof_of_human', 'device'] as const;
const CREDENTIAL_NAME = { selfie: 'Selfie Check', proof_of_human: 'Proof of Human', device: 'World App device check' };

/** The RP signature World App checks before it will make a proof for us. Never computed in the browser. */
export function rpSignature() {
  const { sig, nonce, createdAt, expiresAt } = signRequest({ signingKeyHex: process.env.WORLD_RP_SIGNING_KEY!, action: WORLD_ACTION });
  return { sig, nonce, created_at: createdAt, expires_at: expiresAt };
}

export class WorldError extends Error {}

interface ResponseItem {
  identifier?: string;
  signal_hash?: string;
  nullifier?: string;
  sybil_score?: number;
}

const sameField = (a: string, b: string) => {
  try {
    return BigInt(a) === BigInt(b);
  } catch {
    return false;
  }
};

/**
 * Check an IDKit result for `profileId`: the right app, action, environment and credential, bound to this profile
 * (the signal), and accepted by the Developer Portal. Returns the nullifier to store. Throws WorldError otherwise.
 * `fetchImpl` is for tests.
 */
export async function verifyWorldProof(
  result: unknown,
  profileId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ nullifier: string; credential: string; sybilScore: number | null }> {
  const cfg = worldConfig();
  if (!cfg.enabled) throw new WorldError('World ID is not set up on this server.');
  const r = result as { protocol_version?: string; action?: string; environment?: string; responses?: ResponseItem[] } | null;
  // Selfie Check is 4.0 only. The other credentials may come back as World ID 3.0 (legacy) proofs.
  const legacy = r?.protocol_version === '3.0' && cfg.credential !== 'selfie';
  if (!r || (r.protocol_version !== '4.0' && !legacy) || !Array.isArray(r.responses)) throw new WorldError('That is not a World ID 4.0 result.');
  if (r.environment !== cfg.environment) throw new WorldError(`Wrong World ID environment (${r.environment}).`);
  if (r.action !== WORLD_ACTION && !(legacy && r.action === undefined)) throw new WorldError('That proof is for a different action.');
  // A legacy result only answers the one credential we asked for; its naming differs (e.g. "orb", "device").
  const item = legacy ? r.responses[0] : r.responses.find((x) => x.identifier === cfg.credential);
  if (!item?.nullifier) throw new WorldError(`The check didn't include a ${CREDENTIAL_NAME[cfg.credential]}.`);
  // The proof must be bound to this profile, or one person's proof could verify someone else's profile.
  if (!item.signal_hash || !sameField(item.signal_hash, hashSignal(profileId))) throw new WorldError('That proof was made for another profile.');

  let res: Response;
  try {
    res = await fetchImpl(VERIFY_URL + cfg.rp_id, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...r, environment: cfg.environment }),
    });
  } catch (e) {
    console.warn('[world] verify request failed to reach World:', e instanceof Error ? e.message : e);
    throw new WorldError("Couldn't reach World to check the proof. Try again.");
  }
  const body = (await res.json().catch(() => ({}))) as { success?: boolean; environment?: string; detail?: string; code?: string };
  if (!res.ok || body.success !== true || body.environment !== cfg.environment) {
    console.warn('[world] verify rejected', res.status, body.code ?? '', body.detail ?? '');
    throw new WorldError('World ID rejected the proof. Try the check again.');
  }
  // Stored as a decimal string: legacy nullifiers are hex. The portal accepted it, so it's a field element.
  let nullifier = item.nullifier;
  try {
    nullifier = BigInt(item.nullifier).toString();
  } catch {}
  return { nullifier, credential: legacy ? `${cfg.credential} (3.0)` : cfg.credential, sybilScore: typeof item.sybil_score === 'number' ? item.sybil_score : null };
}
