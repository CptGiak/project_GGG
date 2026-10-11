#!/usr/bin/env python3
"""
Per-sound loudness and timbre of a dry render (preview.ts `sfxDry`), for loudness matching.

    node .claude/skills/game-sfx/scripts/render.mjs sfxDry '{"repeat":3}' /tmp/sfx/dry
    python3 .claude/skills/game-sfx/scripts/sfxstats.py /tmp/sfx/dry [--json out.json]

Columns (averaged over the repeats of each sound):
  lufsM   max momentary loudness (ITU-R BS.1770, K-weighted, 400 ms): how loud it feels. This is
          the number the mix table targets.
  punch   max K-weighted level over 50 ms: the transient's bite (punch - lufsM > ~8 dB means a
          spiky sound that pokes out of the mix and tires the ear)
  peak    sample peak dBFS
  ms      time the envelope stays within 30 dB of its peak
  cent    spectral centroid, kHz (energy weighted)
  harsh   share of energy in 2-5 kHz, dB (the ear's most sensitive band: above about -6 dB on a
          sound heard many times a minute is fatiguing)
  air     share of energy above 5 kHz, dB (hiss)
  sub     share of energy below 120 Hz, dB (inaudible on laptops, eats headroom)
  flat    spectral flatness 0..1 (0 = pure tone, 1 = white noise): "noisy" sounds sit above ~0.3
  var     spread of lufsM across repeats, dB (0 = machine-gun repetition)
Needs numpy; scipy makes it fast (pip install scipy), without it K-weighting is skipped.
"""
import json
import math
import sys
import wave

import numpy as np

try:
    from scipy.signal import lfilter
except ImportError:  # pragma: no cover
    lfilter = None


def load(prefix):
    w = wave.open(prefix + '.wav')
    sr, n, ch = w.getframerate(), w.getnframes(), w.getnchannels()
    x = np.frombuffer(w.readframes(n), dtype=np.int16).reshape(-1, ch).astype(np.float64) / 32768
    return x, sr


def kweight(x, sr):
    if lfilter is None:
        return x
    f0, G, Q = 1681.974450955533, 3.999843853973347, 0.7071752369554196
    K = math.tan(math.pi * f0 / sr)
    Vh, Vb = 10 ** (G / 20), (10 ** (G / 20)) ** 0.4996667741545416
    a0 = 1 + K / Q + K * K
    b1 = [(Vh + Vb * K / Q + K * K) / a0, 2 * (K * K - Vh) / a0, (Vh - Vb * K / Q + K * K) / a0]
    a1 = [1, 2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0]
    f0, Q = 38.13547087602444, 0.5003270373238773
    K = math.tan(math.pi * f0 / sr)
    d = 1 + K / Q + K * K
    b2 = [1, -2, 1]
    a2 = [1, 2 * (K * K - 1) / d, (1 - K / Q + K * K) / d]
    return lfilter(b2, a2, lfilter(b1, a1, x, axis=0), axis=0)


def win_max(ms, n):
    if len(ms) < n:
        n = max(1, len(ms))
    c = np.concatenate([[0], np.cumsum(ms)])
    return float(((c[n:] - c[:-n]) / n).max())


def stats(seg, sr):
    y = kweight(seg, sr)
    ms = (y ** 2).sum(axis=1)
    lufs_m = -0.691 + 10 * math.log10(win_max(ms, int(0.4 * sr)) + 1e-12)
    punch = -0.691 + 10 * math.log10(win_max(ms, int(0.05 * sr)) + 1e-12)
    m = seg.mean(axis=1)
    peak = 20 * math.log10(np.abs(seg).max() + 1e-12)
    env = np.sqrt(np.convolve(m * m, np.ones(240) / 240, mode='same'))
    above = np.where(env > env.max() * 10 ** (-30 / 20))[0]
    dur_ms = (above[-1] - above[0]) / sr * 1000 if len(above) else 0
    # segments start and end in silence, so no window: a taper would hide the transient
    sp = np.abs(np.fft.rfft(m)) ** 2 + 1e-18
    f = np.fft.rfftfreq(len(m), 1 / sr)
    tot = sp.sum()
    share = lambda lo, hi: 10 * math.log10(sp[(f >= lo) & (f < hi)].sum() / tot + 1e-12)
    cent = float((sp * f).sum() / tot) / 1000
    fl = []
    n = 1024
    for i in range(0, len(m) - n, n // 2):
        fr = m[i:i + n]
        if np.sqrt((fr ** 2).mean()) < env.max() * 10 ** (-35 / 20):
            continue
        s = np.abs(np.fft.rfft(fr * np.hanning(n))) ** 2 + 1e-18
        s = s[1:]
        fl.append(math.exp(np.log(s).mean()) / s.mean())
    return dict(lufsM=lufs_m, punch=punch, peak=peak, ms=dur_ms, cent=cent, harsh=share(2000, 5000), air=share(5000, 20000), sub=share(20, 120), flat=float(np.median(fl)) if fl else 0.0)


def main():
    prefix = sys.argv[1]
    out_json = sys.argv[sys.argv.index('--json') + 1] if '--json' in sys.argv else None
    x, sr = load(prefix)
    marks = json.load(open(prefix + '.json'))['info']
    per = {}
    for name, t0, t1 in marks:
        seg = x[max(0, int((t0 - 0.05) * sr)):int(t1 * sr)]
        per.setdefault(name, []).append(stats(seg, sr))
    rows = []
    for name, lst in per.items():
        avg = {k: float(np.mean([s[k] for s in lst])) for k in lst[0]}
        avg['var'] = float(np.std([s['lufsM'] for s in lst]))
        avg['name'] = name
        rows.append(avg)
    rows.sort(key=lambda r: -r['lufsM'])
    print(f"{'sound':22s} {'lufsM':>6s} {'punch':>6s} {'peak':>6s} {'ms':>5s} {'cent':>5s} {'harsh':>6s} {'air':>6s} {'sub':>6s} {'flat':>5s} {'var':>4s}")
    for r in rows:
        print(f"{r['name']:22s} {r['lufsM']:6.1f} {r['punch']:6.1f} {r['peak']:6.1f} {r['ms']:5.0f} {r['cent']:5.2f} {r['harsh']:6.1f} {r['air']:6.1f} {r['sub']:6.1f} {r['flat']:5.2f} {r['var']:4.1f}")
    if out_json:
        json.dump({r['name']: {k: round(v, 2) for k, v in r.items() if k != 'name'} for r in rows}, open(out_json, 'w'), indent=1)


if __name__ == '__main__':
    main()
