import { useEffect, useRef, useState } from 'react';
import { deviceLegacy, IDKitRequestWidget, proofOfHuman, selfieCheck, type RpContext } from '@worldcoin/idkit';
import type { WorldConfig } from '@kalikkam/shared';
import { api } from '../lib/api.ts';
import { getProfile } from '../lib/storage.ts';

/** Why a check didn't go through, in words (World's error codes are for us, not players). */
const WHY: Record<string, string> = {
  user_rejected: 'You cancelled the check, so no spot was claimed.',
  verification_rejected: 'The check was declined, so no spot was claimed.',
  credential_unavailable: "Your World App doesn't have this check yet (Selfie Check, or an Orb-verified World ID). Do it in World App, then try again.",
  feature_unavailable: "World hasn't switched this check on for Kalikkam yet. Ask the host to use another check (WORLD_CREDENTIAL).",
  max_verifications_reached: 'This World ID has already been used for another Kalikkam profile.',
  connection_failed: "Couldn't reach World App. Try again.",
  rp_signature_expired: 'The check took too long. Try again.',
};
export const worldFailure = (code: string) => WHY[code] ?? `The check didn't go through (${code}). No spot was claimed.`;

/**
 * World ID check: "this is the only Kalikkam profile of a real person". The server signs the request and verifies the
 * proof; this only shows World's widget. The proof is bound to the signed-in profile (the signal).
 */
export function WorldCheck({ open, onClose, onVerified, onFailed }: { open: boolean; onClose: () => void; onVerified: () => void; onFailed: (why: string) => void }) {
  const [cfg, setCfg] = useState<WorldConfig | null>(null);
  const [rp, setRp] = useState<RpContext | null>(null);
  // Our server's reason for refusing a proof (e.g. "already verified another profile"), shown instead of World's code.
  const refused = useRef<string | null>(null);
  // Set once the check succeeds or fails, so the widget closing afterwards doesn't count as a cancel.
  const settled = useRef(false);

  useEffect(() => {
    if (!open) return setRp(null);
    settled.current = false;
    let live = true;
    (async () => {
      try {
        const c = await api<WorldConfig>('/api/world/config');
        const s = await api<{ sig: string; nonce: string; created_at: number; expires_at: number }>('/api/world/rp-signature', { body: {} });
        if (!live) return;
        setCfg(c);
        setRp({ rp_id: c.rp_id!, nonce: s.nonce, created_at: s.created_at, expires_at: s.expires_at, signature: s.sig });
      } catch (e) {
        if (live) onFailed((e as Error).message);
      }
    })();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const me = getProfile();
  if (!open || !cfg?.app_id || !rp || !me) return null;
  return (
    <IDKitRequestWidget
      open
      onOpenChange={(o) => !o && !settled.current && onClose()}
      app_id={cfg.app_id}
      action={cfg.action}
      action_description="One spot per person at Kalikkam game nights"
      rp_context={rp}
      // Only Selfie Check is 4.0-only; Orb and device checks may answer with older (3.0) proofs.
      allow_legacy_proofs={cfg.credential !== 'selfie'}
      environment={cfg.environment}
      preset={(cfg.credential === 'selfie' ? selfieCheck : cfg.credential === 'device' ? deviceLegacy : proofOfHuman)({ signal: me.id })}
      handleVerify={async (result) => {
        // Throwing here makes the widget show a failure; our server is the judge, never the browser.
        refused.current = null;
        try {
          await api('/api/world/verify', { body: { result } });
        } catch (e) {
          refused.current = (e as Error).message;
          throw e;
        }
      }}
      onSuccess={() => {
        settled.current = true;
        onVerified();
      }}
      onError={(code) => {
        settled.current = true;
        onFailed(refused.current ?? worldFailure(String(code)));
      }}
    />
  );
}
