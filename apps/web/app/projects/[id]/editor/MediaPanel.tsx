"use client";
// Fase 16: panel Media. Semua video project: thumbnail, urutan, tampil/sembunyi di timeline, titik fokus, unggah, hapus.
// Thumbnail bisa diseret ke track Urutan/Video di timeline.
import { useRef, useState } from "react";
import type { AssetRow } from "@app/shared";
import { VIDEO } from "@app/config";
import { REEL_DRAG_TYPE } from "./Timeline";
import { fmtTime } from "./kinds";
import { byName, uploadVideo } from "../../../../lib/upload-video";
import s from "./editor.module.css";

type Video = AssetRow & { label: string };

export function MediaPanel({ projectId, videos, order, hidden, focusBy, primaryId, disabled, onReorder, onToggleHidden, onFocus, onSelect, onChanged, onMessage, videoUrl }: {
  projectId: string;
  videos: Video[];
  /** Urutan tampil penuh (termasuk yang disembunyikan). */
  order: string[];
  hidden: string[];
  focusBy: Record<string, number>;
  primaryId: string | null;
  disabled: boolean;
  onReorder: (ids: string[]) => void;
  onToggleHidden: (id: string) => void;
  onFocus: (id: string, x: number) => void;
  onSelect: (id: string) => void;
  onChanged: () => void;
  onMessage: (m: string) => void;
  videoUrl: (a: Video) => string;
}) {
  const [upload, setUpload] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const ordered = [...order.map((id) => videos.find((v) => v.id === id)).filter((v): v is Video => !!v), ...videos.filter((v) => !order.includes(v.id))];
  const move = (id: string, dir: -1 | 1) => {
    const ids = ordered.filter((v) => order.includes(v.id)).map((v) => v.id);
    const i = ids.indexOf(id), j = i + dir;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    onReorder(ids);
  };
  const add = async (files: FileList) => {
    const list = byName(files);
    try {
      for (let i = 0; i < list.length; i++) {
        await uploadVideo(projectId, list[i], (p) => setUpload(`${list.length > 1 ? `${i + 1}/${list.length} · ` : ""}${list[i].name} ${p}%`));
        onChanged();
      }
      onMessage(list.length > 1 ? `${list.length} video diunggah. Diproses di latar belakang, lalu muncul di akhir timeline.` : "Video diunggah. Diproses di latar belakang, lalu muncul di akhir timeline.");
    } catch (e) {
      onMessage(`${e instanceof Error ? e.message : String(e)} Unggahan bisa dilanjutkan: pilih file yang sama lagi.`);
    } finally { setUpload(null); onChanged(); }
  };
  const remove = async (v: Video) => {
    if (!window.confirm(`Hapus "${v.label}" dari project? File video ini dihapus permanen dari disk. Cut, subtitle, dan judul di video lain tidak berubah.`)) return;
    const r = await fetch(`/api/projects/${projectId}/videos/${v.id}`, { method: "DELETE" });
    const b = await r.json().catch(() => ({}));
    onMessage(r.ok ? `"${v.label}" dihapus.` : b.error ?? `Gagal menghapus (${r.status})`);
    onChanged();
  };
  const reprocess = async (v: Video) => {
    const r = await fetch(`/api/projects/${projectId}/videos/${v.id}`, { method: "POST" });
    const b = await r.json().catch(() => ({}));
    onMessage(r.ok ? `"${v.label}" diproses ulang.` : b.error ?? `Gagal (${r.status})`);
    onChanged();
  };

  let n = 0;
  return (
    <div className={s.tabBody}>
      <p className={`${s.small} ${s.muted}`} style={{ padding: "10px 10px 0", margin: 0 }}>
        Seret video ke track <b>Urutan</b> di timeline, atau seret blok di sana untuk mengubah urutan. Video yang disembunyikan tidak ikut hasil, filenya tetap ada.
      </p>
      <div className={s.mediaGrid}>
        {ordered.map((v) => {
          const ready = Number(v.duration_s) > 0 && (v.reel_offset_s != null || videos.length === 1);
          const isHidden = hidden.includes(v.id);
          const shown = ready && !isHidden ? ++n : null;
          const playable = v.preview_status === "siap" || v.preview_status === "tidak_perlu" || v.preview_status === null || v.preview_status === undefined;
          return (
            <div key={v.id} className={`${s.mediaItem} ${isHidden ? s.mediaHidden : ""}`} draggable={ready && !disabled}
              onDragStart={(e) => { e.dataTransfer.setData(REEL_DRAG_TYPE, v.id); e.dataTransfer.effectAllowed = "move"; }}
              title={`${v.label}${v.width ? ` · ${v.width}×${v.height}` : ""}`}>
              {ready && playable
                ? <video src={`${videoUrl(v)}#t=0.5`} preload="metadata" muted playsInline onClick={() => onSelect(v.id)} />
                : <div className={s.mediaThumb}>{ready ? "Menyiapkan pratinjau…" : "Diproses…"}</div>}
              {shown && <span className={s.mediaBadge}>{shown}</span>}
              <div className={s.mediaMeta}>
                <b>{v.label}</b>
                {ready ? `${fmtTime(Number(v.duration_s))}${v.width ? ` · ${v.width}×${v.height}` : ""}${isHidden ? " · disembunyikan" : ""}` : "Belum selesai diproses"}
              </div>
              <div className={s.mediaActions}>
                {ready && !isHidden && <><button disabled={disabled} onClick={() => move(v.id, -1)} aria-label={`Majukan ${v.label}`}>←</button><button disabled={disabled} onClick={() => move(v.id, 1)} aria-label={`Mundurkan ${v.label}`}>→</button></>}
                {ready && <button disabled={disabled} onClick={() => onToggleHidden(v.id)}>{isHidden ? "Tampilkan" : "Sembunyikan"}</button>}
                {!ready && <button disabled={disabled} onClick={() => void reprocess(v)}>Proses ulang</button>}
                {v.id !== primaryId && <button disabled={disabled} onClick={() => void remove(v)}>Hapus</button>}
              </div>
              {ready && v.width && v.height && v.width / v.height > 1.01 && (
                <label className={`${s.small} ${s.muted}`} style={{ display: "grid", gap: 2, padding: "0 6px 6px" }} title="Bagian video yang dipertahankan saat dipotong ke rasio lebih sempit (mis. 9:16)">
                  Fokus {Math.round((focusBy[v.id] ?? 0.5) * 100)}%
                  <input type="range" min={0} max={1} step={0.01} value={focusBy[v.id] ?? 0.5} disabled={disabled} onChange={(e) => onFocus(v.id, Number(e.target.value))} aria-label={`Titik fokus ${v.label}`} />
                </label>
              )}
            </div>
          );
        })}
        <button className={s.mediaAdd} disabled={!!upload || videos.length >= VIDEO.maxVideos} onClick={() => fileRef.current?.click()}>
          {upload ? <><span className={s.spin} />{upload}</> : <><span style={{ fontSize: 22 }}>＋</span>Tambah video</>}
        </button>
        <input ref={fileRef} type="file" accept="video/*,.mkv" multiple hidden onChange={(e) => { if (e.target.files?.length) void add(e.target.files); e.target.value = ""; }} />
      </div>
    </div>
  );
}
