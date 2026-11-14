# Fase 25: rig karakter 2D dari satu gambar diam (ilustrasi berdiri, latar polos). Hanya membaca file asli (aturan 1).
# Keluaran JSON (stdout): ukuran, kotak karakter, garis leher/pinggul, sumbu tengah, mata, mulut, warna kulit, dan topeng alfa
# (PNG grayscale setengah resolusi, base64) untuk membuang latar. Komposisi memotong gambar asli menjadi kepala/badan/kaki
# dengan clip-path dan menggerakkannya. Bagian yang tidak terdeteksi = null + catatan (aturan 7), bukan ditebak.
# Pakai: python rig.py <gambar> <model_dir>
import base64, json, sys
import cv2
import numpy as np


def background_mask(img):
    """Latar = piksel terang tak berwarna yang tersambung ke tepi gambar (garis luar karakter menutup bagian putih di dalam)."""
    h, w = img.shape[:2]
    if img.shape[2] == 4:
        a = img[:, :, 3]
        if (a < 10).mean() > 0.05:  # sudah transparan
            return a < 128, img[:, :, :3]
        img = img[:, :, :3]
    f = img.astype(np.int16)
    sat = f.max(2) - f.min(2)
    cand = ((f.min(2) > 150) & (sat < 28)).astype(np.uint8)
    n, lab = cv2.connectedComponents(cand, connectivity=4)
    border = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    bg = np.isin(lab, list(border)) & (cand > 0)
    return bg, img


def main():
    path, model_dir = sys.argv[1], sys.argv[2]
    img = cv2.imread(path, cv2.IMREAD_UNCHANGED)
    if img is None:
        raise SystemExit("gambar tidak terbaca")
    if img.ndim == 2:
        img = cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)
    bg, rgb = background_mask(img)
    h, w = bg.shape
    fg = (~bg).astype(np.uint8)
    # Komponen terbesar saja (buang bintik/sisa bayangan terpisah); lubang kecil di dalam diisi
    n, lab, stats, _ = cv2.connectedComponentsWithStats(fg, connectivity=8)
    if n < 2:
        raise SystemExit("karakter tidak ditemukan (latar tidak polos?)")
    big = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    fg = (lab == big).astype(np.uint8)
    notes = []
    cover = fg.mean()
    if cover > 0.85 or cover < 0.03:
        notes.append(f"latar tidak terpisah dengan baik ({cover:.0%} gambar dianggap karakter)")
    # Bayangan lantai (abu-abu lembut, lebar, di bawah sepatu) bukan bagian karakter
    ys, xs = np.nonzero(fg)
    y0, y1, x0, x1 = int(ys.min()), int(ys.max()), int(xs.min()), int(xs.max())
    rows = fg.sum(1)
    H = y1 - y0 + 1

    # Leher: baris tersempit di antara kepala (lebar) dan bahu, di 20-60% tinggi karakter
    a, b = y0 + int(H * 0.2), y0 + int(H * 0.6)
    seg = rows[a:b].astype(float)
    seg = np.convolve(seg, np.ones(9) / 9, mode="same")
    neck = a + int(np.argmin(seg[5:-5])) + 5
    # Kolom leher pada baris itu (rentang terpanjang di dekat tengah)
    cols = np.nonzero(fg[neck])[0]
    cx = int((x0 + x1) / 2)
    if len(cols):
        runs = np.split(cols, np.nonzero(np.diff(cols) > 1)[0] + 1)
        run = min(runs, key=lambda r: abs((r[0] + r[-1]) / 2 - cx))
        neckL, neckR = int(run[0]), int(run[-1])
        cx_neck = (neckL + neckR) // 2
    else:
        neckL, neckR, cx_neck = cx - 20, cx + 20, cx

    # Selangkangan: dari bawah (kaki) naik di sumbu tengah sampai menyentuh karakter; dua kaki = ada celah di bawahnya
    feet_cx = cx
    crotch = None
    for y in range(y1, neck, -1):
        if fg[y, feet_cx]:
            crotch = y
            break
    legs = None
    if crotch is not None and crotch < y1 - H * 0.08:
        legs = {"hip": int(crotch - H * 0.02), "split": int(feet_cx)}
    else:
        notes.append("kaki tidak terpisah (tidak ada celah di antara kaki): gerak jalan memakai seluruh badan")

    # Wajah: YuNet (mata, hidung, sudut mulut). Ilustrasi chibi kadang tidak terdeteksi = mata/mulut null.
    face = None
    try:
        sc = 640 / max(w, h)
        small = cv2.resize(rgb, (int(w * sc), int(h * sc)))
        det = cv2.FaceDetectorYN.create(f"{model_dir}/face_detection_yunet_2023mar.onnx", "", (small.shape[1], small.shape[0]), 0.5, 0.3, 50)
        _, faces = det.detect(small)
        if faces is not None and len(faces):
            f = max(faces, key=lambda r: r[2] * r[3]) / sc
            fx, fy, fw, fh = [float(v) for v in f[:4]]
            if fy + fh / 2 < neck:  # wajah harus di kepala
                face = {"x": fx, "y": fy, "w": fw, "h": fh, "eyeR": [float(f[4]), float(f[5])], "eyeL": [float(f[6]), float(f[7])], "nose": [float(f[8]), float(f[9])], "mouthR": [float(f[10]), float(f[11])], "mouthL": [float(f[12]), float(f[13])], "score": float(f[14] * 1)}
    except Exception as e:  # noqa: BLE001
        notes.append(f"deteksi wajah gagal: {e}")
    if face is None:
        notes.append("wajah tidak terdeteksi: kedip dan gerak mulut dimatikan")

    eyes = mouth = skin = None
    if face:
        ed = abs(face["eyeL"][0] - face["eyeR"][0])
        r = ed * 0.30
        eyes = [{"x": face["eyeR"][0], "y": face["eyeR"][1], "rx": r, "ry": r * 1.1}, {"x": face["eyeL"][0], "y": face["eyeL"][1], "rx": r, "ry": r * 1.1}]
        mx = (face["mouthL"][0] + face["mouthR"][0]) / 2
        my = (face["mouthL"][1] + face["mouthR"][1]) / 2
        ey = (face["eyeL"][1] + face["eyeR"][1]) / 2
        # Mulut harus di bawah mata dan di atas leher (tangan di dagu bisa terbaca sebagai mulut)
        if ey + ed * 0.3 < my < neck - ed * 0.1:
            mouth = {"x": mx, "y": my, "w": max(abs(face["mouthL"][0] - face["mouthR"][0]), ed * 0.35)}
        else:
            notes.append("mulut tidak terdeteksi dengan yakin: gerak mulut dimatikan")
        # Kulit: median piksel pipi (di bawah mata, di samping hidung)
        pts = []
        for ex, ey in (face["eyeR"], face["eyeL"]):
            px, py = int(ex + (face["nose"][0] - ex) * 0.15), int(ey + ed * 0.38)
            patch = rgb[max(0, py - 4):py + 5, max(0, px - 4):px + 5].reshape(-1, 3)
            pts.extend(patch.tolist())
        if pts:
            b_, g_, r_ = np.median(np.array(pts), axis=0)
            skin = "#%02x%02x%02x" % (int(r_), int(g_), int(b_))

    # Topeng alfa setengah resolusi, tepi dihaluskan
    # CSS mask-image membaca kanal ALFA: hitam dengan alfa = karakter
    half = cv2.resize(fg * 255, (w // 2, h // 2), interpolation=cv2.INTER_AREA)
    rgba = np.zeros((half.shape[0], half.shape[1], 4), np.uint8)
    rgba[:, :, 3] = half
    ok, png = cv2.imencode(".png", rgba, [cv2.IMWRITE_PNG_COMPRESSION, 9])
    out = {
        "version": 1, "width": w, "height": h,
        "box": {"x": x0, "y": y0, "w": x1 - x0 + 1, "h": H},
        "neck": {"y": int(neck), "l": neckL, "r": neckR, "cx": cx_neck},
        "legs": legs, "eyes": eyes, "mouth": mouth, "skin": skin,
        "mask": "data:image/png;base64," + base64.b64encode(png.tobytes()).decode(),
        "notes": notes,
    }
    print(json.dumps(out))


main()
