import { useEffect, useState } from 'react';
import { GAMES, type GameId } from '@kalikkam/shared';
import { QR, TopBar } from '../components/ui.tsx';
import { Check, Printer } from 'lucide-react';
import { api } from '../lib/api.ts';

type Tab = 'vests' | 'rules' | 'checklist' | 'safety' | 'gear';
const TABS: { id: Tab; label: string }[] = [
  { id: 'vests', label: 'Vests' },
  { id: 'rules', label: 'Rules cards' },
  { id: 'checklist', label: 'Host checklist' },
  { id: 'safety', label: '🛟 Safety talk' },
  { id: 'gear', label: '🛒 Gear list' },
];

const CHECKLIST = {
  'A week before': [
    'Pick the spot and walk it in daylight. Note roads, water edges, dark corners and toilets.',
    'Ask the place: park office, college security or RWA. Carry a printed note for the police patrol.',
    'Create an event in the app and share the link on WhatsApp / Instagram.',
    'Print vests (this page) and laminate or put them in plastic sleeves. Kochi rain will find them.',
  ],
  'On the day, before players arrive': [
    'Charge a power bank and keep a first-aid kit, water, a whistle and a torch.',
    'Create the game on your phone and draw the boundary while you stand there.',
    'Add 5 bots and run 2 minutes of a test game to check GPS works at the spot.',
    'Pick a clear meeting point (the 🚩) everyone can find again.',
  ],
  'Briefing (5 minutes)': [
    'Read the safety talk out loud. Point at the boundary edges.',
    'Everyone joins with the code and enters their vest number. Check the lobby list.',
    'Explain the game in 3 sentences. Rules cards help.',
    'Phones: brightness up, screen stays on, app open. Pocket, not hand, when running.',
  ],
  'During the game': [
    'Referee mode shows everyone. Watch for 🆘 and ⚠️ too-fast flags.',
    'Pause if anyone gets hurt or the police or the public need to talk to you.',
    'Stay at the meeting point or walk the boundary. Do not play yourself in big groups.',
  ],
  'After': [
    'Count heads. Everyone back? Check the lobby list matches the people in front of you.',
    'Collect vests. Rematch if energy is high!',
    'Post the results screenshot and tag the spot. Thank the venue.',
  ],
};

const SAFETY = [
  'Welcome! Before we play: this is a game. Nobody wins anything worth getting hurt for.',
  "Look at the boundary on your map. Do not cross roads, ever. Not even if you're about to be caught.",
  'Tags are a light touch on the shoulder or arm. No grabbing, pushing, tackling or chasing into crowds.',
  'Walk, do not run, near people who are not playing: families, elders, vendors. We are guests here.',
  'Stay out of water, construction, private property and anywhere locked.',
  'If you feel unsafe or are hurt, press 🆘 in the menu. The host sees exactly where you are.',
  'If someone who is not playing asks what we are doing, be friendly. Tell them about the game.',
  'Keep your vest number visible. Covering it is cheating.',
  'Drink water. Kochi heat is real, so stop if you feel dizzy.',
  'When the game ends, come back to the meeting point so we can count heads. Have fun!',
];

const GEAR = [
  { item: 'Printed vests (A4 in plastic sleeves + safety pins)', cost: '₹15 per vest' },
  { item: 'Or: mesh sports bibs with numbers (reusable)', cost: '₹80–120 each' },
  { item: 'Whistle', cost: '₹50' },
  { item: 'First-aid kit', cost: '₹300' },
  { item: 'Power bank for the host', cost: '₹800' },
  { item: 'Torch / headlamp for night games', cost: '₹250' },
  { item: 'Water cans', cost: '₹100' },
  { item: 'Coloured tape or cones to mark the meeting point', cost: '₹200' },
];

export function KitPage({ print }: { print?: boolean }) {
  const [tab, setTab] = useState<Tab>('vests');
  const game: GameId = 'zombies';
  const [from, setFrom] = useState(100);
  const [count, setCount] = useState(20);
  const [printing, setPrinting] = useState(!!print);

  useEffect(() => {
    if (!printing) return;
    const t = setTimeout(() => {
      window.print();
      setPrinting(false);
    }, 400);
    return () => clearTimeout(t);
  }, [printing]);

  const vestNos = Array.from({ length: Math.max(1, Math.min(200, count, 1000 - from)) }, (_, i) => String(from + i));
  // Each vest's QR carries a server signature, so it can't be faked from the number alone.
  const [signed, setSigned] = useState<Record<string, string>>({});
  useEffect(() => {
    const t = setTimeout(() => {
      api<{ vest: string; qr: string }[]>(`/api/vests?from=${from}&count=${vestNos.length}`)
        .then((rows) => setSigned((m) => ({ ...m, ...Object.fromEntries(rows.map((r) => [r.vest, r.qr])) })))
        .catch(() => undefined);
    }, 250);
    return () => clearTimeout(t);
  }, [from, vestNos.length]);
  const vests = vestNos.map((v) => ({ vest: v, qr: signed[v] ?? null }));
  const ready = vests.every((v) => v.qr);

  if (printing) {
    return (
      <div className="bg-white text-black">
        <PrintContent tab={tab} game={game} vests={vests} />
      </div>
    );
  }

  return (
    <div className="page">
      <TopBar title="Host kit" back={false} />
      <p className="-mt-3 mb-5 text-sm text-dim">Everything to run a game in the real world. Print, laminate, play.</p>
      <div className="-mx-4 mb-5 no-scrollbar flex gap-2 overflow-x-auto px-4">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`btn-sm inline-flex shrink-0 items-center gap-1.5 rounded-xl border font-bold ${tab === t.id ? 'border-brand bg-brand/10 text-brand' : 'border-line text-dim'}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'vests' && (
        <>
          <div className="card mb-4 grid grid-cols-2 gap-3 p-4">
            <div>
              <label className="label" htmlFor="vfrom">
                First number
              </label>
              <input id="vfrom" className="field font-mono" type="number" min={100} max={999} value={from} onChange={(e) => setFrom(Math.max(100, Math.min(999, Number(e.target.value) || 100)))} />
            </div>
            <div>
              <label className="label" htmlFor="vcount">
                How many
              </label>
              <input id="vcount" className="field font-mono" type="number" min={1} max={200} value={count} onChange={(e) => setCount(Math.max(1, Math.min(200, Number(e.target.value) || 1)))} />
            </div>
            <p className="col-span-2 text-xs text-dim">
              One A4 per vest. Pin it flat on the back, between the shoulders, in a plastic sleeve. Zombies infect by holding their camera on the QR, so it must stay uncovered.
            </p>
          </div>
          <div className="mb-4 grid grid-cols-3 gap-2">
            {vests.slice(0, 6).map((v) => (
              <div key={v.vest} className="flex aspect-[1/1.414] flex-col items-center justify-center gap-1 rounded-xl bg-white p-2 text-night">
                <div className="font-mono text-xl font-black leading-none">{v.vest}</div>
                {v.qr ? <QR text={v.qr} size={72} /> : <div className="h-[72px] w-[72px] animate-pulse rounded bg-black/10" />}
              </div>
            ))}
          </div>
          <button className="btn-brand w-full" disabled={!ready} onClick={() => setPrinting(true)}>
            <Printer size={18} /> {ready ? `Print ${vests.length} vests (${vests[0].vest}–${vests[vests.length - 1].vest})` : 'Preparing QR codes…'}
          </button>
        </>
      )}

      {tab === 'rules' && (
        <>
          <div className="card mb-4 p-5">
            <div className="mb-3 text-2xl font-extrabold">
              {GAMES[game].emoji} {GAMES[game].name}
            </div>
            <ol className="list-decimal space-y-2 pl-5 text-[15px]">
              {GAMES[game].rules.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ol>
          </div>
          <button className="btn-brand w-full" onClick={() => setPrinting(true)}>
            <Printer size={18} /> Print rules card
          </button>
        </>
      )}

      {tab === 'checklist' && (
        <>
          {Object.entries(CHECKLIST).map(([k, items]) => (
            <div key={k} className="mb-4">
              <h3 className="label">{k}</h3>
              <div className="card divide-y divide-line">
                {items.map((i) => (
                  <label key={i} className="flex cursor-pointer gap-3 p-3.5 text-sm leading-snug has-[:checked]:text-dim">
                    <input type="checkbox" className="peer sr-only" />
                    <span className="mt-px grid h-5 w-5 shrink-0 place-items-center rounded-md border-2 border-line text-transparent transition-colors duration-150 peer-checked:border-brand peer-checked:bg-brand peer-checked:text-brand-ink">
                      <Check size={14} strokeWidth={3.5} />
                    </span>
                    <span className="peer-checked:line-through">{i}</span>
                  </label>
                ))}
              </div>
            </div>
          ))}
          <button className="btn-brand w-full" onClick={() => setPrinting(true)}>
            <Printer size={18} /> Print checklist
          </button>
        </>
      )}

      {tab === 'safety' && (
        <>
          <p className="mb-3 text-sm text-dim">Read this out loud before every game. It takes about 90 seconds.</p>
          <ol className="card mb-4 list-decimal space-y-3 p-5 pl-10 text-[15px] leading-snug">
            {SAFETY.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
          <button className="btn-brand w-full" onClick={() => setPrinting(true)}>
            <Printer size={18} /> Print safety talk
          </button>
        </>
      )}

      {tab === 'gear' && (
        <>
          <div className="card mb-4 divide-y divide-line">
            {GEAR.map((g) => (
              <div key={g.item} className="flex items-center justify-between gap-3 p-3.5 text-sm">
                <span>{g.item}</span>
                <span className="shrink-0 font-mono text-dim">{g.cost}</span>
              </div>
            ))}
          </div>
          <p className="text-sm text-dim">
            A starter kit for 30 players (paper vests + basics) is roughly <b className="text-ink">₹1,500–2,000</b>. Approximate
            prices; check locally.
          </p>
        </>
      )}
    </div>
  );
}

function PrintContent({ tab, game, vests }: { tab: Tab; game: GameId; vests: { vest: string; qr: string | null }[] }) {
  if (tab === 'vests') {
    return (
      <>
        {vests.map((v) => (
          <div key={v.vest} className="print-page flex h-[100vh] flex-col items-center justify-center gap-6">
            <div className="flex items-baseline gap-4">
              <span className="text-xl font-bold uppercase tracking-[.4em]">Zombie Run</span>
              <span className="font-mono text-8xl font-black leading-none">{v.vest}</span>
            </div>
            {v.qr && <QR text={v.qr} size={560} />}
            <div className="text-lg font-semibold">🧟 Zombies: scan here and hold</div>
          </div>
        ))}
      </>
    );
  }
  if (tab === 'rules') {
    const g = GAMES[game];
    return (
      <div className="p-10">
        <h1 className="mb-6 text-5xl font-black">
          {g.emoji} {g.name}
        </h1>
        <p className="mb-6 text-xl">{g.tagline}</p>
        <ol className="list-decimal space-y-4 pl-8 text-2xl">
          {g.rules.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ol>
      </div>
    );
  }
  if (tab === 'checklist') {
    return (
      <div className="p-10">
        <h1 className="mb-6 text-4xl font-black">Host checklist</h1>
        {Object.entries(CHECKLIST).map(([k, items]) => (
          <div key={k} className="mb-6">
            <h2 className="mb-2 text-2xl font-bold">{k}</h2>
            {items.map((i) => (
              <p key={i} className="mb-1.5 text-lg">
                ☐ {i}
              </p>
            ))}
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="p-10">
      <h1 className="mb-6 text-4xl font-black">Safety talk</h1>
      <ol className="list-decimal space-y-3 pl-8 text-2xl">
        {SAFETY.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>
    </div>
  );
}
