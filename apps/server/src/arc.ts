// paid entry pot on Arc Testnet (hackathon demo: test USDC only, no real money).
// Players never connect a wallet: after their World ID check, the server makes each one a Kalikkam wallet, keeps its
// key encrypted, and signs for them (top-up, entry, withdraw). The pot lives in KalikkamEntryPool, which can only pay
// players who paid into that round. Config (apps/server/.env, git-ignored): ARC_OPERATOR_KEY, ARC_POOL_ADDRESS,
// WALLET_SECRET, optional ARC_RPC.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createPublicClient, createWalletClient, formatUnits, http, isAddress, keccak256, parseUnits, toHex, type Abi, type Address, type Hex } from 'viem';
import { arcTestnet } from 'viem/chains';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

import { ENTRY_USDC, TOP_UP_USDC } from '@kalikkam/shared';
const POOL = JSON.parse(readFileSync(new URL('../contracts/KalikkamEntryPool.json', import.meta.url), 'utf8')) as { abi: Abi };

export const ENTRY = parseUnits(String(ENTRY_USDC), 18); // native USDC has 18 decimals on Arc
/** Test top-up per tap, and the most taps per player (the operator wallet is faucet-funded). */
export const TOP_UP = parseUnits(String(TOP_UP_USDC), 18);
export const MAX_TOP_UPS = 3;
/** Kept back in a player wallet so its own transactions can pay network fees. */
const GAS_RESERVE = parseUnits('0.05', 18);
export const EXPLORER = arcTestnet.blockExplorers.default.url;

export class ArcError extends Error {}

export const arcEnabled = () => !!(process.env.ARC_OPERATOR_KEY && process.env.ARC_POOL_ADDRESS && process.env.WALLET_SECRET);

let _pub: ReturnType<typeof createPublicClient> | null = null;
const pub = () => (_pub ??= createPublicClient({ chain: arcTestnet, transport: http(process.env.ARC_RPC) }));
const walletOf = (key: Hex) => createWalletClient({ account: privateKeyToAccount(key), chain: arcTestnet, transport: http(process.env.ARC_RPC) });
const pool = () => process.env.ARC_POOL_ADDRESS as Address;
const operatorKey = () => process.env.ARC_OPERATOR_KEY as Hex;

// ---- player keys, encrypted at rest (AES-256-GCM, key from WALLET_SECRET) ----

const aesKey = () => createHash('sha256').update(String(process.env.WALLET_SECRET)).digest();
export function sealKey(privateKey: Hex): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', aesKey(), iv);
  const body = Buffer.concat([c.update(privateKey, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), body].map((b) => b.toString('base64')).join('.');
}
export function openKey(sealed: string): Hex {
  const [iv, tag, body] = sealed.split('.').map((s) => Buffer.from(s, 'base64'));
  const d = createDecipheriv('aes-256-gcm', aesKey(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(body), d.final()]).toString('utf8') as Hex;
}
export function newPlayerWallet(): { address: Address; sealed: string } {
  const key = generatePrivateKey();
  return { address: privateKeyToAccount(key).address, sealed: sealKey(key) };
}

/** A round's id in the pot: one per game round (a rematch is a new round). */
export const roundId = (code: string, createdAt: number, round: number): Hex => keccak256(toHex(`kalikkam:${code}:${createdAt}:${round}`));

export const usdc = (wei: bigint) => Number(formatUnits(wei, 18));
export const balanceOf = (address: Address) => pub().getBalance({ address });

async function confirm(hash: Hex) {
  const r = await pub().waitForTransactionReceipt({ hash });
  if (r.status !== 'success') throw new ArcError(`The transaction failed on Arc: ${EXPLORER}/tx/${hash}`);
  return hash;
}

/** Test USDC from the operator wallet into a player wallet (hackathon only). */
export async function topUp(to: Address): Promise<Hex> {
  return confirm(await walletOf(operatorKey()).sendTransaction({ to, value: TOP_UP }));
}

/** Pay the entry from the player's own Kalikkam wallet into the pot. */
export async function payEntry(sealed: string, round: Hex): Promise<Hex> {
  const key = openKey(sealed);
  const address = privateKeyToAccount(key).address;
  if ((await balanceOf(address)) < ENTRY + GAS_RESERVE) throw new ArcError('Not enough test USDC in your Kalikkam wallet. Tap "Get test USDC" first.');
  return confirm(await walletOf(key).writeContract({ address: pool(), abi: POOL.abi, functionName: 'join', args: [round], value: ENTRY }));
}

export async function hasJoined(round: Hex, address: Address): Promise<boolean> {
  return (await pub().readContract({ address: pool(), abi: POOL.abi, functionName: 'joined', args: [round, address] })) as boolean;
}

/** Operator: pay the pot out to winners (who must have paid in). */
export async function settle(round: Hex, winners: Address[], amounts: bigint[]): Promise<Hex> {
  return confirm(await walletOf(operatorKey()).writeContract({ address: pool(), abi: POOL.abi, functionName: 'settle', args: [round, winners, amounts] }));
}

/** Operator: give every paying player their entry back. */
export async function refund(round: Hex, players: Address[]): Promise<Hex> {
  return confirm(await walletOf(operatorKey()).writeContract({ address: pool(), abi: POOL.abi, functionName: 'refund', args: [round, players] }));
}

/** Send everything but a fee reserve from the player's Kalikkam wallet to an address of their choice. */
export async function withdrawAll(sealed: string, to: string): Promise<{ hash: Hex; amount: bigint }> {
  if (!isAddress(to)) throw new ArcError("That isn't a wallet address (0x… with 40 hex characters).");
  const key = openKey(sealed);
  const from = privateKeyToAccount(key).address;
  const amount = (await balanceOf(from)) - GAS_RESERVE;
  if (amount <= 0n) throw new ArcError('Nothing to withdraw yet.');
  return { hash: await confirm(await walletOf(key).sendTransaction({ to, value: amount })), amount };
}

/**
 * Split the pot: half to the top survivor(s), half to the top zombie(s), ties share; a board nobody scored on gives its
 * half to the other. Only players who paid can win. Nobody scored at all: refund. Exact in wei (remainder to the first).
 */
export function splitPot(
  pot: bigint,
  rows: { id: string; paid: boolean; points: { survivor: number | null; zombie: number | null } }[],
): { kind: 'settle'; splits: { id: string; amount: bigint }[] } | { kind: 'refund' } {
  const top = (side: 'survivor' | 'zombie') => {
    const on = rows.filter((r) => r.paid && (r.points[side] ?? 0) > 0);
    const best = Math.max(0, ...on.map((r) => r.points[side]!));
    return on.filter((r) => r.points[side] === best).map((r) => r.id);
  };
  const boards = [top('survivor'), top('zombie')].filter((b) => b.length);
  if (!boards.length || pot === 0n) return { kind: 'refund' };
  const totals = new Map<string, bigint>();
  const share = pot / BigInt(boards.length);
  boards.forEach((ids, bi) => {
    const part = bi === boards.length - 1 ? pot - share * BigInt(boards.length - 1) : share;
    const each = part / BigInt(ids.length);
    ids.forEach((id, i) => totals.set(id, (totals.get(id) ?? 0n) + (i === 0 ? part - each * BigInt(ids.length - 1) : each)));
  });
  return { kind: 'settle', splits: [...totals].map(([id, amount]) => ({ id, amount })) };
}
