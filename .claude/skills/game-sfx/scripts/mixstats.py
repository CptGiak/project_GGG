#!/usr/bin/env python3
"""Mix statistics for a capture.mjs recording: BS.1770 loudness of the master / music / SFX taps
(integrated, max momentary, max short-term), the music-to-SFX balance, the SFX bus's spectral
balance and noisiness, and how often each sound triggers (and within 25 m of the listener).

    python3 .claude/skills/game-sfx/scripts/mixstats.py <prefix>
    (reads <prefix>.master.wav/.music.wav/.sfx.wav/.log.json; needs numpy + scipy)

The music and SFX taps are mono downmixes: add ~3 dB to compare them with the stereo master.
Healthy numbers for this game at default settings (see references/mixing.md): master about
-18 LUFS integrated in combat, limiter active < 10 % of the time, SFX events 6-10 dB above the
score, most SFX energy 120 Hz-2 kHz.
"""
import json
import sys
import wave
from collections import Counter, defaultdict

import numpy as np
from scipy.signal import lfilter


def read(path):
    with wave.open(path) as w:
        sr = w.getframerate()
        ch = w.getnchannels()
        x = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float64) / 32768
    return sr, x.reshape(-1, ch)


def kweight(x, sr):
    # BS.1770-4 pre-filter (high shelf) + RLB high-pass, coefficients re-derived for sr
    import math
    f0, G, Q = 1681.974450955533, 3.999843853973347, 0.7071752369554196
    K = math.tan(math.pi * f0 / sr)
    Vh, Vb = 10 ** (G / 20), 10 ** (G / 20) ** 0.4996667741545416
    a0 = 1 + K / Q + K * K
    b1 = [(Vh + Vb * K / Q + K * K) / a0, 2 * (K * K - Vh) / a0, (Vh - Vb * K / Q + K * K) / a0]
    a1 = [1, 2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0]
    f0, Q = 38.13547087602444, 0.5003270373238773
    K = math.tan(math.pi * f0 / sr)
    b2 = [1, -2, 1]
    a2 = [1, 2 * (K * K - 1) / (1 + K / Q + K * K), (1 - K / Q + K * K) / (1 + K / Q + K * K)]
    return lfilter(b2, a2, lfilter(b1, a1, x, axis=0), axis=0)


def loudness(x, sr):
    y = kweight(x, sr)
    ms = (y ** 2).sum(axis=1)
    blk, hop = int(0.4 * sr), int(0.1 * sr)
    mom = np.array([ms[i:i + blk].mean() for i in range(0, len(ms) - blk, hop)])
    lk = -0.691 + 10 * np.log10(mom + 1e-12)
    gated = mom[lk > -70]
    if not len(gated):
        return -99, lk, -99
    rel = -0.691 + 10 * np.log10(gated.mean()) - 10
    g2 = mom[(lk > -70) & (lk > rel)]
    integ = -0.691 + 10 * np.log10(g2.mean())
    sblk = int(3 * sr)
    st = np.array([ms[i:i + sblk].mean() for i in range(0, len(ms) - sblk, hop)])
    stl = -0.691 + 10 * np.log10(st + 1e-12)
    return integ, lk, stl


def band_share(x, sr, lo, hi):
    m = x.mean(axis=1)
    n = 1 << 14
    acc = np.zeros(n // 2 + 1)
    for i in range(0, len(m) - n, n // 2):
        acc += np.abs(np.fft.rfft(m[i:i + n] * np.hanning(n))) ** 2
    f = np.fft.rfftfreq(n, 1 / sr)
    tot = acc.sum()
    return acc[(f >= lo) & (f < hi)].sum() / tot, acc, f


def flatness(x, sr):
    m = x.mean(axis=1)
    n = 2048
    vals = []
    for i in range(0, len(m) - n, n):
        s = np.abs(np.fft.rfft(m[i:i + n] * np.hanning(n))) ** 2 + 1e-12
        if s.sum() < 1e-6:
            continue
        vals.append(np.exp(np.log(s).mean()) / s.mean())
    return float(np.median(vals)) if vals else 0


p = sys.argv[1]
out = {}
for k in ('master', 'music', 'sfx'):
    sr, x = read(f'{p}.{k}.wav')
    integ, mom, st = loudness(x, sr)
    peak = 20 * np.log10(np.abs(x).max() + 1e-12)
    out[k] = dict(LUFS=round(integ, 1), maxMomentary=round(float(mom.max()), 1), maxShortTerm=round(float(st.max()), 1), p95Momentary=round(float(np.percentile(mom[mom > -60], 95)), 1) if (mom > -60).any() else None, peak=round(float(peak), 1))
    if k in ('sfx', 'master'):
        bands = [(20, 120), (120, 500), (500, 2000), (2000, 5000), (5000, 9000), (9000, 20000)]
        sh = {}
        for lo, hi in bands:
            s, _, _ = band_share(x, sr, lo, hi)
            sh[f'{lo}-{hi}'] = round(10 * np.log10(s + 1e-12), 1)
        out[k]['bandsDb'] = sh
        out[k]['flatness'] = round(flatness(x, sr), 3)
print(json.dumps(out, indent=1))
print('music - sfx (integrated):', round(out['music']['LUFS'] - out['sfx']['LUFS'], 1), 'dB')

log = json.load(open(f'{p}.log.json'))['log']
dur = max(e[0] for e in log) if log else 1
c = Counter(e[1] for e in log)
near = Counter(e[1] for e in log if e[2] < 0 or e[2] < 25)
print(f'\ntriggers: {len(log)} in {dur:.0f}s = {len(log)/dur:.1f}/s ; within 25 m or 2D: {sum(near.values())/dur:.1f}/s')
print('name               total   /s    near/s')
for n, k in c.most_common(40):
    print(f'{n:18s} {k:5d} {k/dur:5.2f}  {near[n]/dur:5.2f}')
# busiest 1 s windows of 'hit'-type sounds near the listener
hits = [e[0] for e in log if e[1] in ('hit', 'hitHeavy', 'tick', 'dink', 'crit', 'block') and (e[2] < 25)]
if hits:
    w = defaultdict(int)
    for t in hits:
        w[int(t)] += 1
    print('\nmax hit-family triggers in one second (near):', max(w.values()))
