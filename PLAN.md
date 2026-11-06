# Kalikkam — build plan (working name)

> "Kalikkam" = Malayalam for *"let's play"*. Placeholder — rename any time.
> Goal: our own outdoor group-game kit for adults, as an installable **PWA**, launching in **Kochi**.
> Written 2026-10-22.
>
> **Status 2026-10-22: v1 game build DONE and tested** (see README.md). Stack changed vs. this plan:
> Vite + React PWA (not Next.js), a plain `ws` game server (not Colyseus, which made per-player visibility harder),
> and SQLite via `node:sqlite` (not Postgres) until hosting is decided. Branding, hosting, auth and payments are next.

---

## 1. What we're building

Three parts in one app:

1. **Game engine**: live, location-aware outdoor games, 10–150 players per round.
2. **Host kit**: everything a host needs to run a game. Map boundary, printable numbered vests and QR codes, rules cards, safety briefing, live control panel.
3. **Community**: events, RSVP, profiles, XP and badges, leaderboards, WhatsApp sharing.

### Games at launch

| Game | How it plays | Tech it needs | Build order |
|---|---|---|---|
| **Seektag** (hide & seek) | Hiders wear numbered vests. A seeker who spots one enters that 3-digit number, and the hider is caught. Last hider standing wins. | Boundary + timer + number entry. GPS only for the boundary. | **1st**: simplest, playtest in week 1 |
| **Zombies** (infection tag) | A few zombies hunt survivors. Survivors get a *danger radar* (distance buckets, never exact positions). A tag is made by touch, then the zombie scans the survivor's QR to confirm. Extraction zones open late in the game. | Live GPS, server-side proximity, QR scan, zones, power-ups | **2nd**: the flagship |
| **Spice Route** (Kochi-themed capture game) | Spice caches appear on the map. You collect one by walking within 15 m, then carry it back to your team's port. Rival teams can steal by tagging. | GPS geofences, team state, scoring | **3rd** |

**Design rule: GPS is never the referee.** Phone GPS is off by 5–20 m, and worse in Fort Kochi's lanes. GPS drives the *radar, zones and boundaries*. A *catch* always takes a human action: a vest number, a QR scan or a confirm tap.

---

## 2. Architecture

```
 phones (PWA)  ──HTTPS──▶  web app (Next.js)  ──▶  Postgres
      │                                              ▲
      └──WebSocket──▶  game server (Colyseus) ───────┘
                         authoritative: positions, radar,
                         tags, zones, timers, scoring
```

| Layer | Choice | Why |
|---|---|---|
| Monorepo | pnpm workspaces: `apps/web`, `apps/game-server`, `packages/shared` | Game rules and types shared between client and server |
| Web / PWA | **Next.js 15 + TypeScript + Tailwind**, service worker via **Serwist** | Same stack as our other projects. Installable, offline shell |
| Map | **MapLibre GL + OpenStreetMap tiles** | Free, no Google API key, can draw custom boundaries |
| Realtime | **Colyseus** (Node, WebSocket rooms) | Built for authoritative multiplayer: rooms, state sync, reconnects |
| DB | **Postgres + Drizzle** | Users, events, game history, kit |
| Auth | Better Auth: Google + email OTP. *Guest join with nickname for games* | No signup wall at the park. Phone OTP (MSG91) later, since it costs money |
| Browser APIs | Geolocation `watchPosition`, Screen **Wake Lock**, Vibration, Web Push, camera (QR scanning) | |
| Hosting | Web → **Vercel**. Game server + Postgres → a small VPS in **Mumbai/Bangalore** (DO / AWS Lightsail, ~₹500–1000/mo) | Vercel can't host long-lived WebSockets. An Indian region keeps latency low |
| Dev | devbox: Postgres in docker, `pnpm dev` | |

### Game server responsibilities (the core)
- Room lifecycle: `lobby → briefing → countdown → live → ended`.
- Every 1–2 s each phone sends `{lat, lng, accuracy}`. The server drops fixes with accuracy > 40 m and smooths the rest (simple Kalman filter).
- The server computes what each player is **allowed to see**. A survivor gets radar buckets (`>100 m / 50 m / 25 m / DANGER`), never zombie coordinates. Hosts see everything.
- Tags, catches, power-ups, extraction, timers and scoring are all computed on the server. The client only displays them.
- Reconnects: a player who loses signal rejoins the same role within 2 minutes.

### Data model (first cut)
`users` · `events` (time, place, game, capacity) · `rsvps` · `games` (room, rules config, boundary GeoJSON, status) · `players` (game, user/guest, vest no., role, team) · `game_events` (append-only log: tag, catch, zone, power-up) · `badges` / `xp_ledger`.
Location points are **kept in memory only** and never stored. Only the final summary is saved (privacy, India's DPDP Act).

---

## 3. Build phases (≈ 6 weeks to a complete v1)

Each phase ends with something we can take to a park and play.

### Phase 0: skeleton (days 1–2)
- Monorepo, Next.js PWA (installable, icons, offline shell), Colyseus server, Postgres in docker.
- Screen 1: the map shows *your* live dot, with a GPS accuracy ring.
- **Bot simulator**: a script spawns 50 fake players walking around Marine Drive, so we can test every game without 50 people.

### Phase 1: Seektag playable (week 1) → 🎯 first friends playtest this weekend
- Host: create game → draw boundary on the map → set timers → share join code / QR / WhatsApp link.
- Player: join with nickname + vest number → lobby → countdown → play.
- Seekers enter a vest number → hider caught → live feed. Out-of-bounds warning with vibration. End screen with results.
- Host panel: start / pause / end, kick a player, see who's left.

### Phase 2: Zombies (weeks 2–3)
- Roles, the danger radar UI, tagging by QR scan, plus a manual "I got tagged" fallback.
- Extraction zones that open at T-5 min, power-ups (e.g. *radar jammer*, *sprint shield*), a shrinking safe zone (optional).
- Host live map with everyone's positions. **SOS button**: a player taps it and the hosts get their location immediately.
- Tune radar distances and GPS smoothing in a real field test.

### Phase 3: community (weeks 3–4)
- Accounts (Google / email OTP). Guests can claim their past games later.
- Events: list, detail, RSVP, capacity, waitlist, add to calendar, WhatsApp share card.
- Profiles: games played, wins, XP, badges. Weekly leaderboard per city.
- Web Push: "game starts in 30 min", "you're in!". *(iOS only gets push if the app was installed to the home screen.)*

### Phase 4: the kit + Spice Route (week 5)
- **Kit generator**: printable PDFs of vest numbers (A4, big 3-digit numbers + QR), rules cards, a host checklist and a safety briefing script.
- Spice Route game on the same engine.
- Host training mode: run a full game with bots.

### Phase 5: launch hardening (week 6)
- Load test: 150 players in one room via bots, plus several rooms in parallel.
- Weak-network handling (crowds at Marine Drive), battery check (a 40-min round should use ≤ 15%).
- **Malayalam + English** UI. Consent screens. Location-sharing explainer.
- Deploy: Vercel + VPS, error tracking (Sentry), uptime alert to Telegram (Iva).

### Later (after we know the business model)
- **Razorpay**: paid tickets (₹99–199), corporate team-event packages, season passes.
- Organiser accounts for colleges and companies (white-label their own game nights).
- More cities in Kerala: Thiruvananthapuram, Kozhikode, Thrissur.

---

## 4. Known risks and how we handle them

| Risk | Mitigation |
|---|---|
| GPS inaccuracy / jitter | Accuracy filter + smoothing. Radar in buckets. Humans confirm every catch |
| **iOS PWAs get no background location** | The game screen stays in the foreground with Wake Lock on. We tell players this at join. Rounds are 20–40 min |
| Battery | Positions every 2 s (not continuous), dark map style, short rounds |
| Spotty mobile data in crowds | Small messages, client-side prediction, reconnect with the same role |
| GPS spoofing / cheating | Low stakes. Host can see impossible speeds and kick |
| Player safety (roads, night, mixed groups) | Boundaries drawn away from roads, SOS, host on the ground, safety briefing in the kit |
| Privacy / DPDP Act | Location only during a live game, never stored. Explicit consent. 18+ or guardian |

---

## 5. Decisions needed from the owner
1. **Name** (the domain and PWA icon depend on it).
2. **Hosting accounts**: OK to use Vercel (existing) + a ~₹800/mo Indian VPS for the game server?
3. **First playtest location** (e.g. a ground or park where we have permission).
