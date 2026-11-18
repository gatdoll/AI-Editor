# Fase 27: rig Prof. AI (karakter tetap) dari set gambar transparan di MEDIA_DIR/karakter/prof-ai/. Hanya membaca (aturan 1).
# Tiap tampak: kotak badan, garis leher, potongan + titik putar bahu (lengan terentang), pinggul + pemisah kaki.
# Tampak depan: kotak wajah dari selisih piksel dengan varian wajah (varian WAJIB sejajar piksel; tidak sejajar = ditolak).
# Nilai di `manual` (character.json lama) menimpa hasil deteksi: titik yang dikoreksi manusia tidak ditebak ulang (aturan 7).
# Keluaran: character.json + check.png (lembar periksa). Pakai: python prof_ai_rig.py <folder>
import json, os, sys
import cv2
import numpy as np

TPOSE = {"front": "front-tpose.png", "threequarter": "threequarter-tpose.png", "back": "back-tpose.png"}
SIDE = {"side": "side-arms-down.png"}
FACES = ["front-blink", "mouth-closed", "mouth-small", "mouth-wide", "mouth-o", "expr-happy", "expr-surprised", "expr-thinking", "expr-serious"]


def alpha(path):
    img = cv2.imread(path, cv2.IMREAD_UNCHANGED)
    if img is None or img.ndim != 3 or img.shape[2] != 4:
        raise SystemExit(f"{os.path.basename(path)}: harus PNG dengan alfa")
    a = img[:, :, 3] > 128
    if a.mean() > 0.6:
        raise SystemExit(f"{os.path.basename(path)}: latar tidak transparan")
    return img, a


def extent(a, y):
    xs = np.nonzero(a[y])[0]
    return (int(xs[0]), int(xs[-1])) if len(xs) else None


def segments(a, y):
    xs = np.nonzero(a[y])[0]
    if not len(xs):
        return []
    out, s, p = [], xs[0], xs[0]
    for x in xs[1:]:
        if x != p + 1:
            out.append((int(s), int(p)))
            s = x
        p = x
    out.append((int(s), int(p)))
    return [g for g in out if g[1] - g[0] > 6]


def box_of(a):
    ys, xs = np.nonzero(a)
    return {"x": int(xs.min()), "y": int(ys.min()), "w": int(xs.max() - xs.min() + 1), "h": int(ys.max() - ys.min() + 1)}


def legs_of(a, box, notes, name):
    """Pinggul = baris teratas (setengah bawah) yang terbelah dua dan tetap terbelah sampai sepatu."""
    top, bot = box["y"], box["y"] + box["h"]
    split_rows = [y for y in range(top + box["h"] // 2, bot - 4) if len(segments(a, y)) >= 2]
    if not split_rows:
        notes.append(f"{name}: kaki menyatu, tidak dipisah")
        return None
    # Ambil blok terbelah terpanjang yang bersambung
    best, run = (0, 0), [split_rows[0], split_rows[0]]
    for y in split_rows[1:]:
        if y == run[1] + 1:
            run[1] = y
        else:
            best = max(best, tuple(run), key=lambda r: r[1] - r[0])
            run = [y, y]
    best = max(best, tuple(run), key=lambda r: r[1] - r[0])
    if best[1] - best[0] < box["h"] * 0.08:
        notes.append(f"{name}: celah kaki terlalu pendek, kaki tidak dipisah")
        return None
    hip = best[0]
    segs = segments(a, hip + 6)
    split = (segs[0][1] + segs[1][0]) // 2
    return {"hip": int(hip), "split": int(split)}


def tpose_view(path, name, notes):
    img, a = alpha(path)
    h, w = a.shape
    box = box_of(a)
    legs = legs_of(a, box, notes, name)
    hip = legs["hip"] if legs else box["y"] + box["h"]
    # Pita lengan: baris yang jauh lebih lebar dari badan di bawahnya
    # Pita lengan: baris selebar rentang tangan (rambut dan badan jauh lebih sempit)
    widths = {y: (lambda e: e[1] - e[0] if e else 0)(extent(a, y)) for y in range(box["y"], hip)}
    # Rambut lebar (tampak 3/4) tidak tersambung dengan pita ini: mulai dari baris terlebar, melebar ke atas/bawah.
    w_max = max(widths.values())
    y_max = max(widths, key=lambda y: widths[y])
    a_top = a_bot = y_max
    while a_top - 1 in widths and widths[a_top - 1] > w_max * 0.72:
        a_top -= 1
    while a_bot + 1 in widths and widths[a_bot + 1] > w_max * 0.72:
        a_bot += 1
    # Tepi badan tepat di bawah ketiak = garis potong lengan (baris pertama yang sudah selebar badan)
    y_body = next((y for y in range(a_bot, hip) if widths.get(y, 0) < w_max * 0.4), None)
    if y_body is None:
        raise SystemExit(f"{name}: ketiak tidak ditemukan")
    below = [extent(a, y) for y in range(y_body + 2, y_body + 16)]
    cut_l = int(np.median([e[0] for e in below if e]))
    cut_r = int(np.median([e[1] for e in below if e]))
    # Tebal lengan di dekat bahu (untuk titik putar dan tutup sambungan)
    def thickness(x0, x1):
        cols = [np.nonzero(a[a_top - 30:a_bot + 30, x])[0] for x in range(x0, x1)]
        cols = [c for c in cols if len(c)]
        t = [int(c.min()) + a_top - 30 for c in cols]
        b = [int(c.max()) + a_top - 30 for c in cols]
        return int(np.median(t)), int(np.median(b))
    lt, lb = thickness(cut_l - 50, cut_l - 20)
    rt, rb = thickness(cut_r + 20, cut_r + 50)
    tip_l = extent(a, (lt + lb) // 2)[0]
    tip_r = extent(a, (rt + rb) // 2)[1]
    arms = {
        "left": {"cut": cut_l, "top": lt, "bottom": lb, "pivot": {"x": cut_l, "y": (lt + lb) // 2}, "tip": int(tip_l)},
        "right": {"cut": cut_r, "top": rt, "bottom": rb, "pivot": {"x": cut_r, "y": (rt + rb) // 2}, "tip": int(tip_r)},
    }
    neck = neck_of(a, box, min(lt, rt), name)
    if legs:
        # Ujung bawah jas: baris terakhir yang masih jauh lebih lebar dari celana di atas selangkangan
        w_hip = widths.get(legs["hip"] - 2, 0)
        hem = next((y for y in range(legs["hip"] - 2, a_bot, -1) if widths.get(y, 0) > w_hip + 30), legs["hip"] - 30) + 1
        segs = segments(a, legs["hip"] + 30)
        bottom = box["y"] + box["h"]
        legs.update({"hem": int(hem), "jointL": int((segs[0][0] + segs[0][1]) // 2), "jointR": int((segs[-1][0] + segs[-1][1]) // 2),
                     "ankle": int(bottom - box["h"] * 0.075)})
    return {"file": os.path.basename(path), "width": w, "height": h, "box": box, "neck": neck, "arms": arms, "legs": legs, "band": {"top": int(a_top), "bottom": int(a_bot)}}


def neck_of(a, box, limit, name):
    """Leher = baris tersempit antara pertengahan kepala dan bahu."""
    y0 = box["y"] + int((limit - box["y"]) * 0.6)
    rows = [(extent(a, y), y) for y in range(y0, limit - 4)]
    rows = [(e[1] - e[0], y, e) for e, y in rows if e]
    if not rows:
        raise SystemExit(f"{name}: leher tidak ditemukan")
    wd, y, e = min(rows)
    return {"y": int(y), "l": int(e[0]), "r": int(e[1]), "cx": int((e[0] + e[1]) // 2)}


def side_view(path, name, notes):
    img, a = alpha(path)
    h, w = a.shape
    box = box_of(a)
    neck = neck_of(a, box, box["y"] + int(box["h"] * 0.47), name)
    notes.append(f"{name}: lengan dan kaki menumpuk badan, tidak dipisah (jalan = badan memantul)")
    return {"file": os.path.basename(path), "width": w, "height": h, "box": box, "neck": neck, "arms": None, "legs": None}


def faces(folder, base_img, notes):
    base = base_img.astype(np.int16)
    boxes, out = [], {}
    for f in FACES:
        p = os.path.join(folder, f + ".png")
        if not os.path.exists(p):
            notes.append(f"wajah {f}: berkas tidak ada")
            continue
        img = cv2.imread(p, cv2.IMREAD_UNCHANGED)
        if img is None or img.shape != base_img.shape:
            raise SystemExit(f"{f}.png: ukuran berbeda dengan front-tpose.png")
        d = np.abs(img.astype(np.int16) - base).max(2) > 40
        ys, xs = np.nonzero(d)
        if not len(ys):
            notes.append(f"wajah {f}: sama persis dengan tampak depan")
            continue
        b = (int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max()))
        if (b[2] - b[0]) * (b[3] - b[1]) > base.shape[0] * base.shape[1] * 0.12:
            raise SystemExit(f"{f}.png: tidak sejajar dengan front-tpose.png (beda di luar wajah)")
        boxes.append(b)
        out[f] = f + ".png"
    if not boxes:
        return None
    pad = 8
    x0 = min(b[0] for b in boxes) - pad
    y0 = min(b[1] for b in boxes) - pad
    x1 = max(b[2] for b in boxes) + pad
    y1 = max(b[3] for b in boxes) + pad
    # Garis bagi mata/mulut: di atas mulut terbuka paling tinggi
    mouth_top = min((b[1] for f, b in zip(out, boxes) if f.startswith("mouth")), default=None)
    split = (mouth_top - 6) if mouth_top else None
    return {"box": {"x": x0, "y": y0, "w": x1 - x0, "h": y1 - y0}, "split": split, "files": out}


def check_sheet(folder, rig, path):
    tiles = []
    for name, v in rig["views"].items():
        img = cv2.imread(os.path.join(folder, v["file"]), cv2.IMREAD_UNCHANGED)
        al = img[:, :, 3:] / 255.0
        c = (img[:, :, :3] * al + np.full(img[:, :, :3].shape, (90, 160, 90), float) * (1 - al)).astype(np.uint8)
        n = v["neck"]
        cv2.line(c, (n["l"] - 40, n["y"]), (n["r"] + 40, n["y"]), (0, 0, 255), 3)
        if v.get("arms"):
            for s in ("left", "right"):
                ar = v["arms"][s]
                cv2.rectangle(c, (min(ar["cut"], ar["tip"]), ar["top"]), (max(ar["cut"], ar["tip"]), ar["bottom"]), (255, 0, 0), 2)
                cv2.circle(c, (ar["pivot"]["x"], ar["pivot"]["y"]), 9, (0, 255, 255), -1)
        if v.get("legs"):
            L = v["legs"]
            cv2.line(c, (v["box"]["x"], L["hip"]), (v["box"]["x"] + v["box"]["w"], L["hip"]), (255, 0, 255), 3)
            cv2.line(c, (L["split"], L["hip"]), (L["split"], v["box"]["y"] + v["box"]["h"]), (255, 0, 255), 2)
        if name == "front" and rig.get("face"):
            fb = rig["face"]["box"]
            cv2.rectangle(c, (fb["x"], fb["y"]), (fb["x"] + fb["w"], fb["y"] + fb["h"]), (0, 200, 255), 2)
            if rig["face"]["split"]:
                cv2.line(c, (fb["x"], rig["face"]["split"]), (fb["x"] + fb["w"], rig["face"]["split"]), (0, 200, 255), 1)
        cv2.putText(c, name, (20, 50), 0, 1.4, (0, 0, 0), 3)
        tiles.append(cv2.resize(c, (543, 543)))
    cv2.imwrite(path, np.hstack(tiles))


def merge(auto, manual):
    """Nilai `manual` menimpa hasil deteksi (dalam, per kunci)."""
    if isinstance(auto, dict) and isinstance(manual, dict):
        out = dict(auto)
        for k, v in manual.items():
            out[k] = merge(auto.get(k), v)
        return out
    return manual


def main():
    folder = sys.argv[1]
    notes = []
    views = {}
    for name, f in TPOSE.items():
        p = os.path.join(folder, f)
        if os.path.exists(p):
            views[name] = tpose_view(p, name, notes)
        elif name == "front":
            raise SystemExit("front-tpose.png wajib ada")
    for name, f in SIDE.items():
        p = os.path.join(folder, f)
        if os.path.exists(p):
            views[name] = side_view(p, name, notes)
    base_img, _ = alpha(os.path.join(folder, TPOSE["front"]))
    rig = {"version": 1, "name": "Prof. AI", "views": views, "face": faces(folder, base_img, notes), "notes": notes}
    out = os.path.join(folder, "character.json")
    manual = {}
    if os.path.exists(out):
        with open(out, encoding="utf-8") as fh:
            manual = json.load(fh).get("manual") or {}
    final = merge(rig, manual)
    final["manual"] = manual
    with open(out, "w", encoding="utf-8") as fh:
        json.dump(final, fh, indent=1)
    check_sheet(folder, final, os.path.join(folder, "check.png"))
    print(json.dumps({"ok": True, "views": list(views), "notes": notes}))


if __name__ == "__main__":
    main()
