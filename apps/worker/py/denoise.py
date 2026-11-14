"""Reduksi noise satu file WAV dengan noisereduce (github.com/timsainb/noisereduce). Dipanggil worker (Fase 11).

Pakai: python denoise.py <masuk.wav> <keluar.wav> <kekuatan 0..1> <stasioner 0|1> <chunk_size>
Hanya membaca file masukan dan menulis file keluaran; tidak ada akses jaringan.
Mencetak satu baris JSON ringkasan ke stdout.
"""
import json
import sys
import time

import numpy as np
import noisereduce as nr
from scipy.io import wavfile


def main() -> None:
    src, dst, strength, stationary, chunk = sys.argv[1], sys.argv[2], float(sys.argv[3]), sys.argv[4] == "1", int(sys.argv[5])
    if not 0 < strength <= 1:
        raise SystemExit("kekuatan harus 0 < k <= 1")
    t0 = time.time()
    rate, raw = wavfile.read(src)
    # Bilangan bulat (16/24/32-bit; scipy menyimpan 24-bit di int32) -> float -1..1
    data = raw.astype(np.float32) / float(np.iinfo(raw.dtype).max + 1) if np.issubdtype(raw.dtype, np.integer) else raw.astype(np.float32)
    # noisereduce menerima (kanal, sampel)
    y = data.T if data.ndim > 1 else data
    out = nr.reduce_noise(y=y, sr=rate, prop_decrease=strength, stationary=stationary, chunk_size=chunk, n_jobs=1, use_tqdm=False)
    out = np.nan_to_num(out).astype(np.float32)
    # noisereduce ikut menurunkan level bicara (terukur ~6 dB pada video uji). Kembalikan level bicara ke aslinya:
    # bandingkan RMS frame-frame keras (persentil 90), penguatan dibatasi 4x dan tidak boleh membuat clipping.
    def loud(x: np.ndarray) -> float:
        m = x if x.ndim == 1 else x.mean(axis=0)
        n = len(m) // 1024
        if n < 4:
            return 0.0
        return float(np.percentile(np.sqrt((m[: n * 1024].reshape(n, 1024) ** 2).mean(axis=1)), 90))
    before, after = loud(y), loud(out)
    gain = 1.0
    if before > 0 and after > 0:
        gain = min(4.0, max(1.0, before / after))
        peak = float(np.abs(out).max())
        if peak > 0:
            gain = min(gain, max(1.0, 0.98 / peak))
    out = np.clip(out * gain, -1.0, 1.0)
    # 16-bit: dibaca ffmpeg bawaan Remotion tanpa masalah dan cukup untuk suara (lalu dikodekan ke AAC)
    pcm = (out * 32767.0).astype(np.int16)
    wavfile.write(dst, rate, pcm.T if pcm.ndim > 1 else pcm)
    print(json.dumps({"rate": rate, "channels": 1 if data.ndim == 1 else int(data.shape[1]), "seconds": round(len(data) / rate, 2), "gain": round(float(gain), 3), "elapsed": round(time.time() - t0, 2)}))


if __name__ == "__main__":
    main()
