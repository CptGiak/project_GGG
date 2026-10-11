#!/usr/bin/env python3
"""
Measures a render from render.mjs: per-sound loudness and brightness (when the JSON next to the
WAV carries sfxSheet marks) and the spectral balance of the whole file.

    python3 .claude/skills/game-sfx/scripts/analyze.py <prefix>          # reads <prefix>.wav/.json

Reading the numbers:
  * rms dB per sound: keep the hierarchy (big impacts/ults ~ -15..-20, hits ~ -20, movement
    ~ -28..-35, UI/confirms ~ -35..-42 in a sheet rendered at volume 1). A sound 10 dB under its
    neighbours vanishes under the score.
  * centroid kHz: > 8 kHz on a sustained hiss is harsh and fatiguing; use pink or band-limited
    noise. A body hit with a centroid < 1 kHz has no transient and will sound dull.
  * band balance (share of energy): a full mix wants most energy in 60-250 Hz and a gentle
    slope above; more than about -8 dB below 60 Hz is boom that small speakers cannot play.
"""
import json
import sys
import wave

import numpy as np


def load(prefix):
    w = wave.open(prefix + '.wav')
    sr, n, ch = w.getframerate(), w.getnframes(), w.getnchannels()
    x = np.frombuffer(w.readframes(n), dtype=np.int16).reshape(-1, ch).astype(np.float32) / 32768
    return x, sr


def centroid(m, sr):
    sp = np.abs(np.fft.rfft(m))
    f = np.fft.rfftfreq(len(m), 1 / sr)
    return float((sp * f).sum() / (sp.sum() + 1e-9))


def main():
    prefix = sys.argv[1]
    x, sr = load(prefix)
    try:
        info = json.load(open(prefix + '.json')).get('info')
    except (OSError, ValueError):
        info = None
    if isinstance(info, list) and info and isinstance(info[0], list):
        print(f"{'sound':14s} {'peak':>6s} {'rms':>6s} {'centroid':>9s}")
        for i, (name, t) in enumerate(info):
            t1 = info[i + 1][1] if i + 1 < len(info) else len(x) / sr
            seg = x[int(t * sr):int(t1 * sr)]
            if not len(seg):
                continue
            pk = np.abs(seg).max()
            rms = np.sqrt((seg ** 2).mean() + 1e-12)
            print(f"{name:14s} {20*np.log10(pk+1e-9):6.1f} {20*np.log10(rms):6.1f} {centroid(seg.mean(1), sr)/1000:8.1f}k")
    m = x.mean(1)
    N = 8192
    ps = np.zeros(N // 2 + 1)
    for i in range(0, len(m) - N, N):
        ps += np.abs(np.fft.rfft(m[i:i + N] * np.hanning(N))) ** 2
    f = np.fft.rfftfreq(N, 1 / sr)
    tot = ps[(f > 20) & (f < 16000)].sum() + 1e-12
    bands = [(20, 60), (60, 150), (150, 400), (400, 1000), (1000, 2500), (2500, 6000), (6000, 16000)]
    print('balance  ' + '  '.join(f"{a}-{b}Hz {10*np.log10(ps[(f>=a)&(f<b)].sum()/tot):5.1f}dB" for a, b in bands))
    pk = np.abs(x).max()
    print(f"file     peak {20*np.log10(pk+1e-9):.1f} dBFS  rms {20*np.log10(np.sqrt((x**2).mean())+1e-12):.1f} dBFS")


if __name__ == '__main__':
    main()
