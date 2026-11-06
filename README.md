# Zombie Run (repo: kalikkam)

Outdoor group games for adults, run from an installable **PWA**. Launching in Kochi.
One game ships today, plus a host kit, a simulation mode and a small community layer:

🧟 **Zombie Run**: infection tag. Teams are dealt at random when the game starts (35–45 % zombies, always fewer
than survivors). Everyone wears a printed QR on their back, and a zombie infects by holding their phone camera on it
for 5–10 s while the survivor's phone screams "RUN!". Caught without a scan? The survivor taps "I got infected" and
types the zombie's private 4-digit **catch code**, so the right zombie gets the credit. Players get a **radar**, not a
map: everyone within 10 m (host setting) shows as a dot coloured by team, with no names. Leave the play area and you
have 30 s to get back in, or you're out of the round with no points.

**Points** are the main result, on two leaderboards: survivors score 10 a minute alive, zombies 25 per infection
(an infected survivor keeps their survivor points and scores as a zombie from then on). The team result stays as a
line: survivors win if anyone is uninfected at the end. A host who isn't playing referees from the full map.

**Hosts** (organisers, with a username and password) are the only ones who create games and events. Players join as
guests with just a name, and can add an email after a game to keep their XP on any phone. Every finished game saves a
**log** (scans, how each infection was credited, host pause/end with a reason, players out of bounds, GPS dropouts)
that hosts read in **Host HQ**.

**Vest QRs are signed** (`KLK1:<vest>:<HMAC>`, key in `apps/server/data/vest.key`, created on first run), so a QR
can't be faked from a number. Print them from the Kit. ⚠️ Back up `vest.key`: losing it means reprinting every vest.

Seektag and Spice Route were built and then removed on 2026-10-23 to focus on Zombies. They are in git history
(before the "Zombies only" commit) if they come back. The engine still takes one `GameModule` per game.

**Design rule: GPS is never the referee.** Phone GPS is ±5–20 m, so GPS drives radar, zones
and boundaries. Every catch or tag needs a human action (vest number / QR scan / "I got tagged").
GPS only *rejects* a tag that is clearly impossible (both fixes good, far apart).

## Run it

```bash
# Node ≥ 22.13 (uses built-in node:sqlite). On devbox: export PATH=~/.nvm/versions/node/v24.14.1/bin:$PATH
pnpm install
pnpm build            # builds the PWA into apps/web/dist
pnpm start            # game server + API + PWA on http://localhost:2567
pnpm --filter @kalikkam/server hosts add <username>   # a host account (asks for the password); also: list, remove <username>
```

Or set `HOST_USERNAME` and `HOST_PASSWORD` in the server's environment (e.g. the deploy's secrets): that account is
created, or its password updated, when the server starts. Hosts sign in from the small "Sign in as host" link on
the welcome screen. Email sign-in codes go out through Resend when `RESEND_API_KEY` and `MAIL_FROM` are set;
otherwise the code is printed in the server console.

Dev mode with hot reload: `pnpm dev` (server on :2567, Vite on :5180 with /api and /ws proxied).

### Testing without people or GPS
- **Bots:** in the lobby the host adds bots, which are dealt a team with everyone else. Bot zombies chase and scan, bot survivors run. Or use **Bot test** in Host HQ for a bots-only round with fast-forward.
- **Test mode (fake GPS):** Settings or the lobby → *Test mode*. Tap the map to move yourself; in a game, tap the radar
  to step that many metres.
- **Real GPS needs HTTPS** (browsers block geolocation on plain http except `localhost`).
  For phones, put the server behind HTTPS (e.g. `tailscale serve`) or use test mode.

### Tests
```bash
pnpm test     # game-logic simulations: full bot games, fast-forwarded sims, anti-cheat, no-leak checks
pnpm smoke    # end-to-end against a running server: HTTP + WebSocket + profiles/XP (needs HOST_USERNAME/HOST_PASSWORD)
pnpm e2e      # full browser game: 3 phones join, the zombie's fake camera scans a vest QR, results checked
pnpm typecheck
```

## Layout

```
packages/shared   game catalogue (rules, settings), geo maths, wire protocol, XP/badges
apps/server       Node HTTP + WebSocket server (authoritative game engine), node:sqlite store
  src/room.ts       room lifecycle, clocks (pause-safe), GPS smoothing, bots, per-player views
  src/games/*.ts    zombies module (GameModule interface, so more games can be added)
  src/store.ts      profiles, email sign-in, host accounts, events + RSVPs/waitlist, results + game logs, XP, badges
  scripts/hosts.ts  add, list and remove host accounts
apps/web          Vite + React 19 + Tailwind 4 PWA, MapLibre + OpenFreeMap tiles (no API key)
  src/pages         Welcome, Home, Join, Host wizard, Host HQ, Play, Events, Profile/Leaderboard, Kit, Settings
  src/game          Lobby, Live HUDs (radar etc.), Results
```

**Privacy:** the server keeps locations in memory only for the running game. No coordinates are written to disk:
the game log keeps GPS *health* (dropouts, accuracy), never positions. Each player gets a personalised view: other
players' positions only reach a phone as radar dots (metres from you, within range, no names or ids), and vest
numbers and catch codes never leave the player's own and the host's view. The **run map (beta)** that shows you
your route after a game is recorded on your own phone and never sent to the server.

## Not built yet (on purpose)
Branding, hosting, merging duplicate guest profiles, payments (Razorpay), web push, Malayalam UI. See `PLAN.md`.
