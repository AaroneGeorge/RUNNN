import { useEffect, useState } from 'react';
import { ENTRY_USDC, TOP_UP_USDC, type Payout, type Profile, type WalletView, type WorldConfig } from '@kalikkam/shared';
import type { PlayCtx } from '../pages/Play.tsx';
import { api } from '../lib/api.ts';
import { WorldCheck } from '../components/WorldCheck.tsx';
import { ExternalLink, Loader2, Trophy, Wallet } from 'lucide-react';

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));

/** Your Kalikkam wallet: made by the server after your World ID check. `null` until loaded or if not verified. */
export function useWallet(enabled: boolean) {
  const [wallet, setWallet] = useState<WalletView | null>(null);
  const [verified, setVerified] = useState<boolean | null>(null);
  const load = async () => {
    const [me, world] = await Promise.all([api<{ profile: Profile }>('/api/me').catch(() => null), api<WorldConfig>('/api/world/config').catch(() => null)]);
    // The check is only asked for when this server requires World ID.
    const v = !!me && (!world?.enabled || me.profile.verifiedHuman);
    setVerified(v);
    if (v) setWallet(await api<WalletView>('/api/wallet').catch(() => null));
  };
  useEffect(() => {
    if (enabled) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);
  return { wallet, setWallet, verified, reload: load };
}

/** Lobby: the paid entry (test USDC on Arc). Verify once with World ID, top up, pay: no wallet app needed. */
export function EntryCard({ ctx }: { ctx: PlayCtx }) {
  const { view } = ctx;
  const entry = view.entry!;
  const me = view.me;
  const { wallet, setWallet, verified, reload } = useWallet(me.plays && !entry.myPaid);
  const [busy, setBusy] = useState<'' | 'topup' | 'pay'>('');
  const [checking, setChecking] = useState(false);
  const [msg, setMsg] = useState('');
  const run = async (what: 'topup' | 'pay') => {
    setBusy(what);
    setMsg('');
    try {
      if (what === 'topup') setWallet(await api<WalletView>('/api/wallet/topup', { body: {} }));
      else {
        await api(`/api/rooms/${view.code}/entry`, { body: {} });
        ctx.toast('Entry paid. Good luck!', 'good');
      }
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy('');
    }
  };
  const low = !!wallet && wallet.balance < 1.05;
  return (
    <div className="card mb-4 p-4">
      <div className="flex items-center gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full border-2 border-ink bg-sun">
          <Trophy size={20} strokeWidth={2.4} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-bold">{entry.fee} USDC entry · pot {entry.pot} USDC</div>
          <div className="text-sm text-dim">
            {entry.paid} paid. Top survivor and top zombie split the pot. Not paid when the game starts? You watch that round. Test USDC on Arc, no real money.
          </div>
        </div>
      </div>
      {me.plays && (
        <div className="mt-3">
          {entry.myPaid ? (
            <p className="rounded-2xl bg-sun-soft px-4 py-2.5 text-sm font-bold">✓ You've paid your entry.</p>
          ) : verified === null ? (
            <Loader2 size={20} className="mx-auto animate-spin text-dim" />
          ) : !verified ? (
            <>
              <button className="btn-brand w-full" disabled={checking} onClick={() => setChecking(true)}>
                {checking ? 'Waiting for World ID…' : 'Verify with World ID to play'}
              </button>
              <p className="mt-2 text-center text-xs font-semibold text-dim">One wallet per person. We make it for you: nothing to install.</p>
              <WorldCheck
                open={checking}
                onClose={() => setChecking(false)}
                onVerified={() => {
                  setChecking(false);
                  void reload();
                }}
                onFailed={(why) => {
                  setChecking(false);
                  setMsg(why);
                }}
              />
            </>
          ) : wallet ? (
            <>
              <div className="mb-2 flex items-center justify-between rounded-2xl bg-deep px-4 py-2.5 text-sm">
                <span className="flex items-center gap-2 font-semibold">
                  <Wallet size={16} /> Your Kalikkam wallet
                </span>
                <span className="font-mono font-bold">{fmt(wallet.balance)} USDC</span>
              </div>
              {low ? (
                <button className="btn-ghost w-full" disabled={!!busy || wallet.topUpsLeft <= 0} onClick={() => run('topup')}>
                  {busy === 'topup' ? 'Sending test USDC…' : wallet.topUpsLeft > 0 ? `Get ${TOP_UP_USDC} test USDC` : 'No test top-ups left'}
                </button>
              ) : (
                <button className="btn-brand w-full text-lg" disabled={!!busy} onClick={() => run('pay')}>
                  {busy === 'pay' ? 'Paying on Arc…' : `Pay ${entry.fee} USDC entry`}
                </button>
              )}
            </>
          ) : (
            <Loader2 size={20} className="mx-auto animate-spin text-dim" />
          )}
          {msg && <p className="mt-2 rounded-2xl bg-blood/10 px-4 py-2.5 text-sm font-semibold text-blood">{msg}</p>}
        </div>
      )}
    </div>
  );
}

/** Results: where the pot went, with the transaction on Arc's explorer. */
export function PayoutCard({ payout, me }: { payout: Payout; me: string }) {
  const mine = payout.splits.find((s) => s.id === me);
  return (
    <section className="card mb-6 p-4">
      <div className="mb-2 flex items-center gap-2 font-bold">
        <Trophy size={18} />
        {payout.status === 'pending'
          ? 'Paying the pot on Arc…'
          : payout.status === 'paid'
            ? mine
              ? `You won ${fmt(mine.amount)} USDC!`
              : 'The pot was paid'
            : payout.status === 'refunded'
              ? `Nobody scored: everyone got their ${ENTRY_USDC} USDC back`
              : "The payout didn't go through"}
      </div>
      <ul className="space-y-1 text-sm">
        {payout.splits.map((s) => (
          <li key={s.id} className="flex justify-between">
            <span className={s.id === me ? 'font-bold' : ''}>{s.name}</span>
            <span className="font-mono">+{fmt(s.amount)} USDC</span>
          </li>
        ))}
      </ul>
      {payout.txHash && (
        <a className="mt-3 inline-flex items-center gap-1.5 text-sm font-bold underline decoration-2 underline-offset-4" href={`${payout.explorer}/tx/${payout.txHash}`} target="_blank" rel="noreferrer">
          See it on Arc's explorer <ExternalLink size={14} />
        </a>
      )}
      {payout.error && <p className="mt-2 text-xs text-blood">{payout.error}</p>}
      <p className="mt-2 text-xs text-dim">Test USDC on Arc Testnet: winnings land in your Kalikkam wallet (see your profile).</p>
    </section>
  );
}

/** Profile: your Kalikkam wallet, and taking your test USDC out to any address. */
export function WalletCard() {
  const { wallet, setWallet, verified } = useWallet(true);
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  if (!verified || !wallet) return null;
  const withdraw = async () => {
    setBusy(true);
    setMsg('');
    try {
      const r = await api<WalletView & { amount: number; tx: string }>('/api/wallet/withdraw', { body: { to } });
      setWallet(r);
      setMsg(`Sent ${fmt(r.amount)} USDC.`);
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="card mt-4 p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 font-bold">
          <Wallet size={18} /> Kalikkam wallet
        </div>
        <span className="font-mono font-bold">{fmt(wallet.balance)} USDC</span>
      </div>
      <a className="mt-1 inline-flex items-center gap-1 font-mono text-xs text-dim underline" href={`${wallet.explorer}/address/${wallet.address}`} target="_blank" rel="noreferrer">
        {short(wallet.address)} <ExternalLink size={12} />
      </a>
      <p className="mt-2 text-xs text-dim">Made for you after your World ID check: one per person. Test USDC on Arc Testnet.</p>
      {wallet.balance > 0.05 && (
        <div className="mt-3 flex gap-2">
          <input aria-label="Send to address" className="field py-2 font-mono text-sm" placeholder="0x… address" value={to} onChange={(e) => setTo(e.target.value)} />
          <button className="btn-brand btn-sm shrink-0" disabled={busy || !to.trim()} onClick={withdraw}>
            {busy ? 'Sending…' : 'Withdraw'}
          </button>
        </div>
      )}
      {msg && <p className="mt-2 text-sm font-semibold">{msg}</p>}
    </div>
  );
}
