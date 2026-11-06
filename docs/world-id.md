# World ID in Kalikkam: one spot per person

Submission for **Best Use of IDKit** (ETHGlobal Mumbai).

## The trust moment

Kalikkam runs outdoor Zombie Run game nights in Kochi. Events have a **capacity** (a park fits so many players) and a
waitlist. Anyone can join as a guest with just a name, and in our first test run people did: one player ended up
with three guest profiles, another with two. Nothing stopped one person claiming several spots at a free, capped game night
and pushing real players onto the waitlist.

So the protected action is **claiming a spot at a capped event**. With World ID set up, "I'm in!" first asks for a
World ID check. Each human can verify **one** Kalikkam profile, and an RSVP belongs to a profile, so each human gets
at most one spot per event.

## Why Selfie Check

The minimum sufficient assurance here is "this is a distinct, live person", not "this is a specific, documented
person". It's a free game night, not a payout:

- **Selfie Check** (credential 11) gives liveness plus a Sybil score with only a phone camera. Most of our players
  have never been near an Orb, and an Orb visit for a game night is a non-starter.
- **Proof of Human** (Orb) is stronger than needed. It's kept as a server setting (`WORLD_CREDENTIAL=proof_of_human`)
  for events where the stakes rise (prizes, paid tickets).
- **Passport / NFC** and **Identity Check** reveal or attest document attributes we don't need, so they'd collect more than the job requires.

## How it works

1. **Browser:** the player taps "I'm in!" on a capped event. The app asks our server for an RP signature, then opens
   World's `IDKitRequestWidget` with `selfieCheck({ signal: <profile id> })`, action `verify-human`, `allow_legacy_proofs: false`.
2. **Server signs** (`POST /api/world/rp-signature`): `signRequest` from `@worldcoin/idkit-core/signing`. The signing
   key lives only in the server's environment.
3. **Server verifies** (`POST /api/world/verify`), and the browser's answer is never trusted:
   - protocol 4.0, our action, the expected environment, a Selfie Check response;
   - the `signal_hash` must equal `hashSignal(profile id)`, so a proof can't be replayed to verify someone else's profile;
   - `POST https://developer.world.org/api/v4/verify/{rp_id}` must return `success: true` in the same environment.
4. **Server stores the nullifier** (`world_humans`, unique per action and nullifier, and one row per profile). The same person re-verifying
   the same profile is fine. The same person on a second profile is refused.
5. **RSVP endpoint enforces it:** `POST /api/events/:id/rsvp` returns 403 for an unverified profile. The button isn't the guard.

Code: `apps/server/src/world.ts`, `apps/server/src/store.ts` (`recordHuman`), `apps/server/src/index.ts` (routes and
the RSVP gate), `apps/web/src/components/WorldCheck.tsx`, `apps/web/src/pages/Events.tsx`. Tests: `apps/server/test/world.test.ts`.

## The paths we demo

| Path | What happens |
|---|---|
| Verified | Selfie Check passes, server verifies, the spot is claimed, the profile shows "✓ human" |
| Cancelled | The player closes World's sheet: no spot, "You closed the World ID check, so no spot was claimed." |
| Second profile | The same person verifies a new guest profile: refused, "You already verified another Kalikkam profile…" |
| Forged or replayed proof | Proof for another profile, wrong action or environment: refused on our server before World is called |
| Skipping the button | Calling the RSVP API directly while unverified: 403 |

## Integration debrief

- **Time to first success:** about 1 hour from an empty Developer Portal team to World's widget opening on a signed request
  (app, World ID 4.0 RP, action and keys all set up through the Developer Portal MCP from Claude Code), and about 3 hours
  to the full server-verified flow with tests.
- **Friction:**
  - The integration guide shows `orbLegacy` while the credentials page recommends `selfieCheck` and `proofOfHuman`.
    Which preset fits a new 4.0 app took two pages to work out.
  - The guide doesn't say whether actions must be created in the portal first or can be passed at request time.
  - The React widget example doesn't show the `environment` prop; we found it in the type definitions.
  - The meaning and scale of `sybil_score` for Selfie Check aren't documented ("z-score encoded as an integer"), so we log it but
    don't set a threshold yet.
  - On the server, the signal-binding check (`hashSignal`) is easy to miss; the docs mention the signal is "enforced by your backend"
    but don't show it.
- **Missing:** a staging/simulator note per credential (does the simulator issue Selfie Check?), and a server-side
  `verifyResult()` helper that bundles the environment, action and signal checks most backends need.
- **Highest-impact improvement:** one end-to-end "uniqueness gate" recipe (sign, request, verify, store nullifier,
  check signal) in a single page, with the recommended preset for new apps. Most of our time went into stitching
  those steps together from three pages.

## Setup

Server environment (`apps/server/.env`, git-ignored): `WORLD_APP_ID`, `WORLD_RP_ID`, `WORLD_RP_SIGNING_KEY`,
`WORLD_ENV` (`staging` for the simulator and sandbox apps, `production` for real users), optional
`WORLD_CREDENTIAL` (`selfie` by default, `proof_of_human`, or `device`). Without these, World ID is off and RSVPs work as before.

**Selfie Check is gated.** World switches it on per app; until then World App shows "Feature unavailable, contact your
World POC to enable Selfie Check for your app" (code `feature_unavailable`). Submitting the app to the store doesn't
enable it: ask the World team with the app id. Meanwhile:

- `WORLD_CREDENTIAL=proof_of_human`: Orb-verified World IDs (4.0, falling back to 3.0 legacy proofs).
- `WORLD_CREDENTIAL=device`: any World App user (3.0 device proof). A demo stopgap only: one phone can't verify twice,
  but it isn't real Sybil resistance.
