# $1 entry, winners take the pot (Arc Testnet, hackathon demo)

**Test network only: test USDC, no real money.** Pooling real entry fees into prizes could make Kalikkam an "online money
game" under India's 2025 online gaming law, so this stays a demo until that's checked with a lawyer.

## What players see

1. The host turns on **"$1 entry, winners take the pot"** when creating a game.
2. In the lobby, each player verifies once with **World ID**. Kalikkam then makes them a wallet: no wallet app, nothing
   to install, one wallet per person.
3. **Get 2 test USDC** (from the server's faucet-funded wallet), then **Pay $1 entry**. The host starts whenever they
   like (at least 3 paid players): anyone who hasn't paid by then watches that round instead, and can pay for the rematch.
4. When the game ends, the pot is paid automatically: **half to the top survivor, half to the top zombie** (ties share,
   a board nobody scored on gives its half to the other, nobody scored means everyone gets their $1 back). Players who
   left the play area can't win.
5. The results show who got what, with a link to the transaction on Arc's explorer. Winnings land in the player's
   Kalikkam wallet, and the profile can withdraw them to any address.

## How it works

- **Pot contract:** `apps/server/contracts/KalikkamEntryPool.sol`, deployed on Arc Testnet at
  [`0x63f9253e50a468919ce63b22f67af4eb9d65425a`](https://explorer.testnet.arc.io/address/0x63f9253e50a468919ce63b22f67af4eb9d65425a).
  Entries are paid in native USDC (Arc's gas token, 18 decimals). Each game round has its own pot id, and a rematch is a
  new round. The server (operator) can only pay **players who paid into that round**, only once, and the amounts must
  add up to the pot. So it can split the pot but can't send it anywhere else.
- **Player wallets:** made by the server after the World ID check (`apps/server/src/arc.ts`). Keys are encrypted at rest
  with AES-256-GCM (`WALLET_SECRET`), and the server signs for the player when they tap. That's custodial, which is fine on
  test money but would need a regulated custody partner (e.g. Circle's managed wallets) with real money.
- **Payout:** `splitPot` in `arc.ts` (exact to the wei), called when a game ends (`payOut` in `index.ts`).

## Setup

```bash
pnpm --filter @kalikkam/server pool key      # operator wallet → apps/server/.env; fund it at https://faucet.circle.com (Arc Testnet)
pnpm --filter @kalikkam/server pool deploy   # deploys the pot, saves ARC_POOL_ADDRESS to .env
pnpm --filter @kalikkam/server pool status
```

`apps/server/.env` (git-ignored) also needs `WALLET_SECRET` (any long random string; losing it locks the player wallets).

## Checked live on Arc Testnet

- `scripts/pool-live-test.ts`: top-ups, three entries, a 1.5 + 1.5 payout, refused to pay a non-player, refused a second payout.
- `test/entry-e2e.ts` against a running server: start refused until all paid, three players paid through the app, the game
  ran, and the pot was paid to the two survivors who tied at the top.
- Unit tests in `test/arc.test.ts`: pot splits, key encryption, the start and rematch rules.
