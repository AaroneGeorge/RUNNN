import type { Profile, WorldIdConfig } from '@runnn/shared';
import { api } from './api.ts';

interface RpContext {
  rp_id: string;
  nonce: string;
  created_at: number;
  expires_at: number;
  signature: string;
}
import { setLastName, setProfileToken } from './storage.ts';

export type WorldStep = 'idle' | 'starting' | 'waiting' | 'confirming' | 'verifying' | 'done' | 'error';

export interface WorldRequest {
  connectorURI: string;
  /** Resolves once the user finishes in World App and the server has signed them in. */
  done: Promise<{ profile: Profile; linked: boolean; created: boolean }>;
  cancel: () => void;
}

const ERRORS: Record<string, string> = {
  user_rejected: 'You cancelled in World App.',
  verification_rejected: 'You declined the verification in World App.',
  credential_unavailable: 'Your World ID has no Selfie Check yet. Do the Selfie Check in World App first.',
  world_id_4_not_available: 'Update World App to use this sign-in.',
  max_verifications_reached: 'This World ID has already been used the maximum number of times.',
  connection_failed: 'Could not reach World App. Check your connection and try again.',
  timeout: 'Took too long. Start again.',
  cancelled: 'Cancelled.',
  rp_signature_expired: 'This sign-in request expired. Start again.',
  timestamp_too_old: 'This sign-in request expired. Start again.',
};

export const worldErrorText = (code: string) => ERRORS[code] ?? `World ID sign-in failed (${code}).`;

export class WorldSignInError extends Error {
  constructor(public code: string) {
    super(worldErrorText(code));
  }
}

export const fetchWorldConfig = () => api<WorldIdConfig>('/auth/world/config');

/**
 * Open a Selfie Check request. The RP context is signed by our server (the key never
 * reaches the browser); the proof goes back to our server, which verifies it with World
 * before signing the player in.
 */
export async function startSelfieCheck(
  cfg: WorldIdConfig,
  opts: { name?: string; onStep?: (s: WorldStep) => void } = {},
): Promise<WorldRequest> {
  if (!cfg.enabled || !cfg.app_id || !cfg.action) throw new Error('World ID sign-in is not set up on this server.');
  const step = opts.onStep ?? (() => {});
  step('starting');
  const [{ IDKit, selfieCheck }, { rp_context }] = await Promise.all([
    import('@worldcoin/idkit-core'),
    api<{ rp_context: RpContext }>('/auth/world/context', { body: {} }),
  ]);
  const request = await IDKit.request({
    app_id: cfg.app_id,
    action: cfg.action,
    rp_context,
    allow_legacy_proofs: false,
    environment: cfg.environment ?? 'production',
    action_description: 'Sign in to RUNNN',
  }).preset(selfieCheck());

  const abort = new AbortController();
  step('waiting');

  const done = (async () => {
    // One polling loop: the bridge hands the result over once, so never poll it twice in parallel.
    const deadline = Date.now() + 5 * 60_000;
    let result: unknown = null;
    while (!result) {
      if (abort.signal.aborted) throw new WorldSignInError('cancelled');
      if (Date.now() > deadline) throw new WorldSignInError('timeout');
      const s = await request.pollOnce().catch(() => null);
      if (s?.type === 'confirmed' && s.result) result = s.result;
      else if (s?.type === 'failed') throw new WorldSignInError(String(s.error ?? 'generic_error'));
      else {
        if (s?.type === 'awaiting_confirmation') step('confirming');
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
    step('verifying');
    const r = await api<{ token: string; profile: Profile; linked: boolean; created: boolean }>('/auth/world/verify', {
      body: { result, name: opts.name },
    });
    setProfileToken(r.token);
    setLastName(r.profile.name);
    step('done');
    return r;
  })();

  return { connectorURI: request.connectorURI, done, cancel: () => abort.abort() };
}
