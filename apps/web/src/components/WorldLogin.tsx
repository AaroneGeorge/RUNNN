import { BadgeCheck, ExternalLink, ScanFace } from 'lucide-react';
import QRCode from 'qrcode';
import { useEffect, useRef, useState } from 'react';
import type { WorldIdConfig } from '@runnn/shared';
import { useApi } from '../lib/api.ts';
import { notify } from '../lib/toast.ts';
import { startSelfieCheck, type WorldRequest, type WorldStep } from '../lib/world.ts';
import { Button, Card, ErrorBox, Sheet, Spinner } from './ui.tsx';

const isPhone = () => /android|iphone|ipad|ipod/i.test(navigator.userAgent);

function Qr({ text }: { text: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (ref.current) QRCode.toCanvas(ref.current, text, { width: 240, margin: 1 }).catch(() => {});
  }, [text]);
  return <canvas ref={ref} className="mx-auto rounded-2xl bg-white p-2" />;
}

const STEP_TEXT: Record<WorldStep, string> = {
  idle: '',
  starting: 'Preparing a secure request…',
  waiting: 'Waiting for World App…',
  confirming: 'Confirm the Selfie Check in World App…',
  verifying: 'Checking your proof…',
  done: 'Verified!',
  error: '',
};

/**
 * "Sign in with World ID" using Selfie Check. Proves the player is a unique human
 * without sharing who they are: one World ID maps to one RUNNN profile.
 * Renders nothing if the server has no World ID credentials configured.
 */
export function WorldLogin({
  name,
  mode = 'signin',
  onDone,
}: {
  name?: string;
  /** 'signin' on the no-profile screen, 'verify' to verify an existing profile. */
  mode?: 'signin' | 'verify';
  onDone?: () => void;
}) {
  const cfg = useApi<WorldIdConfig>('/auth/world/config');
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<WorldStep>('idle');
  const [uri, setUri] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const req = useRef<WorldRequest | null>(null);

  useEffect(() => () => req.current?.cancel(), []);

  if (!cfg.data?.enabled) return null;

  const start = async () => {
    setOpen(true);
    setErr(null);
    setUri(null);
    try {
      const r = await startSelfieCheck(cfg.data!, { name, onStep: setStep });
      req.current = r;
      setUri(r.connectorURI);
      const out = await r.done;
      notify(out.created ? `Welcome, ${out.profile.name}!` : out.linked ? 'Verified as a unique human ✅' : `Signed in as ${out.profile.name}`, 'good');
      setOpen(false);
      onDone?.();
    } catch (e) {
      setStep('error');
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      req.current = null;
    }
  };

  const close = () => {
    req.current?.cancel();
    setOpen(false);
    setStep('idle');
  };

  const busy = step !== 'idle' && step !== 'error' && step !== 'done';
  const staging = cfg.data.environment !== 'production';

  return (
    <>
      {mode === 'signin' ? (
        <Button variant="dark" block size="lg" icon={<ScanFace className="size-5" />} onClick={start}>
          Sign in with World ID
        </Button>
      ) : (
        <Card className="flex items-center gap-3" onClick={start}>
          <BadgeCheck className="size-7 shrink-0" />
          <div className="flex-1 text-sm">
            <div className="font-extrabold">Verify you’re human</div>
            <div className="text-dim">Selfie Check with World ID. One person, one profile. Nobody learns who you are.</div>
          </div>
        </Card>
      )}

      <Sheet open={open} onClose={close} title="World ID Selfie Check">
        <p className="mb-4 text-dim">
          {isPhone()
            ? 'Open World App to do a quick Selfie Check. You’ll come straight back here.'
            : 'Scan with your phone’s camera or World App, then do the Selfie Check.'}
        </p>
        {uri && step !== 'verifying' && step !== 'done' && (
          <>
            {!isPhone() && <Qr text={uri} />}
            <a href={uri} target="_blank" rel="noreferrer" className="mt-4 block">
              <Button block size="lg" icon={<ExternalLink className="size-5" />}>
                Open World App
              </Button>
            </a>
          </>
        )}
        {busy && (
          <div className="mt-5 flex items-center justify-center gap-3 font-bold text-dim">
            <Spinner className="size-5" /> {STEP_TEXT[step]}
          </div>
        )}
        {err && (
          <div className="mt-4">
            <ErrorBox onRetry={start}>{err}</ErrorBox>
          </div>
        )}
        {staging && <p className="mt-4 text-center text-xs font-bold text-dim">Test mode ({cfg.data.environment}): use the World ID simulator.</p>}
        <p className="mt-5 mb-4 text-center text-xs text-dim">
          RUNNN receives only an anonymous code that is the same each time you sign in. No photo or identity data.
        </p>
      </Sheet>
    </>
  );
}
