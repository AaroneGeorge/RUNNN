"""Score + foley for "Join the hunt", all synthesized, from the picture's own events.json.

118 BPM, C major, one chord per bar (C G Am F). Bars 1-8 groove, bar 9 thins, bar 10 is silence (heartbeats
only), bars 11-12 drive, bars 13-14 the end card (music box over a held C). Every foley sound comes from an
event the picture registered (film.js ev()), so sound and picture can't drift.
Usage: python score.py [out.wav] [events.json]   (needs LIB set to the Lemo-Opuscar library)
"""
import json, os, sys
import numpy as np
import soundfile as sf

LIB = os.environ['LIB']
sys.path.insert(0, os.path.join(LIB, 'core', 'audio'))
import sfx  # noqa: E402
from sfx import SR, t_, env_exp, bp, lp, hp, noise, norm, add  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, 'out', 'mix.wav')
EVJ = json.load(open(sys.argv[2] if len(sys.argv) > 2 else os.path.join(HERE, 'out', 'events.json'), encoding='utf-8'))
DUR = EVJ['dur'] + 0.8
BPM = 118
BEAT = 60 / BPM
BAR = 4 * BEAT
at = lambda bar, beat=0.0: bar * BAR + beat * BEAT
N = int(DUR * SR)
music = np.zeros((N, 2))
fx = np.zeros((N, 2))
rng = np.random.default_rng(11)
mtof = lambda m: 440.0 * 2 ** ((m - 69) / 12)

# ---- instruments -------------------------------------------------------------------------------------------
def osc(f0, d, f1=None):
    """Sine with an optional exponential glide f0 -> f1."""
    tt = t_(d)
    f = f0 if f1 is None else f0 * (f1 / f0) ** (tt / d)
    return np.sin(2 * np.pi * np.cumsum(np.full_like(tt, 1.0) * f) / SR)

def kick(v=1.0):
    d = .32
    x = np.tanh(2.2 * osc(140, d, 46) * env_exp(d, .09)) + hp(noise(d), 3000) * env_exp(d, .003) * .3
    return norm(x) * v

def clap(v=1.0):
    d = .22
    x = np.zeros(int(d * SR))
    for k, o in enumerate((0, .009, .018)):
        s = int(o * SR); n = bp(noise(d - o), 900, 2800) * env_exp(d - o, .012 if k < 2 else .07)
        m = min(len(n), len(x) - s)
        x[s:s + m] += n[:m]
    return norm(x) * v

def hat(v=1.0, open_=False):
    d = .14 if open_ else .05
    return norm(hp(noise(d), 7000) * env_exp(d, .05 if open_ else .014)) * v

def snare(v=1.0):
    d = .16
    return norm(bp(noise(d), 1200, 6000) * env_exp(d, .045) + osc(190, d, 150) * env_exp(d, .03) * .6) * v

def bass(f, d=.22, v=1.0):
    tt = t_(d)
    x = np.sin(2 * np.pi * f * tt) + .55 * np.sin(4 * np.pi * f * tt) + .25 * np.sin(6 * np.pi * f * tt)
    e = env_exp(d, .14) * np.minimum(1, tt / .004)
    return lp(x * e, 1400) * v

def marimba(f, v=1.0):
    d = .5; tt = t_(d)
    x = np.sin(2 * np.pi * f * tt) * env_exp(d, .3) + .35 * np.sin(2 * np.pi * 4 * f * tt) * env_exp(d, .05) + .1 * np.sin(2 * np.pi * 10 * f * tt) * env_exp(d, .015)
    return x * np.minimum(1, tt / .002) * v

def bell(f, v=1.0, d=1.8):
    tt = t_(d)
    x = sum(a * np.sin(2 * np.pi * f * r * tt) * env_exp(d, tau) for r, a, tau in [(1, 1, 1.3), (2.76, .45, .55), (5.4, .22, .25), (8.93, .08, .12)])
    return x * np.minimum(1, tt / .002) * v

def pad(freqs, d, v=1.0):
    tt = t_(d)
    x = np.zeros_like(tt)
    for f in freqs:
        for det in (-0.003, 0.003):
            ph = 2 * np.pi * f * (1 + det) * tt
            x += (np.sin(ph) - np.sin(3 * ph) / 9 + np.sin(5 * ph) / 25)  # soft triangle
    e = np.minimum(1, tt / .35) * np.minimum(1, (d - tt) / .45).clip(0, 1)
    return lp(x * e, 2200) / (2 * len(freqs)) * v

def crash(v=1.0):
    d = 1.6
    return norm(hp(noise(d), 3500) * env_exp(d, .45) + bp(noise(d), 6000, 11000) * env_exp(d, .25) * .6) * v

# ---- foley (the app's sounds) ------------------------------------------------------------------------------
def ping(v=1.0):
    d = 1.2; x = osc(1520, d, 1380) * env_exp(d, .28)
    y = x.copy()
    for dl, g in ((.17, .38), (.34, .16)):
        s = int(dl * SR); y[s:] += x[:len(x) - s] * g
    return y * v

def lock(v=1.0):
    a = osc(980, .07) * np.minimum(1, t_(.07) / .002) * env_exp(.07, .05)
    b = osc(1470, .13) * env_exp(.13, .07)
    return np.concatenate([a, np.zeros(int(.012 * SR)), b]) * .8 * v

def tap(v=1.0):
    d = .06
    return norm(osc(230, d, 130) * env_exp(d, .018) + hp(noise(d), 2500) * env_exp(d, .003) * .5) * v

def slide(v=1.0):
    d = .24; tt = t_(d)
    return norm(bp(noise(d), 1500, 5200) * np.sin(np.pi * tt / d) ** 2) * v

def tick(v=1.0):
    d = .03
    return norm(hp(noise(d), 4000) * env_exp(d, .002) + osc(2600, d) * env_exp(d, .004) * .4) * v

def popf(f=800, v=1.0):
    d = .14
    return osc(f * .6, d, f * 1.7) * env_exp(d, .045) * np.minimum(1, t_(d) / .002) * v

def boing(f0=170, f1=420, v=1.0, d=.28):
    tt = t_(d)
    f = f0 * (f1 / f0) ** (tt / d) * (1 + .06 * np.sin(2 * np.pi * 22 * tt))
    return (np.sin(2 * np.pi * np.cumsum(f) / SR) * env_exp(d, .1)) * v

def riser(d):
    tt = t_(d); x = noise(d)
    out = np.zeros_like(x); n = 8
    for k in range(n):  # a band-pass sweep in steps, cross-faded
        a, b = int(k * len(x) / n), int((k + 1) * len(x) / n)
        lo = 300 * (14 ** (k / n))
        out[a:b] = bp(x, lo, lo * 2.2)[a:b]
    return out * (tt / d) ** 2 * .6

# ---- music ----------------------------------------------------------------------------------------------
CH = {  # pad voicing, bass root
    'C': ([261.6, 329.6, 392.0], 65.41), 'G': ([246.9, 293.7, 392.0], 98.0),
    'Am': ([261.6, 329.6, 440.0], 110.0), 'F': ([261.6, 349.2, 440.0], 87.31),
}
PROG = ['C', 'G', 'Am', 'F']
HOOK = [[76, 79, 81, 79, 76, 74, 72, None], [74, 76, 79, None, 81, 79, 76, None]]  # eighths, MIDI

def mix(sound, t, gain=1.0, pan=0.0, bus=None):
    add(music if bus is None else bus, sound, t, gain, pan)

# Bar 0: the hook on the map. Pad + a pick-up; the riser comes from the events.
mix(pad(CH['C'][0], BAR + .3), at(0), .16)
for i, m in enumerate((67, 69)):
    mix(marimba(mtof(m)), at(0, 3 + i * .5), .28, .2)

def groove(bar, mode):
    ch = PROG[bar % 4]
    freqs, root = CH[ch]
    mix(pad(freqs, BAR + .25), at(bar), .14 if mode != 'drive' else .18)
    drive = mode == 'drive'
    for b in range(4):
        mix(kick(), at(bar, b), .62 if drive else .5)
        if (b in (1, 3)) and (mode != 'light'):
            mix(clap(), at(bar, b), .34, .05)
    sub = 4 if drive else 2
    for k in range(4 * sub):
        o = k / sub
        mix(hat(open_=(not drive and k % 2 == 1)), at(bar, o), (.16 if k % 2 else .1) * (1.1 if drive else 1), .25)
    # Slap bass: root on 1, syncopated on the and of 2 and 3, the octave on the and of 4.
    hits = [(0, 1), (1.5, 1), (2.5, 1), (3.5, 2)] if not drive else [(o * .5, 1 if o % 2 == 0 else 2) for o in range(8)]
    for o, mul in hits:
        mix(bass(root * mul, .2 if drive else .24), at(bar, o), .5 if mul == 1 else .3)
    hook = HOOK[bar % 2]
    for k, m in enumerate(hook):
        if m is None: continue
        mix(marimba(mtof(m + (12 if drive else 0))), at(bar, k * .5), .26 if not drive else .22, -.15 + .3 * (k % 2))

for bar in range(1, 9):
    groove(bar, 'light' if bar < 3 else 'main')
mix(crash(), at(1), .3)
# Bar 9: thins to hats and the pad; bass only on the one; the hook stops after two beats.
freqs, root = CH[PROG[9 % 4]]
mix(pad(freqs, BAR), at(9), .12)
mix(bass(root, .5), at(9), .4)
for k in range(8):
    mix(hat(), at(9, k * .5), .1 * (1 - k / 10), .25)
for k, m in enumerate(HOOK[1][:4]):
    if m: mix(marimba(mtof(m)), at(9, k * .5), .2)
# Bar 10: silence. (Heartbeats and pings come from the events.)
# Bars 11-12: drive.
for bar in (11, 12):
    groove(bar, 'drive')
# Snare roll + lift into the end card.
for k in range(8):
    mix(snare(), at(12, 2 + k * .25), .12 + .05 * k, .1)
# Bars 13-14: the end card. Held C, music box, soft kicks.
mix(kick(), at(13), .7); mix(crash(), at(13), .45)
mix(pad(CH['C'][0], DUR - at(13)), at(13), .2)
mix(bass(65.41, 1.2), at(13), .45); mix(bass(65.41, 1.2), at(14), .35)
mix(kick(), at(14), .45)
box = [84, 88, 91, 96, 91, 88, 91, 84, 88, 91, 96, 100, 96, 91, 88, 84]
for k, m in enumerate(box):
    mix(bell(mtof(m), d=1.4), at(13, k * .5), .2 * (1 - k / 30), -.2 + .4 * ((k * 3) % 5) / 4)

# ---- foley from the picture's events ----------------------------------------------------------------------
heart = sfx.heartbeat(1.0)
for e in EVJ['ev']:
    t, s = e['t'], e['type']
    if s == 'ping': add(fx, ping(), t, .32 if t < at(9, 3) - .01 else .12)
    elif s == 'lock': add(fx, lock(), t, .42)
    elif s == 'riser': add(fx, riser(e.get('d', 1.0)), t, .5)
    elif s == 'iris': add(fx, sfx.whoosh(.5, 1.0), t, .5)
    elif s == 'bell':
        for i, m in enumerate((84, 88, 91)):
            add(fx, bell(mtof(m)), t + i * .07, .3, -.2 + .2 * i)
    elif s == 'pop': add(fx, popf(e.get('f', 800)), t, .32, rng.uniform(-.3, .3))
    elif s == 'tap': add(fx, tap(), t, .55)
    elif s == 'slide': add(fx, slide(), t, .22, .2)
    elif s == 'type': add(fx, tick(), t, .4, -.2 + .2 * e.get('i', 0))
    elif s == 'ding': add(fx, sfx.ding(1.0), t, .14)
    elif s == 'heart': add(fx, heart, t, .3)
    elif s == 'step': add(fx, sfx.thump(1.0, 120)[: int(.12 * SR)], t, .12, .35)
    elif s == 'crash': add(fx, crash(), t, .4)
    elif s == 'land': add(fx, boing(160, 380) * .7 + np.pad(sfx.thump(1, 90)[: int(.28 * SR)], (0, 0)), t, .4)
    elif s == 'jump': add(fx, boing(300 * e.get('f', 1), 900 * e.get('f', 1), d=.22), t, .35, -.3)

# Wind under the map scenes.
def wind(d):
    x = lp(sfx.brown(d), 600)
    tt = t_(d)
    return x * np.minimum(1, tt / .6) * np.minimum(1, (d - tt) / .6).clip(0, 1)
add(fx, wind(2.9), 0, .1)
add(fx, wind(at(11) - at(9, 2) + .4), at(9, 2), .12)

# ---- mix: music ducked under the foley, soft clip, normalized (mux.sh does −14 LUFS) -----------------------
envf = np.abs(fx).max(axis=1)
k = int(SR / 12)
envf = np.convolve(envf, np.ones(k) / k, mode='same')
duck = 1 - .35 * np.clip(envf / (envf.max() + 1e-9) * 2, 0, 1)
master = music * duck[:, None] * .9 + fx
# Fade the last 0.6 s.
f = int(.6 * SR)
master[-f:] *= np.linspace(1, 0, f)[:, None]
master = np.tanh(master / np.abs(master).max() * 1.4) * .9
os.makedirs(os.path.dirname(OUT), exist_ok=True)
sf.write(OUT, master.astype(np.float32), SR, subtype='FLOAT')
# Low-end balance report (20-120 Hz vs the rest).
spec = np.abs(np.fft.rfft(master.mean(axis=1)))
fr = np.fft.rfftfreq(len(master), 1 / SR)
lo = (spec[(fr > 20) & (fr < 120)] ** 2).sum(); rest = (spec[(fr >= 120) & (fr < 12000)] ** 2).sum()
print(f'wrote {OUT}  {DUR:.2f}s  low/rest {10 * np.log10(lo / rest):+.1f} dB')
