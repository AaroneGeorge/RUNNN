import { Link, useParams } from 'react-router';

/** Simulation host on a big screen: a zombie's phone and a survivor's phone, side by side, live. */
export function WatchBothPage() {
  const code = (useParams().code ?? '').toUpperCase();
  return (
    <div className="flex h-dvh flex-col bg-night">
      <div className="flex items-center justify-between gap-3 px-4 py-2">
        <div className="font-extrabold">Simulation {code} · both sides</div>
        <Link to={`/play/${code}`} className="btn-ghost btn-sm">
          🗺 Referee map
        </Link>
      </div>
      <div className="flex min-h-0 flex-1 justify-center gap-4 px-4 pb-4">
        {(['zombie', 'survivor'] as const).map((team) => (
          <div key={team} className="flex min-h-0 w-full max-w-[430px] flex-col">
            <div className="mb-1 text-center text-sm font-bold">{team === 'zombie' ? "🧟 A zombie's phone" : "🏃 A survivor's phone"}</div>
            <iframe
              title={`${team} screen`}
              src={`/play/${code}?watch=${team}`}
              allow="autoplay; vibrate"
              className="min-h-0 w-full flex-1 rounded-[28px] border-4 border-ink bg-panel"
            />
          </div>
        ))}
      </div>
    </div>
  );
}
