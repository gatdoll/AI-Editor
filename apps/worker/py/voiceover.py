"""Teks -> suara kloning dengan VoxCPM2 (github.com/OpenBMB/VoxCPM). Dipanggil worker (Fase 17).

Pakai: python voiceover.py <permintaan.json>
Permintaan: {chunks: [{text, control, gapS}], referenceWav, referenceText, out, modelDir, seed}. Tiap potongan dibuat terpisah lalu
digabung dengan jedanya. Potongan berarahan memakai "controllable cloning": rekaman hanya acuan warna suara, emosi dan tempo dari
`control`. Tanpa arahan memakai "ultimate cloning": rekaman + transkrip, gaya bicara ikut rekaman.
Tanpa akses jaringan. Mencetak satu baris JSON per kemajuan ke stdout; baris terakhir berisi ringkasan.
"""
import json
import sys
import time

import numpy as np
import soundfile as sf
import torch
from voxcpm import VoxCPM


def say(**kw: object) -> None:
    print(json.dumps(kw), flush=True)


def main() -> None:
    with open(sys.argv[1], encoding="utf-8") as f:
        req = json.load(f)
    t0 = time.time()
    say(stage="memuat")
    model = VoxCPM.from_pretrained(req["modelDir"], load_denoiser=False)
    rate = int(model.tts_model.sample_rate)
    parts = []
    chunks = req["chunks"]
    for i, chunk in enumerate(chunks):
        say(chunk=i, total=len(chunks))
        # voxcpm 2.0.3 tidak menerima argumen seed: acakannya mengikuti generator PyTorch
        torch.manual_seed(int(req["seed"]))
        if chunk.get("control"):
            # Kontrol tidak bisa digabung dengan prompt_text: CLI voxcpm melarangnya, model melanjutkan gaya rekaman
            wav = model.generate(text=f"({chunk['control']}){chunk['text']}", reference_wav_path=req["referenceWav"])
        else:
            wav = model.generate(text=chunk["text"], prompt_wav_path=req["referenceWav"], prompt_text=req["referenceText"], reference_wav_path=req["referenceWav"])
        parts.append(np.asarray(wav, dtype=np.float32).squeeze())
        if i < len(chunks) - 1:
            parts.append(np.zeros(int(rate * float(chunk["gapS"])), dtype=np.float32))
    audio = np.clip(np.nan_to_num(np.concatenate(parts)), -1, 1)
    sf.write(req["out"], audio, rate, subtype="PCM_16")
    say(durationS=round(len(audio) / rate, 3), sampleRate=rate, seconds=round(time.time() - t0, 1))


if __name__ == "__main__":
    main()
