# Fase 24: analisis talent untuk video bicara. Membaca video mentah (TIDAK diubah, aturan 1) dan menghasilkan:
#  1) talent.webm: video yang sama dengan latar transparan (VP9 + alpha) -> teks bisa diletakkan DI BELAKANG talent;
#  2) faces.json: kotak wajah terbesar per sampel waktu (pecahan lebar/tinggi frame sumber) -> blur wajah / teks di depan wajah.
# Model: RobustVideoMatting mobilenetv3 (ONNX, CPU) dan YuNet (OpenCV). Waktu frame keluaran = waktu frame sumber (CFR).
# Pakai: python talent.py <ffmpeg> <input> <out.webm> <faces.json> <dir_model> <fps> <lebar> <tinggi> <durasi_dtk> <lebar_inferensi> <crf>
# Progres ke stdout: "P <0..1>".
import json
import subprocess
import sys

import cv2
import numpy as np
import onnxruntime as ort


def main() -> None:
    ffmpeg, src, out_webm, out_faces, model_dir, fps_s, w_s, h_s, dur_s, infer_w_s, crf_s = sys.argv[1:12]
    fps = float(fps_s)
    w, h = int(w_s), int(h_s)
    total = float(dur_s) * fps
    infer_w = int(infer_w_s)
    # Ukuran tampil (sesudah rotasi metadata ponsel) dari data aset; scale memastikan ukuran byte per frame tepat
    dec = subprocess.Popen([ffmpeg, "-v", "error", "-i", src, "-map", "0:v:0", "-vf", f"fps={fps},scale={w}:{h}", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
                           stdout=subprocess.PIPE)

    sess = ort.InferenceSession(f"{model_dir}/rvm_mobilenetv3_fp32.onnx", providers=["CPUExecutionProvider"])
    rec = [np.zeros([1, 1, 1, 1], dtype=np.float32)] * 4
    face = None
    enc = None
    faces = []
    every = max(1, round(fps / 5))  # wajah: 5 sampel per detik
    i = 0
    frame_bytes = w * h * 3
    while True:
        buf = dec.stdout.read(frame_bytes)
        if len(buf) < frame_bytes:
            break
        frame = np.frombuffer(buf, dtype=np.uint8).reshape(h, w, 3)
        if enc is None:
            enc = subprocess.Popen([ffmpeg, "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgba", "-s", f"{w}x{h}", "-r", str(fps), "-i", "-",
                                    "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-b:v", "0", "-crf", crf_s, "-deadline", "realtime", "-cpu-used", "8",
                                    "-row-mt", "1", "-auto-alt-ref", "0", "-an", out_webm], stdin=subprocess.PIPE)
            ih = int(round(h * infer_w / w / 2) * 2)
            face = cv2.FaceDetectorYN.create(f"{model_dir}/face_detection_yunet_2023mar.onnx", "", (320, int(round(320 * h / w))), 0.7, 0.3, 5000)
        small = cv2.resize(frame, (infer_w, ih), interpolation=cv2.INTER_AREA)
        x = (small.astype(np.float32) / 255.0).transpose(2, 0, 1)[None]
        fgr, pha, *rec = sess.run(None, {"src": x, "r1i": rec[0], "r2i": rec[1], "r3i": rec[2], "r4i": rec[3], "downsample_ratio": np.array([0.5], dtype=np.float32)})
        alpha = cv2.resize(pha[0, 0], (w, h), interpolation=cv2.INTER_LINEAR)
        alpha = (np.clip(alpha, 0, 1) * 255).astype(np.uint8)
        enc.stdin.write(np.dstack([frame, alpha]).tobytes())
        if i % every == 0:
            fw, fh = 320, int(round(320 * h / w))
            f_small = cv2.cvtColor(cv2.resize(frame, (fw, fh), interpolation=cv2.INTER_AREA), cv2.COLOR_RGB2BGR)
            _, det = face.detect(f_small)
            if det is not None and len(det):
                b = max(det, key=lambda d: d[2] * d[3])
                faces.append([round(i / fps, 3), round(float(b[0]) / fw, 4), round(float(b[1]) / fh, 4), round(float(b[2]) / fw, 4), round(float(b[3]) / fh, 4), round(float(b[14]), 3)])
            else:
                faces.append([round(i / fps, 3), None, None, None, None, 0])
        i += 1
        if total and i % 15 == 0:
            print(f"P {min(0.99, i / total):.3f}", flush=True)
    dec.wait()
    if enc is None:
        raise SystemExit("Tidak ada frame yang terbaca.")
    enc.stdin.close()
    if enc.wait() != 0:
        raise SystemExit("Encode talent.webm gagal.")
    with open(out_faces, "w", encoding="utf-8") as f:
        json.dump({"version": 1, "fps": fps, "width": w, "height": h, "frames": i, "every": every,
                   "samples": faces}, f)
    print(f"OK {i} frame", flush=True)


if __name__ == "__main__":
    main()
