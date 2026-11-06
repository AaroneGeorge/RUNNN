import { Printer } from 'lucide-react';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router';
import { Button, Card, ConfigSlider, ErrorBox, Loading, Page, Section } from '../components/ui.tsx';
import { useApi } from '../lib/api.ts';
import { useOrganiser } from '../lib/storage.ts';

interface Bib {
  bib: string;
  qr: string;
}

function BibQr({ qr, size }: { qr: string; size: number }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    QRCode.toDataURL(qr, { width: size, margin: 1, errorCorrectionLevel: 'M' }).then(setSrc).catch(() => setSrc(null));
  }, [qr, size]);
  return src ? <img src={src} alt={`Bib QR`} width={size} height={size} className="mx-auto" /> : <div style={{ width: size, height: size }} />;
}

export function Kit() {
  const org = useOrganiser();
  const [from, setFrom] = useState(100);
  const [count, setCount] = useState(20);
  const preview = useApi<{ bibs: Bib[] }>(org ? `/bibs?from=${from}&count=4` : null);
  if (!org) return <Navigate to="/welcome" replace />;

  return (
    <Page title="Print bibs" back="/">
      <p className="text-dim">Each bib carries a signed QR, so a number typed into any QR generator will not work. Print once, reuse every week.</p>
      <Section title="Range">
        <Card>
          <ConfigSlider field={{ key: 'from', label: 'First number', min: 100, max: 900, step: 10 }} value={from} onChange={setFrom} />
          <ConfigSlider field={{ key: 'count', label: 'How many', min: 1, max: 100, step: 1 }} value={count} onChange={setCount} />
          <div className="text-sm text-dim">
            Bibs {from}–{Math.min(999, from + count - 1)}
          </div>
        </Card>
      </Section>
      <Section title="Preview">
        {preview.error && <ErrorBox>{preview.error}</ErrorBox>}
        <div className="grid grid-cols-2 gap-2">
          {preview.data?.bibs.map((b) => (
            <Card key={b.bib} className="text-center">
              <BibQr qr={b.qr} size={120} />
              <div className="text-3xl font-black">{b.bib}</div>
            </Card>
          ))}
        </div>
      </Section>
      <Section title="Printing tips">
        <Card className="text-sm">
          <ul className="list-disc space-y-1 pl-5">
            <li>One bib per A4 page (or A5 at least). QR 10 cm or wider.</li>
            <li>Matte paper: gloss blows out in the sun.</li>
            <li>Pin it flat between the shoulders.</li>
            <li>The number is printed big because people read it aloud when the camera will not cooperate.</li>
          </ul>
        </Card>
      </Section>
      <div className="mt-6">
        <Link to={`/kit/print?from=${from}&count=${count}`}>
          <Button block size="lg" icon={<Printer className="size-5" />}>
            Open print view
          </Button>
        </Link>
      </div>
    </Page>
  );
}

export function KitPrint() {
  const org = useOrganiser();
  const [q] = useSearchParams();
  const from = Number(q.get('from')) || 100;
  const count = Number(q.get('count')) || 20;
  const bibs = useApi<{ bibs: Bib[] }>(org ? `/bibs?from=${from}&count=${count}` : null);
  if (!org) return <Navigate to="/welcome" replace />;
  if (bibs.error) return <ErrorBox>{bibs.error}</ErrorBox>;
  if (!bibs.data) return <Loading label="Signing bibs…" />;

  return (
    <div className="bg-white text-black">
      <div className="no-print safe-top sticky top-0 flex items-center gap-2 bg-white/95 p-3 shadow">
        <Link to="/kit" className="font-bold">
          ← Back
        </Link>
        <div className="flex-1" />
        <Button size="sm" onClick={() => window.print()} icon={<Printer className="size-4" />}>
          Print {bibs.data.bibs.length}
        </Button>
      </div>
      {bibs.data.bibs.map((b) => (
        <div key={b.bib} className="bib-card flex min-h-[100vh] flex-col items-center justify-center gap-6 p-10 print:min-h-0 print:h-[277mm]">
          <BibQr qr={b.qr} size={520} />
          <div className="text-[9rem] leading-none font-black tracking-tight">{b.bib}</div>
          <div className="text-lg font-bold tracking-[0.3em] text-neutral-500">RUNNN</div>
        </div>
      ))}
    </div>
  );
}
