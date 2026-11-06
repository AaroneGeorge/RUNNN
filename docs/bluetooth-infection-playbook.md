# Bluetooth infection playbook

How Kalikkam adds PlayCulture-style Bluetooth infection to Zombies: what they do, what a web app can and
can't do, the design, and the build steps from goal backwards.

Written 2026-10-23. Researched with Agent Reach (Exa search, Jina reader, YouTube transcript); sources at the end.

---

## 1. The goal

> A zombie walks within about 10 m of a survivor, taps **Infect**, stays close for a few seconds, and the survivor is
> infected. No touching or scanning needed. A shoulder tap plus a QR scan still works as the backup.

Done means:
- It works on Android **and** iPhone at a real game in Kochi.
- A survivor can't dodge it by switching Bluetooth off.
- Players who only have the web link can still play, using tag + QR.

---

## 2. How PlayCulture does it (verified)

From their Zombies page, host welcome script and player tutorial video:

| Rule | PlayCulture |
|---|---|
| Ways to infect | Physical tag (both tap the skull, survivor scans zombie's QR) **or** Bluetooth |
| Bluetooth range | "about 10 m", tutorial says "5 to 15 m", "varies a lot depending on your surroundings" |
| Infect button | Zombie taps **Infect** → infectious for **~10 s** → recharge **~40–45 s** |
| Infection bar | Survivor sees a bar fill while an infectious zombie is in range. **One zombie ≈ 5 s** to fill; **more zombies fill it faster** |
| Bluetooth is a mode | Host turns "Bluetooth mode" on or off per game |
| Permissions | Location, **Bluetooth**, camera |
| Their app | Native iOS + Android app (App Store id1639884623, Play `com.playculture.playculture`), not a website |
| Extras we don't have | Health coins that drain over time, health zones, bounty (zombie gets half the survivor's coins), assist bonus, coin shop |

---

## 3. The constraint: a PWA can't do this

| Platform | Can it **scan** for nearby phones? | Can it **advertise** itself? |
|---|---|---|
| Chrome Android (PWA) | Only behind `chrome://flags` experimental flag | **No** (not in Web Bluetooth at all) |
| Safari iPhone (PWA) | **No.** WebKit doesn't support Web Bluetooth and has no plans to (anti-fingerprinting) | **No** |
| Native app (Capacitor) | **Yes**, iOS + Android | **Yes**, iOS + Android |

Every phone has to both **advertise** ("I'm player X") and **scan** ("I can see players Y, Z"). Web Bluetooth
can't advertise anywhere. **So Bluetooth infection needs a native app.**

### Decision
Wrap the existing React app in **Capacitor 8** (same code, same server; the web build becomes the app's UI) and add a
Bluetooth Low Energy plugin. The website keeps working for anyone without the app.

| Plugin | Advertise + scan | Cost | Verdict |
|---|---|---|---|
| `@capgo/capacitor-bluetooth-low-energy` 8.2.x | ✅ both, iOS + Android | Free (MPL-2.0) | **Start here.** Small project (9★) but updated Oct 2026 |
| Capawesome Bluetooth LE | ✅ both | Paid (Insiders) | Fallback if Capgo fails |
| `@capacitor-community/bluetooth-le` | ❌ scan only | Free | Can't advertise, rejected |
| Our own ~300-line Swift + Kotlin plugin | ✅ | Free, our time | Last resort; we'd control it fully |

**Rejected alternatives:** GPS distance (phone GPS is off by 5–20 m, too coarse for a 10 m rule); ultrasonic audio
chirps (blocked by pockets and noise, needs the mic open the whole game); NFC (touch-range only, iPhone can't read
arbitrary tags from the web).

---

## 4. Game design for Kalikkam

Matches PlayCulture's feel; every number is a host setting.

| Setting | Default | Notes |
|---|---|---|
| `bluetoothInfection` | on (if app players present) | Host toggle. Off = tag + QR only (today's game) |
| `infectiousSecs` | 10 s | How long a zombie stays infectious after tapping Infect |
| `infectRechargeSecs` | 45 s | Cooldown |
| `infectFillSecs` | 5 s | Time for one zombie to fill a survivor's bar |
| `rssiThreshold` | −75 dBm | "In range". Calibrated on day 1 (see §7); ≈ 5–15 m |
| Multi-zombie | bar fills at `n ×` speed | 2 zombies in range = 2.5 s |
| Bar decay | empties at 1× when nobody is in range | So running away works |
| Shield power-up | blocks Bluetooth infection too | Already exists |

**What players see**
- **Zombie:** big **🦠 Infect** button with a recharge ring. When active, a 10 s countdown and a pulse on the radar.
- **Survivor:** a red **infection bar** that slides down from the top, with a heavy buzz while it fills. When it empties: "Phew".
- **Host:** each player shows a Bluetooth status dot (on / off / web-only).

---

## 5. How it works technically

```
 every phone (native app)                      server (authoritative, already exists)
 ────────────────────────                      ──────────────────────────────────────
 advertise: service UUID KLK + 6-char token ─┐
 scan:      KLK adverts → {token, rssi}      ├─► "ble" msg every 1 s: [{token, rssi}, …]
                                             │
 zombie taps Infect ─────────────────────────┴─► marks zombie infectious for 10 s
                                                 for each survivor: any infectious zombie seen
                                                 (by EITHER phone) with rssi ≥ threshold?
                                                   → fill bar  (n zombies → n× speed)
                                                   → else decay
                                                 bar full → infect(zombie → survivor)
```

- **Token, not identity:** each player gets a random 6-character token per game, sent with the join. Adverts never
  carry names or vest numbers. The token changes every game.
- **Either direction counts:** if the zombie's phone sees the survivor *or* the survivor's phone sees the zombie, that's a
  sighting. A survivor who stops advertising is still caught by the zombie's scanner, and the reverse.
- **iPhone advert limits:** iOS only lets apps advertise a service UUID + a short local name, and only while the app is in
  the foreground. That's fine: the game already requires the app open with the screen on. Token goes in the local name.
- **Android:** one continuous scan for the whole game (Android throttles apps that start more than 5 scans per 30 s).
  Needs `BLUETOOTH_SCAN`, `BLUETOOTH_ADVERTISE`, `BLUETOOTH_CONNECT`.
- **Smoothing:** server takes the median RSSI over the last 3 s per pair, so one noisy reading can't infect anyone.
- **New protocol message:** `{ t: 'ble', seen: [{ token, rssi }] }` (client → server), plus `bleState: 'on'|'off'|'web'`.
  Server adds `infectBar` (0–1) and `infectiousUntil` to the Zombies HUD.

### Anti-cheat
| Cheat | Answer |
|---|---|
| Survivor turns Bluetooth off | App reports `bleState`; host sees 🔴; zombie's own scan still sees them unless their phone is fully off. Game setting: Bluetooth-off survivors lose the danger radar |
| Survivor plays on the website to avoid Bluetooth | Host setting: "Bluetooth game: app required". Web players shown as 🌐 in the lobby |
| Fake RSSI from a modified app | Low stakes. Server rejects RSSI above −30 or reports from a player with no fresh sighting the other way twice in a row |
| Phone in a bag (weak signal) | That's real-world tactics, same as PlayCulture. The calibration day sets the threshold |

---

## 6. Build plan (backwards from the goal)

| # | Phase | What's done at the end | Time | Needs from owner |
|---|---|---|---|---|
| 6 | **Real game** | 10+ friends play a Bluetooth game at Marine Drive | 1 evening | Players |
| 5 | **Calibrate** | 2 phones (1 iPhone, 1 Android) walked apart at 2/5/10/15/20 m in open air + in a crowd; `rssiThreshold` set | 1 hour | 2 phones, 1 friend |
| 4 | **Distribute** | Android: APK link (sideload) for friends; iOS: TestFlight invite | 1 day | **Apple Developer account ($99/yr)**; Google Play ($25 once) only if we want the Play Store |
| 3 | **Game logic** | Infect button, bar, server rules, host toggle, tests with simulated sightings (bots get fake RSSI so sims show it) | 2 days | Nothing |
| 2 | **Bluetooth spike** | 2 phones on a desk see each other's tokens + RSSI live on screen | 1 day | 1 Android phone + 1 iPhone to test on |
| 1 | **Capacitor shell** | Kalikkam opens as an installed Android app on a phone, same server | ½ day | Nothing (Android builds on devbox) |

**Total ≈ 5 working days** to a playable Bluetooth game. iOS builds need **Xcode on a Mac** (your Mac on the LAN works);
Android builds run on devbox.

**Biggest risk:** the Capgo plugin is young. Phase 2 is the gate: if two phones can't see each other reliably by the end
of the spike, switch to Capawesome (paid) or write the small native plugin, adding ~2 days.

---

## 7. Game-day additions (for the host kit)

- **Before:** everyone installs the app (Android APK link / TestFlight), grants Location + Bluetooth + Camera, turns off
  battery saver.
- **Lobby check:** host's player list must show 🔵 Bluetooth for every player. Anyone 🌐 web-only plays tag + QR.
- **Briefing line to add:** "Zombies can infect you from about 10 metres with the Infect button. If your screen goes
  red and buzzes, *run*: the bar empties when they lose you."
- **First game in a new spot:** run 2 minutes with 1 zombie and check the bar fills at about arm's-length-times-five.
  If it fires from too far, raise the threshold (e.g. −75 → −70).

---

## 8. Not copying (yet)

PlayCulture's **health coins / bounty / shop** economy is a separate feature. It's worth considering after Bluetooth works,
since it's what makes their leaderboard interesting. It's left out here to keep this change focused.

---

## Sources
- PlayCulture Zombies page (equipment, Bluetooth role): https://www.playculture.com/zombies
- PlayCulture Zombies welcome script (10 s infectious, 45 s recharge, ~10 m): https://www.playculture.com/zombies-welcomescript
- PlayCulture player tutorial (5–15 m, infection bar ~5 s, multi-zombie faster): https://www.youtube.com/watch?v=IT_PW83UpfU
- PlayCulture on the App Store: https://apps.apple.com/us/app/playculture/id1639884623
- Web Bluetooth implementation status (scanning behind flag; Safari: no plans): https://github.com/WebBluetoothCG/web-bluetooth/blob/main/implementation-status.md
- caniuse: Web Bluetooth (iOS Safari: no): https://caniuse.com/web-bluetooth
- Capgo Capacitor BLE plugin (peripheral + central): https://github.com/Cap-go/capacitor-bluetooth-low-energy
- Capawesome Capacitor BLE plugin (Insiders): https://capawesome.io/docs/sdks/capacitor/bluetooth-low-energy/
- capacitor-community/bluetooth-le (central only): https://github.com/capacitor-community/bluetooth-le
