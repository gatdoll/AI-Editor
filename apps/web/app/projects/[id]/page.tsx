"use client";
import Link from "next/link";
import { Icon } from "../../components/Icon";
import { memo, use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AssetRow, ProjectRow, TranscriptRow, Word } from "@app/shared";
import { ErrorBox } from "./ErrorBox";
import { Pipeline, type JobLite } from "./Pipeline";
import { byName, uploadVideo } from "../../../lib/upload-video";
import { useDerivedMedia } from "../../../lib/use-derived-media";

type TranscriptMeta = Pick<TranscriptRow, "id" | "language" | "engine" | "model" | "updated_at"> & { edited: boolean };

type Detail = {
  project: ProjectRow;
  asset: AssetRow | null;
  jobs: JobLite[];
  // Metadata saja; daftar kata diambil terpisah (bisa ribuan kata untuk video panjang)
  transcript: TranscriptMeta | null;
};

const STATUS_LABEL: Record<string, string> = {
  created: "Belum ada video",
  uploading: "Mengunggah",
  ingesting: "Memproses file (checksum, metadata, audio)",
  transcribing: "Membuat transkrip",
  ready: "Siap",
  analyzing: "Menganalisis cut",
  failed: "Gagal",
};
const LOW_CONFIDENCE = 0.6;

function fmt(sec: number) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [transcriptFull, setTranscriptFull] = useState<TranscriptRow | null>(null);
  const loadedKey = useRef<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/projects/${id}`);
    const json = await res.json();
    if (!res.ok) return setError(json.error ?? "Gagal memuat");
    setDetail(json);
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  // Ambil kata-kata transkrip hanya saat transkrip baru/berubah (bukan tiap polling)
  const tMeta = detail?.transcript;
  useEffect(() => {
    if (!tMeta) return;
    const key = `${tMeta.id}:${tMeta.updated_at}`;
    if (loadedKey.current === key) return;
    loadedKey.current = key;
    void fetch(`/api/transcripts/${tMeta.id}`)
      .then((r) => r.json())
      .then((j) => j.transcript && setTranscriptFull(j.transcript))
      .catch(() => {
        loadedKey.current = null; // coba lagi pada polling berikutnya
      });
  }, [tMeta]);

  // Polling selama pekerjaan berjalan
  const status = detail?.project.status;
  useEffect(() => {
    const renderActive = detail?.jobs.some((j) => j.type === "render" && (j.status === "queued" || j.status === "running"));
    if (!status || (!["uploading", "ingesting", "transcribing", "analyzing"].includes(status) && !renderActive)) return;
    if (status === "uploading" && uploadPct !== null) return; // progres upload lokal
    const t = setInterval(() => void load(), 2500);
    return () => clearInterval(t);
  }, [status, uploadPct, load, detail?.jobs]);

  // Fase 11: video yang tidak bisa diputar browser (mis. MOV HEVC) dibuatkan salinan pratinjau oleh worker
  const reloadDetail = useCallback(() => void load(), [load]);
  const derived = useDerivedMedia(detail?.asset ? [detail.asset] : [], 0, reloadDetail);
  // Putar langsung dari disk lewat rute lokal (mendukung seek)
  const assetId = detail?.asset?.id;
  const videoUrl = assetId && (status === "ready" || status === "analyzing") ? `/api/assets/${assetId}/file?view=1${detail?.asset?.preview_status === "siap" ? "&pv=1" : ""}` : null;

  // Fase 16: beberapa video sekaligus, diunggah berurutan menurut nama file
  const [uploadLabel, setUploadLabel] = useState<string | null>(null);
  async function upload(files: FileList | File[]) {
    setError(null);
    const list = byName(files);
    try {
      for (let i = 0; i < list.length; i++) {
        setUploadLabel(list.length > 1 ? `${i + 1}/${list.length} · ${list[i].name}` : null);
        setUploadPct(0);
        await uploadVideo(id, list[i], setUploadPct);
        void load();
      }
    } catch (e) {
      setError(
        (e instanceof Error ? e.message : String(e)) +
          " Unggahan bisa dilanjutkan: pilih file yang sama lagi.",
      );
    } finally {
      setUploadPct(null);
      setUploadLabel(null);
      void load();
    }
  }

  async function retry() {
    setError(null);
    const res = await fetch(`/api/projects/${id}/retry`, { method: "POST" });
    const json = await res.json();
    if (!res.ok) setError(json.error ?? "Gagal mencoba ulang");
    void load();
  }

  async function saveWords(words: Word[]) {
    if (!tMeta) return;
    const res = await fetch(`/api/transcripts/${tMeta.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ words }),
    });
    const json = await res.json();
    if (!res.ok) return setError(json.error ?? "Gagal menyimpan koreksi");
    // Tandai versi ini sudah dimuat: kata-kata yang baru saja kita simpan tidak perlu diunduh ulang
    loadedKey.current = `${tMeta.id}:${json.updated_at}`;
    setTranscriptFull((t) => (t ? { ...t, words, original_words: t.original_words ?? t.words, updated_at: json.updated_at } : t));
    void load();
  }

  if (!detail) return <main style={{ padding: 24 }}>{error ?? "Memuat..."}</main>;
  const { project, asset, jobs, transcript: transcriptMeta } = detail;
  // Fase 13: project motion graphics tidak punya halaman unggah
  if ((project as { kind?: string }).kind === "motion") {
    if (typeof window !== "undefined") window.location.replace(`/projects/${project.id}/motion`);
    return <main style={{ padding: 24 }}>Membuka motion graphics…</main>;
  }
  const transcript = transcriptFull && transcriptMeta && transcriptFull.id === transcriptMeta.id ? transcriptFull : null;

  return (
    <main className="app-shell project-page">
      <nav className="app-nav" aria-label="Navigasi project"><Link href="/" className="brand"><span className="brand-mark"><Icon name="film"/></span>Mantiq Editor</Link><Link href="/"><Icon name="back" size={15}/> Semua project</Link></nav>
      <header className="page-heading"><div><span className="eyebrow">PROJECT / PERSIAPAN VIDEO</span><h1>{project.name}</h1><p>Semua bahan untuk membentuk cerita yang lebih baik.</p></div>{["ready", "transcribing", "analyzing"].includes(project.status) && asset && <Link href={`/projects/${project.id}/editor`} className="primary-action"><Icon name="sliders" size={16}/> Buka workspace <Icon name="arrow" size={16}/></Link>}</header>
      <Pipeline project={project} asset={asset} jobs={jobs} uploadPct={uploadPct} onRetry={retry} />
      {error && <ErrorBox raw={error} />}

      {(!asset || (project.status === "uploading" && uploadPct === null)) && (
        <section className="upload-zone"><Icon name="upload" size={32}/><h2>Tambahkan videomu</h2>
          <p>
            {asset
              ? "Unggahan sebelumnya belum selesai. Pilih file yang SAMA untuk melanjutkan."
              : "Unggah satu atau beberapa video mentah (mp4, mov, mkv, webm), mis. take cut-to-cut. Urutan awal mengikuti nama file dan bisa diubah di workspace. File mentah disimpan apa adanya dan tidak pernah diubah."}
          </p>
          <input
            aria-label="Unggah video sumber"
            type="file"
            accept="video/*,.mkv"
            multiple
            disabled={uploadPct !== null}
            onChange={(e) => e.target.files?.length && void upload(e.target.files)}
          />
          {uploadPct !== null && (
            <div style={{ marginTop: 12 }}>
              <progress value={uploadPct} max={100} style={{ width: "100%" }} /> {uploadPct}%{uploadLabel ? ` · video ${uploadLabel}` : ""}
            </div>
          )}
        </section>
      )}

      {asset && (
        <section style={{ margin: "16px 0", color: "var(--ui-muted)", fontFamily: "var(--ui-mono)", fontSize: 12 }}>
          {asset.duration_s != null && (
            <>
              {fmt(asset.duration_s)} · {asset.width}×{asset.height} · {asset.fps ? Math.round(asset.fps) : "?"} fps
              {asset.size_bytes ? ` · ${(asset.size_bytes / 1024 / 1024).toFixed(1)} MB` : ""}
              {asset.sha256 && <span title={asset.sha256}> · sha256 {asset.sha256.slice(0, 10)}…</span>}
            </>
          )}
        </section>
      )}

      {(detail?.asset?.preview_status === "antre" || detail?.asset?.preview_status === "gagal" || derived.previewError) && (
        <p style={{ color: "var(--ui-muted)" }}>
          {detail?.asset?.preview_status === "antre"
            ? "Format video ini (mis. MOV HEVC dari iPhone) tidak bisa diputar browser. Sedang dibuatkan salinan MP4 khusus pratinjau; render tetap dari file asli."
            : `Salinan pratinjau gagal: ${derived.previewError ?? detail?.asset?.preview_error ?? "coba muat ulang"}`}
        </p>
      )}
      {videoUrl && (
        <video ref={videoRef} src={videoUrl} controls style={{ width: "100%", maxHeight: 420, background: "#000" }} />
      )}

      {/* Fase 12: tidak ada proses di depan. Potong, subtitle, noise, dan edit AI semuanya di workspace. */}
      {project.status === "ready" && asset && (
        <section className="upload-zone" style={{ marginTop: 16 }}>
          <h2>Video siap diedit.</h2>
          <p>Semua pengeditan dilakukan di workspace: potong sendiri atau Auto cut, subtitle sendiri atau Auto subtitle, kurangi noise, lalu edit keseluruhan dengan AI.</p>
          <Link href={`/projects/${project.id}/editor`} className="primary-action"><Icon name="sliders" size={16}/> Buka workspace <Icon name="arrow" size={16}/></Link>
        </section>
      )}
    </main>
  );
}

type WordSpanProps = { i: number; w: Word; active: boolean; onSeek: (t: number) => void; onEdit: (i: number) => void };

// memo: hanya kata yang berubah (aktif/tidak, atau teksnya) yang dirender ulang, bukan seluruh ribuan kata
const WordSpan = memo(function WordSpan({ i, w, active, onSeek, onEdit }: WordSpanProps) {
  const unsure = w.confidence != null && w.confidence < LOW_CONFIDENCE;
  // Spasi nyata antar kata (bukan margin): tanpa spasi browser tidak bisa membungkus baris
  return (
    <>
      <span
        title={`${fmt(w.start)} · yakin ${w.confidence != null ? Math.round(w.confidence * 100) + "%" : "?"}`}
        onClick={() => onSeek(w.start)}
        onDoubleClick={() => onEdit(i)}
        style={{
          cursor: "pointer",
          background: active ? "var(--ui-accent-soft)" : undefined,
          textDecoration: unsure ? "underline wavy #e67e22" : undefined,
        }}
      >
        {w.text}
      </span>{" "}
    </>
  );
});

/** Indeks kata yang sedang diucapkan pada waktu t (pencarian biner), atau -1. */
function activeWordIndex(words: Word[], t: number): number {
  let lo = 0;
  let hi = words.length - 1;
  let idx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (words[mid].start <= t) {
      idx = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return idx >= 0 && t < words[idx].end ? idx : -1;
}

function TranscriptView({
  transcript,
  onSeek,
  onSave,
  getTime,
}: {
  transcript: TranscriptRow;
  onSeek: (t: number) => void;
  onSave: (words: Word[]) => Promise<void>;
  getTime: () => number;
}) {
  const [words, setWords] = useState<Word[]>(transcript.words);
  const [editing, setEditing] = useState<number | null>(null);
  const [activeIdx, setActiveIdx] = useState(-1);
  const wordsRef = useRef(words);
  wordsRef.current = words;

  useEffect(() => setWords(transcript.words), [transcript.words]);
  useEffect(() => {
    // setState dengan nilai sama tidak merender ulang: hanya berubah saat kata aktif berganti
    const t = setInterval(() => setActiveIdx(activeWordIndex(wordsRef.current, getTime())), 200);
    return () => clearInterval(t);
  }, [getTime]);

  const low = useMemo(() => words.filter((w) => w.confidence != null && w.confidence < LOW_CONFIDENCE).length, [words]);
  const onEdit = useCallback((i: number) => setEditing(i), []);

  function commit(i: number, text: string) {
    setEditing(null);
    const clean = text.trim();
    if (!clean || clean === words[i].text) return;
    const next = words.map((w, k) => (k === i ? { ...w, text: clean } : w));
    setWords(next);
    void onSave(next);
  }

  return (
    <section style={{ marginTop: 24 }}>
      <h2>Transkrip</h2>
      <p style={{ color: "var(--ui-muted)" }}>
        {words.length} kata · {transcript.engine} {transcript.model} · bahasa {transcript.language ?? "?"}
        {transcript.original_words ? " · sudah dikoreksi" : ""}
        {low > 0 && ` · ${low} kata kurang yakin (digarisbawahi)`}. Klik kata untuk melompat, klik dua kali untuk mengoreksi.
      </p>
      <p style={{ lineHeight: 2, fontSize: 17 }}>
        {words.map((w, i) =>
          editing === i ? (
            <input
              key={i}
              autoFocus
              defaultValue={w.text}
              onBlur={(e) => commit(i, e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commit(i, (e.target as HTMLInputElement).value);
                if (e.key === "Escape") setEditing(null);
              }}
              style={{ width: `${Math.max(4, w.text.length + 2)}ch`, marginRight: 4 }}
            />
          ) : (
            <WordSpan key={i} i={i} w={w} active={i === activeIdx} onSeek={onSeek} onEdit={onEdit} />
          ),
        )}
      </p>
    </section>
  );
}
