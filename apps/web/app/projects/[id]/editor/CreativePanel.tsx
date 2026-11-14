"use client";
// Mode Kreatif (Fase 9.4): prompt bebas -> Claude Code CLI menulis kode Remotion -> versi 'draft' dengan 4 still.
// Versi baru TIDAK aktif sampai pengguna menekan Aktifkan. Mengaktifkan = mengubah style.creativeId lewat penyimpanan
// gaya editor (ikut undo/redo dan pemeriksaan konflik). Versi tidak pernah dihapus.
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityFeed, type ActivityEntry } from "../../../components/ActivityFeed";
import type { AnalyzersState } from "@app/shared";
import { explainError } from "@app/shared/errors";
import { AI_MODELS, ASPECTS, CREATIVE, END_CLIP, FONT_LIBRARY, MOTION_GFX, type AspectId } from "@app/config";
import { clampEndClipSeconds } from "@app/remotion/src/motion-props.ts";
import { Icon } from "../../../components/Icon";
import { imageSize, useMaterials, type Material } from "../../../../lib/use-materials";
import s from "./editor.module.css";
import { CREATIVE_REFERENCE_NOTE, ReferencePicker } from "./ReferencePicker";
import type { ReferenceInput } from "@app/shared/reference";


type Version = {
  id: string; number: number; prompt: string; model: string; notes: string | null; status: "draft" | "aktif" | "ditolak" | "gagal";
  error: string | null; duration_ms: number | null; replaces_captions: boolean; created_at: string; hasOverlay: boolean; hasVideo: boolean; stillCount: number; stills: string[];
};
type Job = { id: string; status: string; progress: number; error: string | null; stage: string | null; stageLabel: string | null; round: number; baseVersionId: string | null; creativeVersionId: string | null; started_at: string | null; created_at: string; activity?: ActivityEntry[] };
type State = { versions: Version[]; activeId: string | null; job: Job | null };

const STAGES: Array<[string, string]> = [["skill", "Menyiapkan skill"], ["menulis", "AI menulis kode"], ["validasi", "Validasi kode"], ["still", "Render still pratinjau"], ["simpan", "Menyimpan versi"]];
const STATUS_LABEL: Record<Version["status"], string> = { aktif: "Aktif", draft: "Belum dipakai", ditolak: "Ditolak", gagal: "Gagal" };
const EXAMPLES = [
  { label: "Tipografi kinetik", prompt: "Tipografi kinetik gaya konten pendek: 1-3 kata yang sedang diucapkan di tengah bawah dengan scale-pop, kata kunci diberi kotak aksen yang menyapu. Overlay ini menggantikan subtitle bawaan." },
  { label: "Whip di cut", prompt: "Di setiap sambungan cut beri efek whip pan singkat dengan blur. Jangan ubah subtitle." },
  { label: "Judul hook", prompt: "Di 3 detik pertama tampilkan judul hook besar yang masuk dari atas, diambil dari kalimat pertama yang diucapkan." },
];
const stillLabel = (path: string) => path.split("/").pop()?.replace(/-\d+\.png$/, "") ?? "";
const fmtSec = (ms: number | null) => (ms == null ? "" : ms < 60000 ? `${Math.round(ms / 1000)} dtk` : `${Math.floor(ms / 60000)} mnt ${Math.round((ms % 60000) / 1000)} dtk`);

function Err({ raw }: { raw: string }) {
  const e = explainError(raw);
  return (
    <div style={{ marginTop: 6 }}>
      <b className={s.err}>{e.title}</b>
      <div className={s.small}>{e.hint}</div>
      <details className={s.small}><summary className={s.muted} style={{ cursor: "pointer" }}>Detail teknis</summary><pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", margin: "4px 0 0" }}>{raw}</pre></details>
    </div>
  );
}

function CodeView({ projectId, versionId }: { projectId: string; versionId: string }) {
  const [code, setCode] = useState<{ overlay: string | null; video: string | null } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  return (
    <details className={s.small} onToggle={(e) => {
      if (!(e.target as HTMLDetailsElement).open || code) return;
      fetch(`/api/projects/${projectId}/creative/${versionId}/code`).then(async (r) => { const b = await r.json().catch(() => ({})); if (r.ok) setCode(b); else setErr(b.error ?? `HTTP ${r.status}`); }).catch((x) => setErr(String(x)));
    }}>
      <summary className={s.muted} style={{ cursor: "pointer" }}>Lihat kode (baca saja)</summary>
      {err && <div className={s.err}>{err}</div>}
      {!code && !err && <span className={s.muted}><span className={s.spin} /> Memuat…</span>}
      {code?.overlay && <><div className={s.muted}>CreativeOverlay.tsx</div><pre className={s.codeView}>{code.overlay}</pre></>}
      {code?.video && <><div className={s.muted}>CreativeVideo.tsx</div><pre className={s.codeView}>{code.video}</pre></>}
      {code && !code.overlay && !code.video && <div className={s.muted}>Tidak ada kode tersimpan.</div>}
    </details>
  );
}

/**
 * Fase 15: gambar/logo yang dilampirkan ke prompt Kreatif. Tersimpan per project (bahan), jadi ikut ke semua perintah dan revisi.
 * Logo dipakai AI apa adanya (tidak digambar ulang).
 */
function Attachments({ projectId, images, onChanged, disabled, uploadRef }: { projectId: string; images: Material[]; onChanged: () => Promise<void> | void; disabled: boolean; uploadRef: React.MutableRefObject<((files: FileList | File[]) => Promise<void>) | null> }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const upload = async (files: FileList | File[]) => {
    const list = [...files].filter((f) => (MOTION_GFX.materials.image as readonly string[]).includes(f.type));
    if (!list.length) { setMsg("Hanya gambar PNG, JPG, WebP, atau SVG."); return; }
    setBusy(true); setMsg(null);
    try {
      for (const f of list) {
        const form = new FormData();
        form.set("file", f);
        const size = await imageSize(f);
        if (size) { form.set("width", String(size.width)); form.set("height", String(size.height)); }
        const r = await fetch(`/api/projects/${projectId}/materials`, { method: "POST", body: form });
        const b = await r.json().catch(() => ({}));
        if (!r.ok) { setMsg(b.error ?? `Gagal mengunggah ${f.name}`); break; }
      }
      await onChanged();
    } finally { setBusy(false); }
  };
  uploadRef.current = upload;
  const setRole = async (m: Material, role: "logo" | "gambar") => {
    const r = await fetch(`/api/projects/${projectId}/materials/${m.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ role }) });
    if (!r.ok) setMsg((await r.json().catch(() => ({}))).error ?? "Gagal mengubah peran");
    await onChanged();
  };
  const remove = async (m: Material) => {
    const r = await fetch(`/api/projects/${projectId}/materials/${m.id}`, { method: "DELETE" });
    if (!r.ok) setMsg((await r.json().catch(() => ({}))).error ?? "Gagal menghapus");
    await onChanged();
  };
  const jpgLogo = images.some((m) => m.role === "logo" && m.mime === "image/jpeg");
  return (
    <div className={s.attach}>
      {images.map((m) => (
        <figure key={m.id} className={s.attachItem} title={m.label}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/api/assets/${m.id}/file`} alt={m.label} />
          <button className={`${s.attachRole} ${m.role === "logo" ? s.attachLogo : ""}`} disabled={disabled} onClick={() => void setRole(m, m.role === "logo" ? "gambar" : "logo")}
            title={m.role === "logo" ? "Logo: dipakai apa adanya, tidak digambar ulang. Klik untuk jadikan gambar biasa." : "Gambar biasa. Klik untuk tandai sebagai logo."}>{m.role === "logo" ? "Logo" : "Gambar"}</button>
          <button className={s.attachX} disabled={disabled} onClick={() => void remove(m)} aria-label={`Hapus ${m.label}`}>✕</button>
        </figure>
      ))}
      <button className={s.attachAdd} disabled={disabled || busy} onClick={() => fileRef.current?.click()} title="Lampirkan logo atau gambar branding (PNG transparan paling bagus). Bisa juga seret file ke kotak perintah.">
        {busy ? <span className={s.spin} /> : "＋"}<span>{busy ? "Mengunggah" : "Gambar / logo"}</span>
      </button>
      <input ref={fileRef} type="file" accept={MOTION_GFX.materials.image.join(",")} multiple hidden onChange={(e) => { if (e.target.files) void upload(e.target.files); e.target.value = ""; }} />
      {jpgLogo && <div className={`${s.small} ${s.muted}`} style={{ flexBasis: "100%" }}>Logo JPG biasanya berlatar putih dan akan tampil dengan kotak putih. Pakai PNG transparan atau SVG bila ada.</div>}
      {msg && <div className={`${s.small} ${s.err}`} style={{ flexBasis: "100%" }}>{msg}</div>}
    </div>
  );
}

/**
 * Fase 24: font milik pengguna (TTF/OTF/WOFF/WOFF2). Masuk katalog font Mode Kreatif; AI memakainya bila cocok dengan
 * referensi/prompt. Nama keluarga = nama berkas tanpa ekstensi.
 */
function Fonts({ projectId, fonts, onChanged, disabled }: { projectId: string; fonts: Material[]; onChanged: () => Promise<void> | void; disabled: boolean }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const maxMb = Math.round(FONT_LIBRARY.maxUploadBytes / 1048576);
  const upload = async (files: FileList) => {
    const list = [...files];
    const bad = list.find((f) => !/\.(ttf|otf|woff2?)$/i.test(f.name));
    if (bad) { setMsg(`${bad.name} bukan file font (TTF/OTF/WOFF/WOFF2).`); return; }
    const big = list.find((f) => f.size > FONT_LIBRARY.maxUploadBytes);
    if (big) { setMsg(`${big.name} terlalu besar (maks. ${maxMb} MB).`); return; }
    setBusy(true); setMsg(null);
    try {
      for (const f of list) {
        const form = new FormData();
        form.set("file", f);
        const r = await fetch(`/api/projects/${projectId}/materials`, { method: "POST", body: form });
        const b = await r.json().catch(() => ({}));
        if (!r.ok) { setMsg(b.error ?? `Gagal mengunggah ${f.name}`); break; }
      }
      await onChanged();
    } finally { setBusy(false); }
  };
  const remove = async (m: Material) => {
    const r = await fetch(`/api/projects/${projectId}/materials/${m.id}`, { method: "DELETE" });
    if (!r.ok) setMsg((await r.json().catch(() => ({}))).error ?? "Gagal menghapus");
    await onChanged();
  };
  return (
    <div className={s.attach}>
      {fonts.map((m) => (
        <figure key={m.id} className={`${s.attachItem} ${s.attachDoc}`} title={`${m.label}
Font milikmu: AI memakainya bila cocok dengan referensi atau prompt (nama: ${m.label.replace(/\.(ttf|otf|woff2?)$/i, "")}).`}>
          <span><b>Aa</b><span>{m.label.replace(/\.(ttf|otf|woff2?)$/i, "")}</span></span>
          <span className={`${s.attachRole} ${s.attachLogo}`}>Font</span>
          <button className={s.attachX} disabled={disabled} onClick={() => void remove(m)} aria-label={`Hapus ${m.label}`}>✕</button>
        </figure>
      ))}
      <button className={s.attachAdd} disabled={disabled || busy} onClick={() => fileRef.current?.click()} title={`Unggah font milikmu (TTF/OTF/WOFF/WOFF2, maks. ${maxMb} MB) bila font referensi tidak ada di pustaka. AI memakainya dengan nama berkasnya.`}>
        {busy ? <span className={s.spin} /> : "＋"}<span>{busy ? "Mengunggah" : "Font"}</span>
      </button>
      <input ref={fileRef} type="file" accept=".ttf,.otf,.woff,.woff2" multiple hidden onChange={(e) => { if (e.target.files) void upload(e.target.files); e.target.value = ""; }} />
      {msg && <div className={`${s.small} ${s.err}`} style={{ flexBasis: "100%" }}>{msg}</div>}
    </div>
  );
}

/**
 * Design system (PDF) milik project: dibaca AI sebelum menulis kode dan diikuti di semua versi (warna, tipografi,
 * spacing). Tidak tampil di video. Ikut ke semua perintah dan revisi sampai dihapus.
 */
function DesignSystems({ projectId, docs, onChanged, disabled }: { projectId: string; docs: Material[]; onChanged: () => Promise<void> | void; disabled: boolean }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const maxMb = Math.round(MOTION_GFX.knowledge.maxPdfBytes / 1048576);
  const upload = async (files: FileList) => {
    const list = [...files];
    const bad = list.find((f) => f.type !== "application/pdf" && !/\.pdf$/i.test(f.name));
    if (bad) { setMsg(`${bad.name} bukan PDF.`); return; }
    const big = list.find((f) => f.size > MOTION_GFX.knowledge.maxPdfBytes);
    if (big) { setMsg(`${big.name} terlalu besar (maks. ${maxMb} MB).`); return; }
    setBusy(true); setMsg(null);
    try {
      for (const f of list) {
        const form = new FormData();
        form.set("file", f);
        form.set("role", "design");
        const r = await fetch(`/api/projects/${projectId}/materials`, { method: "POST", body: form });
        const b = await r.json().catch(() => ({}));
        if (!r.ok) { setMsg(b.error ?? `Gagal mengunggah ${f.name}`); break; }
      }
      await onChanged();
    } finally { setBusy(false); }
  };
  const remove = async (m: Material) => {
    const r = await fetch(`/api/projects/${projectId}/materials/${m.id}`, { method: "DELETE" });
    if (!r.ok) setMsg((await r.json().catch(() => ({}))).error ?? "Gagal menghapus");
    await onChanged();
  };
  return (
    <div className={s.attach}>
      {docs.map((m) => (
        <figure key={m.id} className={`${s.attachItem} ${s.attachDoc}`} title={`${m.label}
Dibaca AI sebagai panduan gaya; tidak tampil di video.`}>
          <a href={`/api/assets/${m.id}/file`} target="_blank" rel="noreferrer"><b>PDF</b><span>{m.label.replace(/\.pdf$/i, "")}</span></a>
          <span className={`${s.attachRole} ${s.attachLogo}`}>Design</span>
          <button className={s.attachX} disabled={disabled} onClick={() => void remove(m)} aria-label={`Hapus ${m.label}`}>✕</button>
        </figure>
      ))}
      <button className={s.attachAdd} disabled={disabled || busy} onClick={() => fileRef.current?.click()} title={`Unggah design system dalam bentuk PDF (maks. ${maxMb} MB). AI membacanya dulu lalu mengikuti warna, tipografi, dan gaya komponennya di semua versi.`}>
        {busy ? <span className={s.spin} /> : "＋"}<span>{busy ? "Mengunggah" : "Design system (PDF)"}</span>
      </button>
      <input ref={fileRef} type="file" accept="application/pdf,.pdf" multiple hidden onChange={(e) => { if (e.target.files) void upload(e.target.files); e.target.value = ""; }} />
      {msg && <div className={`${s.small} ${s.err}`} style={{ flexBasis: "100%" }}>{msg}</div>}
    </div>
  );
}

const COMPOSER_MIN_KEY = "creative-composer-min";
type Shot = { key: string; file: File; url: string };
const SHOT_MIMES = Object.keys(CREATIVE.screenshots.ext);

/** Screenshot masalah untuk SATU perintah: hanya dilihat AI, tidak masuk video (beda dengan bahan di atas). */
function Screenshots({ shots, onAdd, onRemove, disabled, msg }: { shots: Shot[]; onAdd: (files: FileList | File[]) => void; onRemove: (s: Shot) => void; disabled: boolean; msg: string | null }) {
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <div className={s.attach}>
      {shots.map((x, i) => (
        <figure key={x.key} className={s.attachItem} title={x.file.name}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={x.url} alt={`Screenshot ${i + 1}`} />
          <span className={s.attachRole}>Screenshot</span>
          <button className={s.attachX} disabled={disabled} onClick={() => onRemove(x)} aria-label={`Hapus screenshot ${i + 1}`}>✕</button>
        </figure>
      ))}
      {shots.length < CREATIVE.screenshots.max && (
        <button className={s.attachAdd} disabled={disabled} onClick={() => fileRef.current?.click()}
          onDrop={(e) => { if (!e.dataTransfer.files.length) return; e.preventDefault(); e.stopPropagation(); onAdd(e.dataTransfer.files); }}
          title="Tunjukkan letak kesalahan ke AI. Hanya dilihat AI untuk perintah ini, tidak masuk video. Bisa juga Ctrl+V di kotak perintah.">
          ＋<span>Screenshot</span>
        </button>
      )}
      <input ref={fileRef} type="file" accept={SHOT_MIMES.join(",")} multiple hidden onChange={(e) => { if (e.target.files) onAdd(e.target.files); e.target.value = ""; }} />
      {msg && <div className={`${s.small} ${s.err}`} style={{ flexBasis: "100%" }}>{msg}</div>}
    </div>
  );
}

export function CreativePanel({ projectId, ready, analyzers, activeId, styleLocked, onActivate, aspect, examples = EXAMPLES, intro, onChanged, materialsVersion, onMaterialsChanged, endClip, defaultModel, talent, rig }: {
  projectId: string;
  /** Fase 24: video bicara saja. ready = talent semua video sudah dipisahkan; seconds = total durasi video (perkiraan waktu proses). */
  talent?: { ready: boolean; seconds: number };
  /** Fase 25: gambar bahan (bukan logo) dan berapa yang sudah di-rig. Tanpa gambar = centang tidak tampil. */
  rig?: { images: number; rigged: number };
  /** Model awal pilihan (mis. dari halaman brief motion). */
  defaultModel?: string;
  /** Fase 18: panel ini membuat klip akhir: riwayat sendiri, dan durasi dipilih pengguna. */
  endClip?: { seconds: number; onSeconds: (seconds: number) => void };
  /** Fase 15: bahan diubah di tempat lain (muat ulang lampiran), dan pemberitahuan bila lampiran berubah di sini. */
  materialsVersion?: number | string;
  onMaterialsChanged?: () => void;
  /** Fase 13: contoh brief dan teks pembuka sendiri (project motion graphics). */
  examples?: Array<{ label: string; prompt: string }>;
  intro?: { title: string; body: string };
  /** Dipanggil setiap daftar versi/job dimuat (mis. untuk menampilkan versi terbaru otomatis). */
  onChanged?: (state: { versions: Array<{ id: string; status: string; number: number }>; job: { status: string; creativeVersionId: string | null } | null }) => void;
  /** Rasio output sekarang. Versi yang dibuat untuk rasio lain tetap jalan, tapi tata letaknya mungkin kurang pas. */
  aspect: AspectId;
  ready: boolean;
  analyzers: { analyzers: AnalyzersState | null; stale: boolean } | null;
  /** style.creativeId yang sedang ditampilkan editor (bisa belum tersimpan). */
  activeId: string | undefined;
  /** Perintah mode cepat sedang berjalan: gaya terkunci sampai selesai. */
  styleLocked: boolean;
  onActivate: (versionId: string | undefined) => void;
}) {
  const [data, setData] = useState<State | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const onChangedRef = useRef(onChanged);
  onChangedRef.current = onChanged;
  const [text, setText] = useState("");
  const [model, setModel] = useState<string>(defaultModel ?? CREATIVE.defaultModel);
  useEffect(() => { if (defaultModel !== undefined) setModel(defaultModel); }, [defaultModel]);
  const [baseId, setBaseId] = useState<string | null>(null);
  const [useBase, setUseBase] = useState(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [replacedDraft, setReplacedDraft] = useState<string | null>(null);
  const [shots, setShots] = useState<Shot[]>([]);
  const [shotMsg, setShotMsg] = useState<string | null>(null);
  const [composerMin, setComposerMin] = useState(false);
  // Dibaca setelah mount agar sama dengan HTML server
  useEffect(() => { try { setComposerMin(localStorage.getItem(COMPOSER_MIN_KEY) === "1"); } catch { /* selalu terbuka */ } }, []);
  const toggleComposer = (min: boolean) => {
    setComposerMin(min);
    try { localStorage.setItem(COMPOSER_MIN_KEY, min ? "1" : "0"); } catch { /* pilihan hanya berlaku sampai halaman ditutup */ }
  };
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // Rasio tiap versi dibaca dari ukuran still-nya (dirender pada rasio saat versi dibuat)
  const [stillRatio, setStillRatio] = useState<Record<string, number>>({});
  const outRatio = ASPECTS[aspect].width / ASPECTS[aspect].height;
  const otherAspect = (versionId: string) => {
    const r = stillRatio[versionId];
    if (!r || Math.abs(r - outRatio) < 0.03) return null;
    return (Object.keys(ASPECTS) as AspectId[]).find((a) => Math.abs(ASPECTS[a].width / ASPECTS[a].height - r) < 0.03) ?? r.toFixed(2);
  };
  const [sending, setSending] = useState(false);
  // Fase 22: video referensi gaya (unggahan / link); dilepas sesudah terkirim
  const [reference, setReference] = useState<ReferenceInput | undefined>();
  const [refKey, setRefKey] = useState(0);
  const [refUploading, setRefUploading] = useState(false);
  // Fase 25: rig karakter hanya bila dicentang
  const [doRig, setDoRig] = useState(false);
  // Fase 24: pisahkan talent hanya bila dicentang (tidak ditebak dari kata di prompt)
  const [splitTalent, setSplitTalent] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const mats = useMaterials(projectId, materialsVersion);
  const images = mats.materials.filter((m) => m.mime.startsWith("image/"));
  const designDocs = mats.materials.filter((m) => m.role === "design");
  const fontFiles = mats.materials.filter((m) => m.mime.startsWith("font/"));
  const uploadRef = useRef<((files: FileList | File[]) => Promise<void>) | null>(null);
  const [dragging, setDragging] = useState(false);
  const materialsChanged = async () => { await mats.reload(); onMaterialsChanged?.(); };

  const forEndClip = !!endClip;
  const load = useCallback(async () => {
    const r = await fetch(`/api/projects/${projectId}/creative${forEndClip ? "?target=endClip" : ""}`);
    const b = await r.json().catch(() => ({}));
    if (r.ok) { setData(b); setLoadErr(null); onChangedRef.current?.({ versions: b.versions ?? [], job: b.job ?? null }); } else setLoadErr(b.error ?? `HTTP ${r.status}`);
  }, [projectId, forEndClip]);
  useEffect(() => { void load(); }, [load]);

  const running = data?.job?.status === "queued" || data?.job?.status === "running";
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => void load(), 2000);
    return () => clearInterval(t);
  }, [running, load]);

  // Perintah lanjutan bawaan: versi aktif (bila ada), atau versi yang dipilih lewat "Lanjutkan dari versi ini"
  const versions = data?.versions ?? [];
  const byId = new Map(versions.map((v) => [v.id, v]));
  const base = (baseId && byId.get(baseId)) || (activeId ? byId.get(activeId) : undefined);
  const baseUsable = !!base && base.status !== "gagal" && (base.hasOverlay || base.hasVideo);
  const active = activeId ? byId.get(activeId) : undefined;
  // "Kembali": versi sah terbaru sebelum versi aktif
  const previous = active ? [...versions].reverse().find((v) => v.number < active.number && (v.status === "draft") && (v.hasOverlay || v.hasVideo)) : undefined;
  // Worker lama (dimulai sebelum Mode Kreatif ada) tidak pernah mengambil job 'creative': katakan, jangan menunggu tanpa batas
  const workerOutdated = !!analyzers?.analyzers && !(analyzers.analyzers.jobTypes ?? []).includes("creative");
  const claude = analyzers?.analyzers?.claude;
  const claudeOk = claude ? claude.installed && claude.loggedIn : true;

  const addShots = (files: FileList | File[]) => {
    const list = [...files];
    const ok = list.filter((f) => SHOT_MIMES.includes(f.type) && f.size <= CREATIVE.screenshots.maxBytes);
    const room = CREATIVE.screenshots.max - shots.length;
    setShotMsg(ok.length < list.length ? `Screenshot harus PNG, JPG, atau WebP, maks. ${Math.round(CREATIVE.screenshots.maxBytes / 1048576)} MB.` : ok.length > room ? `Maksimal ${CREATIVE.screenshots.max} screenshot per perintah.` : null);
    setShots((cur) => [...cur, ...ok.slice(0, room).map((file) => ({ key: crypto.randomUUID(), file, url: URL.createObjectURL(file) }))]);
  };
  const removeShot = (x: Shot) => { URL.revokeObjectURL(x.url); setShots((cur) => cur.filter((y) => y.key !== x.key)); setShotMsg(null); };

  async function send() {
    const v = text.trim();
    if (refUploading) return;
    if (!v || sending || running || !ready || !claudeOk) return;
    setSending(true); setErr(null);
    try {
      const body = JSON.stringify({ prompt: v, model, ...(endClip ? { endClipSeconds: endClip.seconds } : {}), ...(useBase && baseUsable ? { baseVersionId: base!.id } : {}), ...(reference ? { reference } : {}), ...(talent && !talent.ready && splitTalent ? { talent: true } : {}), ...(rig && doRig && rig.rigged < rig.images ? { rig: true } : {}) });
      const form = new FormData();
      form.set("body", body);
      for (const x of shots) form.append("screenshots", x.file);
      const r = await fetch(`/api/projects/${projectId}/creative`, shots.length ? { method: "POST", body: form } : { method: "POST", headers: { "content-type": "application/json" }, body });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) setErr(b.error ?? `HTTP ${r.status}`);
      else { setText(""); setReplacedDraft(null); setBaseId(null); setReference(undefined); setRefKey((k) => k + 1); setSplitTalent(false); setDoRig(false); shots.forEach((x) => URL.revokeObjectURL(x.url)); setShots([]); setShotMsg(null); await load(); }
    } catch { setErr("Koneksi terputus. Coba kirim lagi."); } finally { setSending(false); }
  }
  async function cancel() {
    const r = await fetch(`/api/projects/${projectId}/creative/cancel`, { method: "POST" });
    if (!r.ok) setErr((await r.json().catch(() => ({}))).error ?? "Gagal membatalkan");
    await load();
  }
  async function act(id: string, action: "reject" | "restore") {
    const r = await fetch(`/api/projects/${projectId}/creative/${id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) });
    if (!r.ok) setErr((await r.json().catch(() => ({}))).error ?? "Gagal");
    await load();
  }
  // Kotak perintah ada di bawah daftar versi: bawa pengguna ke sana, kalau tidak klik terasa tidak berbuat apa-apa
  const focusComposer = () => {
    toggleComposer(false);
    // Kotak yang disembunyikan tidak bisa difokus: tunggu sampai tampil
    requestAnimationFrame(() => {
      inputRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      inputRef.current?.focus({ preventScroll: true });
    });
  };
  const continueFrom = (id: string) => {
    setBaseId(id); setUseBase(true);
    focusComposer();
  };
  // Prompt versi lama masuk ke kotak perintah untuk diedit; teks yang sudah diketik bisa dikembalikan
  const editPrompt = (v: Version) => {
    setReplacedDraft(text.trim() && text !== v.prompt ? text : null);
    setText(v.prompt);
    if (v.status !== "gagal" && (v.hasOverlay || v.hasVideo)) setBaseId(v.id);
    focusComposer();
  };
  async function copyPrompt(v: Version) {
    try {
      await navigator.clipboard.writeText(v.prompt);
      setCopiedId(v.id);
      setTimeout(() => setCopiedId((id) => (id === v.id ? null : id)), 1500);
    } catch { setErr("Prompt gagal disalin. Pakai tombol Edit prompt lalu salin dari kotak perintah."); }
  }
  const activate = (id: string | undefined) => {
    onActivate(id);
    // Status 'aktif' di daftar diselaraskan server setelah gaya tersimpan
    setTimeout(() => void load(), 1500);
  };

  const job = data?.job;
  const stageIndex = job?.stage ? STAGES.findIndex(([k]) => k === job.stage) : -1;
  const jobFailed = job && (job.status === "failed" || job.status === "cancelled") && !versions.some((v) => v.id === job.creativeVersionId);

  return (
    <div className={s.tabBody}>
      {loadErr && <div className={s.notice}>{/creative_versions|does not exist|schema cache/i.test(loadErr) ? <>Mode Kreatif belum aktif: jalankan migrasi <b>20261028120000_fase9_kreatif.sql</b> dan <b>20261028140000_fase9_2_skill_refs.sql</b> di SQL Editor Supabase.</> : <>Gagal memuat Mode Kreatif: {loadErr}</>}</div>}
      {analyzers?.stale && <div className={s.notice}>Worker tidak melapor. Pastikan aplikasi dinyalakan lewat <b>Mulai Aplikasi.bat</b>.</div>}
      {!analyzers?.stale && workerOutdated && <div className={s.notice}>Worker yang sedang berjalan belum mendukung Mode Kreatif, jadi perintah kreatif tidak akan diproses. Tutup jendela aplikasi lalu jalankan <b>Mulai Aplikasi.bat</b> lagi.</div>}
      {styleLocked && <div className={s.notice}>Perintah mode Cepat sedang berjalan. Mengaktifkan versi bisa dilakukan setelah selesai.</div>}

      <div className={s.chat}>
        {versions.length === 0 && !running && (
          <div className={s.chatIntro}>
            <Icon name="sparkle" size={27}/>
            <h2>{intro?.title ?? "AI menulis kode motion khusus video ini."}</h2>
            <p>{intro?.body ?? "Tulis brief gaya bebas: tipografi, judul, transisi, gerak kamera. Claude memakai skill Remotion, Shotcraft, dan toolkit, lalu kode diuji dengan render sungguhan."}</p>
            {!intro && <p><Icon name="check" size={13}/> Tidak memotong video dan tidak mengubah cut. Hasil baru tidak dipakai sebelum kamu menekan Aktifkan.</p>}
          </div>
        )}

        {active && (
          <div className={s.creativeActive}>
            <span><b>Versi {active.number} aktif</b> di pratinjau dan render.</span>
            <span className={s.actions} style={{ marginTop: 0 }}>
              {previous && <button className={s.mini} disabled={styleLocked} onClick={() => activate(previous.id)}>↶ Kembali ke versi {previous.number}</button>}
              <button className={s.mini} disabled={styleLocked} onClick={() => activate(undefined)}>{endClip ? "Hapus klip akhir" : "Matikan Mode Kreatif"}</button>
            </span>
          </div>
        )}

        {[...versions].reverse().map((v) => (
          <div key={v.id} className={`${s.versionCard} ${v.id === activeId ? s.versionActive : ""}`}>
            <div className={s.versionHead}>
              <b>Versi {v.number}</b>
              <span className={`${s.badge} ${s[`badge_${v.status}`] ?? ""}`}>{v.id === activeId ? "Aktif" : STATUS_LABEL[v.status]}</span>
              <span className={s.muted}>{v.model.replace("claude-", "")} · {fmtSec(v.duration_ms)}</span>
            </div>
            <div className={s.versionPrompt} title={v.prompt}>{v.prompt}</div>
            {v.stills.length > 0 && (
              <div className={s.stillGrid}>
                {v.stills.map((p, i) => (
                  <figure key={p}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/api/projects/${projectId}/creative/${v.id}/still/${i}`} alt={`Still ${stillLabel(p)} versi ${v.number}`} loading="lazy"
                      onLoad={i === 0 ? (e) => { const im = e.currentTarget; if (im.naturalHeight) setStillRatio((m) => ({ ...m, [v.id]: im.naturalWidth / im.naturalHeight })); } : undefined} />
                    <figcaption>{stillLabel(p)}</figcaption>
                  </figure>
                ))}
              </div>
            )}
            {/* Pesan gagal ditulis kode kita (bukan error mentah): tampilkan apa adanya, bukan pesan umum */}
            {v.status === "gagal" && v.error && <div className={s.versionError}>{v.error}</div>}
            {otherAspect(v.id) && <div className={`${s.small} ${s.muted}`}>Dibuat untuk rasio {otherAspect(v.id)}, sekarang {aspect}. Tetap jalan, tapi tata letak mungkin kurang pas; minta revisi “sesuaikan untuk {aspect}” bila perlu.</div>}
            {v.notes && (
              <details className={s.small}>
                <summary className={s.muted} style={{ cursor: "pointer" }}>Catatan AI{v.replaces_captions ? " · menggantikan subtitle bawaan" : ""}</summary>
                <pre className={s.notesView}>{v.notes.replace(/^\s*replaces-captions\s*\n?/i, "").trim()}</pre>
              </details>
            )}
            <div className={s.actions}>
              <button className={s.mini} onClick={() => void copyPrompt(v)}>{copiedId === v.id ? "✓ Tersalin" : "⧉ Salin prompt"}</button>
              <button className={s.mini} disabled={!ready || running} onClick={() => editPrompt(v)}>✎ Edit prompt</button>
              {v.status !== "gagal" && v.status !== "ditolak" && v.id !== activeId && <button className={`${s.mini} ${s.yes}`} disabled={styleLocked} onClick={() => activate(v.id)}>✓ Aktifkan</button>}
              {v.status === "draft" && v.id !== activeId && <button className={`${s.mini} ${s.no}`} onClick={() => void act(v.id, "reject")}>✕ Tolak</button>}
              {v.status === "ditolak" && <button className={s.mini} onClick={() => void act(v.id, "restore")}>Pulihkan</button>}
              {v.status !== "gagal" && v.status !== "ditolak" && (v.hasOverlay || v.hasVideo) && (useBase && base?.id === v.id
                ? <button className={`${s.mini} ${s.yes}`} onClick={() => continueFrom(v.id)}>✓ Dasar perintah berikutnya, tulis di bawah</button>
                : <button className={s.mini} onClick={() => continueFrom(v.id)}>✎ Lanjutkan dari versi ini</button>)}
            </div>
            <CodeView projectId={projectId} versionId={v.id} />
          </div>
        ))}

        {job && running && (
          <div className={s.bubbleA}>
            <div><span className={s.spin} /> {job.status === "queued" ? "Menunggu worker…" : job.stageLabel ?? "Memulai…"}{job.round > 0 ? ` · perbaikan ke-${job.round}` : ""}</div>
            <ol className={s.steps}>
              {STAGES.map(([k, label], i) => <li key={k} className={i < stageIndex ? s.stepDone : i === stageIndex ? s.stepNow : ""}>{label}</li>)}
            </ol>
            <ActivityFeed entries={job.activity ?? []} live={job.status === "running"} title="Yang sedang dikerjakan AI" />
            <div className={`${s.small} ${s.muted}`}>Biasanya 2–15 menit untuk brief besar. Tidak dibatasi; tekan Batalkan bila terlalu lama. Kode yang gagal diuji dikirim balik ke AI, maksimal {CREATIVE.repairRounds} kali.</div>
            <div className={s.actions}><button className={`${s.mini} ${s.no}`} onClick={() => void cancel()}>Batalkan</button></div>
          </div>
        )}
        {jobFailed && job && (
          <div className={s.bubbleA}>
            <b>{job.status === "cancelled" ? "Perintah kreatif dibatalkan." : "Perintah kreatif terakhir gagal."}</b> Tidak ada yang diterapkan.
            {job.error && job.status !== "cancelled" && <Err raw={job.error} />}
          </div>
        )}
      </div>

      <div className={`${s.composer} ${composerMin ? s.composerMin : ""} ${dragging ? s.composerDrop : ""}`}
        onDragOver={(e) => { if ([...e.dataTransfer.types].includes("Files")) { e.preventDefault(); setDragging(true); } }}
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false); }}
        onDrop={(e) => { if (!e.dataTransfer.files.length) return; e.preventDefault(); setDragging(false); void uploadRef.current?.(e.dataTransfer.files); }}>
        <button className={s.composerToggle} aria-expanded={!composerMin} onClick={() => toggleComposer(!composerMin)}>
          {composerMin
            ? <><span>▴ Tulis perintah</span><span className={s.muted}>{[text.trim() && "ada draf", shots.length && `${shots.length} screenshot`].filter(Boolean).join(" · ")}</span></>
            : <span>▾ Sembunyikan kotak perintah</span>}
        </button>
        {/* Disembunyikan, bukan dilepas: draf, lampiran, dan pesan tetap ada */}
        <div hidden={composerMin}>
        {/* Contoh hanya untuk perintah pertama; setelah ada versi, ruang dipakai daftar versi */}
        {versions.length === 0 && (
          <div className={s.chips}>
            {examples.map((x) => <button key={x.label} title={x.prompt} onClick={() => setText(x.prompt)}>{x.label}</button>)}
          </div>
        )}
        {rig && rig.images > 0 && !endClip && (
          <label className={`${s.small} ${s.row}`} style={{ margin: "0 0 6px" }} title="Gambar karakter (ilustrasi berdiri, latar polos) dipotong menjadi kepala, badan, dan kaki agar bisa bernapas, berkedip, bicara, berjalan, melompat. Sekali per gambar; dipakai lagi di revisi berikutnya.">
            <input type="checkbox" checked={rig.rigged >= rig.images || doRig} disabled={rig.rigged >= rig.images || running} onChange={(e) => setDoRig(e.target.checked)} />
            {rig.rigged >= rig.images ? `Karakter sudah di-rig (${rig.rigged})` : rig.rigged ? `Rig karakter (${rig.rigged}/${rig.images} sudah, sisanya ±beberapa detik)` : "Rig karakter dari bahan gambar (agar bisa bergerak)"}
          </label>
        )}
        {talent && (
          <label className={`${s.small} ${s.row}`} style={{ margin: "0 0 6px" }} title="Dibutuhkan untuk teks di belakang talent dan blur wajah. Prosesnya sekali per video; hasilnya dipakai lagi di revisi berikutnya.">
            <input type="checkbox" checked={talent.ready || splitTalent} disabled={talent.ready || running} onChange={(e) => setSplitTalent(e.target.checked)} />
            {talent.ready ? "Talent sudah dipisahkan" : `Pisahkan talent (+±${Math.max(1, Math.round(talent.seconds * 3 / 60))} mnt, sekali)`}
          </label>
        )}
        {baseUsable && (
          <label className={`${s.small} ${s.row}`} style={{ margin: "0 0 6px" }}>
            <input type="checkbox" checked={useBase} onChange={(e) => setUseBase(e.target.checked)} />
            Ubah versi {base!.number}{base!.id === activeId ? " (aktif)" : ""}, bukan menulis dari nol
          </label>
        )}
        {endClip && (
          <label className={`${s.small} ${s.row}`} style={{ margin: "0 0 6px" }}>
            Durasi klip
            <input key={endClip.seconds} type="number" aria-label="Durasi klip akhir dalam detik" style={{ width: 72 }} disabled={running}
              defaultValue={endClip.seconds} min={END_CLIP.seconds.min} max={END_CLIP.seconds.max} step={END_CLIP.seconds.step}
              onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
              onBlur={(e) => { const n = clampEndClipSeconds(e.target.value); if (n === null) e.target.value = String(endClip.seconds); else { e.target.value = String(n); if (n !== endClip.seconds) endClip.onSeconds(n); } }} />
            detik
          </label>
        )}
        <ReferencePicker key={refKey} projectId={projectId} disabled={running || sending || !ready} onBusy={setRefUploading} onChange={setReference}
          title="Referensi gaya (video / link)" note={CREATIVE_REFERENCE_NOTE} />
        {/* Semua lampiran dalam satu baris yang membungkus, agar kotak perintah tidak lebih tinggi dari panel */}
        <div className={s.attachRow}>
          <Attachments projectId={projectId} images={images} onChanged={materialsChanged} disabled={running} uploadRef={uploadRef} />
          <DesignSystems projectId={projectId} docs={designDocs} onChanged={materialsChanged} disabled={running} />
          <Fonts projectId={projectId} fonts={fontFiles} onChanged={materialsChanged} disabled={running} />
          <Screenshots shots={shots} onAdd={addShots} onRemove={removeShot} disabled={running || sending} msg={shotMsg} />
        </div>
        {replacedDraft && <button className={s.mini} style={{ marginBottom: 6 }} onClick={() => { setText(replacedDraft); setReplacedDraft(null); }}>↶ Kembalikan teks yang tadi kamu ketik</button>}
        <textarea
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void send(); } }}
          onPaste={(e) => { if (running || !e.clipboardData.files.length) return; e.preventDefault(); addShots(e.clipboardData.files); }}
          placeholder={ready ? shots.length ? "Tulis apa yang salah di screenshot itu." : (useBase && baseUsable ? "Contoh: judulnya lebih besar, caption di tengah." : "Brief gaya bebas: GAYA VISUAL… TYPOGRAPHY… CAMERA MOVEMENT…") : "Menunggu video siap..."}
          disabled={!ready || running}
          maxLength={CREATIVE.maxPromptChars}
          aria-label="Perintah kreatif"
        />
        <div className={`${s.row} ${s.composerSend}`} style={{ justifyContent: "space-between" }}>
          <span title={claude?.detail}>
            Claude Code CLI{claude && !claudeOk ? " (belum siap)" : ""} ·{" "}
            <select value={model} onChange={(e) => setModel(e.target.value)} aria-label="Model AI">
              {AI_MODELS.claude.filter((m) => m.id).map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </span>
          <button className={`${s.btn} ${s.primary}`} onClick={() => void send()} disabled={!text.trim() || sending || running || !ready || !claudeOk || refUploading}>
            {running ? "Sedang dibuat…" : sending ? "Mengirim…" : "Buat versi"}
          </button>
        </div>
        <div className={s.composerHint}><span title="Memakai kuota Claude jauh lebih banyak dari mode Cepat">Ctrl+Enter kirim · Ctrl+V tempel screenshot · ±2–8 menit</span><span>{text.length}/{CREATIVE.maxPromptChars}</span></div>
        {err && <Err raw={err} />}
        </div>
      </div>
    </div>
  );
}
