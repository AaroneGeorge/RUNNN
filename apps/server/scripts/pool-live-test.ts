// Live check of the money path on Arc Testnet (spends ~6 test USDC from the operator wallet):
// three new player wallets are topped up, each pays the $1 entry, the pot is paid to two winners, and the contract's
// guards are tried (paying someone who didn't pay in, paying out twice). Run: pnpm --filter @kalikkam/server pool:live-test
import { createPublicClient, http, type Address, type Hex } from 'viem';
import { arcTestnet } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { ENTRY, EXPLORER, balanceOf, hasJoined, newPlayerWallet, openKey, payEntry, roundId, settle, splitPot, topUp, usdc } from '../src/arc.ts';

const pub = createPublicClient({ chain: arcTestnet, transport: http(process.env.ARC_RPC) });
const round = roundId('LIVE', Date.now(), 0);
const players = ['Anu', 'Bobby', 'Zed'].map((name) => ({ name, ...newPlayerWallet() }));
const show = (h: Hex) => `${EXPLORER}/tx/${h}`;

console.log('round', round);
for (const p of players) {
  const t = await topUp(p.address);
  console.log(`top-up ${p.name} ${p.address}: ${usdc(await balanceOf(p.address))} USDC  ${show(t)}`);
}
for (const p of players) {
  const t = await payEntry(p.sealed, round);
  console.log(`${p.name} paid the entry: joined=${await hasJoined(round, p.address)}  ${show(t)}`);
}

// Guard: the operator can't pay someone who didn't pay in.
const stranger = newPlayerWallet().address;
try {
  await settle(round, [stranger], [3n * ENTRY]);
  console.log('FAIL: paid a stranger');
  process.exitCode = 1;
} catch {
  console.log('ok: refused to pay someone who did not pay in');
}

// The real payout: Bobby tops the survivor board, Zed the zombie board.
const plan = splitPot(3n * ENTRY, [
  { id: 'Anu', paid: true, points: { survivor: 40, zombie: 0 } },
  { id: 'Bobby', paid: true, points: { survivor: 200, zombie: null } },
  { id: 'Zed', paid: true, points: { survivor: null, zombie: 75 } },
]);
if (plan.kind !== 'settle') throw new Error('expected a payout');
const before = await Promise.all(players.map((p) => balanceOf(p.address)));
const addr = (id: string) => players.find((p) => p.name === id)!.address as Address;
const tx = await settle(round, plan.splits.map((s) => addr(s.id)), plan.splits.map((s) => s.amount));
const after = await Promise.all(players.map((p) => balanceOf(p.address)));
players.forEach((p, i) => console.log(`${p.name}: +${usdc(after[i] - before[i])} USDC`));
console.log('payout', show(tx));

// Guard: no second payout of the same round.
try {
  await settle(round, [addr('Bobby')], [0n]);
  console.log('FAIL: paid out twice');
  process.exitCode = 1;
} catch {
  console.log('ok: refused a second payout');
}
const r = (await pub.readContract({
  address: process.env.ARC_POOL_ADDRESS as Address,
  abi: [{ type: 'function', name: 'rounds', stateMutability: 'view', inputs: [{ type: 'bytes32' }], outputs: [{ type: 'uint256' }, { type: 'uint32' }, { type: 'bool' }] }],
  functionName: 'rounds',
  args: [round],
})) as [bigint, number, boolean];
console.log(`round on chain: pot ${usdc(r[0])}, players ${r[1]}, closed ${r[2]}`);
void openKey;
void privateKeyToAccount;
