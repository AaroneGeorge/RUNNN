# RUNNN

Outdoor chase games for phones. One side hunts, the other runs, and the tag is real: hunters hold their camera on the numbered QR bib pinned to a runner's back.

It's an installable PWA served by a single Node process, which runs the API, the realtime game loop over WebSockets and the built web app on one port.

## How a round works

- The organiser draws the play area on a map and opens a room. Players join with a 4-letter code, their name and their bib number.
- When the round starts, the app deals **hunters** and **runners** at random. Nobody picks sides, not even the organiser.
- Runners get a head start. Then hunters are released.
- To catch a runner, a hunter holds the camera on the runner's bib until the ring fills (5–10 s, set by the organiser). If the bib leaves the frame for more than a second, the scan breaks.
- A caught runner becomes a hunter. They keep the runner points they earned and start scoring as a hunter.
- If a camera won't cooperate, the caught runner taps **I got caught** and types the hunter's private 4-digit claim code.
- Stay inside the area. Anyone outside it for more than 30 seconds, with a good GPS fix, is out for the round.
- Scoring: runners get **10 points per minute** alive and hunters get **25 points per catch**.
- The round ends when time runs out, when every runner is caught, or when no hunters are left.

**GPS is never the referee.** It drives the proximity radar and the boundary, and it can reject a tag that's physically impossible. A catch always needs a human action: a camera on a real bib, or a claim code both players agree on.

## Requirements

- Node 22.13 or newer (`node:sqlite` is built in)
- pnpm 10
- HTTPS for real devices. Phone browsers only allow the camera and GPS on a secure origin, and `localhost` counts as secure.

## Run it

```bash
pnpm install
pnpm build                                        # web app → apps/web/dist
pnpm --filter @runnn/server organisers add alice  # prompts for a password
pnpm start                                        # http://localhost:2567
```

Development, with the server on `:2567` and Vite on `:5180` proxying `/api` and `/ws`:

```bash
pnpm dev
```

Sign in as an organiser from the intro screen (**I'm an organiser**) to host games, print bibs, open the HQ and run simulations.

### Environment

| Variable | Default | |
|---|---|---|
| `PORT` | `2567` | |
| `HOST` | `0.0.0.0` | Use `127.0.0.1` behind a reverse proxy |
| `DB_PATH` | `apps/server/data/runnn.db` | SQLite file |
| `BIB_KEY_PATH` | `apps/server/data/bib.key` | Signing key for bib QRs, created on first run |
| `WEB_DIST` | `apps/web/dist` | |
| `ORGANISER_USERNAME` / `ORGANISER_PASSWORD` | | Seeds an organiser account on boot |
| `RESEND_API_KEY` / `MAIL_FROM` | | Email sign-in codes. Without them, codes are printed to the server log |
| `TRUST_PROXY` | | Set when behind a proxy so rate limits use `X-Forwarded-For` |

**Back up `data/bib.key`.** Losing it invalidates every bib already printed.

## Bibs

Organisers open **Print bibs** to generate signed QR codes (`RN1:<number>:<signature>`), one per A4 page. A QR typed into any generator won't pass the signature check. Print them on matte paper with the QR at least 10 cm wide, and pin each one flat between the shoulders.

## Testing without going outside

- **GPS test mode** (Settings): tap the map to move instead of using real GPS.
- **Bots**: in the lobby, `+3` adds bots that walk, chase, flee and tag.
- **Simulations**: bots-only rooms at 1–8× speed. Watch the whole map, or look through a hunter's or runner's screen.

```bash
pnpm test        # rules, auth, scoring, geo (vitest)
pnpm typecheck
pnpm --filter @runnn/server smoke   # full round over real WebSockets
pnpm e2e         # headless Chromium reads a QR from a fake camera and lands a tag
```

`pnpm e2e` needs a Chromium for playwright-core: `pnpm exec playwright-core install chromium-headless-shell`.

## Layout

```
apps/server     HTTP + WebSocket + static files + SQLite (run from TypeScript with tsx)
  src/room.ts       rooms, clocks, phases, positions, per-player views
  src/games/chase.ts  the rules, scoring and bot behaviour
  src/store.ts      profiles, events, results, organisers, email codes
  src/bibcode.ts    HMAC-signed bib QRs
apps/web        Vite + React PWA
packages/shared wire protocol, game catalogue, scoring maths, geo helpers
e2e             browser test against the real build
```

## Deploy

Run `pnpm build`, then run `node --import tsx src/index.ts` from `apps/server` under a process manager such as systemd. Bind it to `127.0.0.1` and put HTTPS in front of it with a reverse proxy or tunnel that passes WebSocket upgrades through on the same hostname. Back up `data/*.db` and `data/bib.key`.
