"""SFX buatan sendiri (Fase 14): whoosh, swoosh, riser, downlifter, sub-drop. Sintesis noise/sinus + filter + envelope.
Deterministik (seed tetap), tanpa bahan pihak ketiga, jadi bebas lisensi. Menulis WAV mono 48 kHz 16-bit ke folder tujuan.

Pakai: python sfx-synth.py <folder-tujuan>
"""
import sys
from pathlib import Path

import numpy as np
from scipy.io import wavfile
from scipy.signal import butter, sosfilt

SR = 48000
rng = np.random.default_rng(1405)


def env(n: int, attack: float, peak: float) -> np.ndarray:
    """Envelope naik-turun halus: puncak di `peak` (0..1), lengkung sinus."""
    t = np.linspace(0, 1, n)
    up = np.clip(t / max(peak, 1e-3), 0, 1)
    down = np.clip((1 - t) / max(1 - peak, 1e-3), 0, 1)
    return (np.sin(np.minimum(up, down) * np.pi / 2) ** attack)


def sweep_noise(dur: float, f0: float, f1: float, q: float = 0.7, peak: float = 0.55, attack: float = 1.4) -> np.ndarray:
    """Noise yang dilewatkan band-pass dengan frekuensi tengah bergeser f0 -> f1 (efek angin lewat)."""
    n = int(dur * SR)
    noise = rng.standard_normal(n)
    out = np.zeros(n)
    block = 512
    for i in range(0, n, block):
        frac = i / n
        fc = f0 * (f1 / f0) ** frac
        lo, hi = max(40, fc / (1 + q)), min(SR / 2 - 100, fc * (1 + q))
        sos = butter(2, [lo, hi], btype="band", fs=SR, output="sos")
        seg = noise[max(0, i - 2048): i + block]
        out[i: i + block] = sosfilt(sos, seg)[-min(block, n - i):]
    return out * env(n, attack, peak)


def sine_sweep(dur: float, f0: float, f1: float, peak: float, attack: float = 1.0) -> np.ndarray:
    n = int(dur * SR)
    f = f0 * (f1 / f0) ** np.linspace(0, 1, n)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * env(n, attack, peak)


def norm(x: np.ndarray, level: float = 0.8) -> np.ndarray:
    return (x / (np.abs(x).max() + 1e-9) * level).astype(np.float32)


def main() -> None:
    out = Path(sys.argv[1])
    out.mkdir(parents=True, exist_ok=True)
    sounds = {
        "whoosh-cepat": sweep_noise(0.45, 400, 3500, peak=0.5),
        "whoosh": sweep_noise(0.9, 250, 2800, peak=0.55),
        "swoosh-tinggi": sweep_noise(0.55, 1500, 7000, q=0.5, peak=0.45),
        "whoosh-turun": sweep_noise(0.8, 3000, 300, peak=0.4),
        # riser: noise naik + sinus naik, berakhir tajam (menuju momen penting)
        "riser": norm(sweep_noise(2.2, 200, 6000, peak=0.97, attack=0.6)) + 0.35 * sine_sweep(2.2, 180, 900, peak=0.97, attack=0.6),
        "downlifter": norm(sweep_noise(1.6, 5000, 200, peak=0.05, attack=0.8)) + 0.3 * sine_sweep(1.6, 600, 80, peak=0.05),
        # sub-drop: dentuman rendah untuk penegasan / zoom tiba-tiba
        "sub-drop": sine_sweep(1.1, 110, 38, peak=0.03, attack=0.5),
    }
    for name, x in sounds.items():
        wavfile.write(out / f"{name}.wav", SR, (norm(x) * 32767).astype(np.int16))
        print(name)


if __name__ == "__main__":
    main()
