"use client";
// Fase 13: project motion graphics. Brief dulu (prompt + rasio + durasi + bahan), lalu workspace: versi Mode Kreatif,
// pratinjau komposisi Motion (sama dengan render), pengaturan, bahan, dan Ekspor MP4 ke folder pilihan.
import Link from "next/link";
import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Player, type PlayerRef } from "@remotion/player";
import { AI_MODELS, ASPECTS, CAPTION_ANIMS, CREATIVE, MOTION_GFX, OPINION, SFX, isAllowedModel, type AspectId, type CaptionAnim } from "@app/config";
import type { AnalyzersState } from "@app/shared";
import { motionCaptions, normalizeStyle, resolveStyle, type StyleChoice } from "@app/remotion/src/build-props.ts";
import { buildMotionProps, motionSubtitleOn, VOICEOVER_ID, type MaterialInfo, type MotionSettings } from "@app/remotion/src/motion-props.ts";
import { Motion } from "@app/remotion/src/compositions/Motion.tsx";
import { CreativePanel } from "../editor/CreativePanel";
import { SafeAreaGuide, useSafeAreaGuide } from "../../../components/SafeAreaGuide";
import { CREATIVE_REFERENCE_NOTE, ReferencePicker } from "../editor/ReferencePicker";
import type { ReferenceInput } from "@app/shared/reference";
import { useCreativeCode } from "../../../../lib/use-creative-code";
import { useSfxLibrary } from "../../../../lib/use-sfx-library";
import { SfxPanel } from "../../../components/SfxPanel";
import { normalizeCues, type SfxCue } from "@app/shared/sfx";
import { voiceoverUploadExt, type VoiceoverInfo, type VoiceoverSegment, type VoiceProfile } from "@app/shared/voiceover";
import { VoiceoverPanel, type VoiceoverJob, type VoiceoverMode } from "./VoiceoverPanel";
import { AssetPanel, ProviderPick, readyProvider } from "./AssetPanel";
import type { Provider } from "@app/shared";
import { cancelRender, discardEmptySave, downloadUrl, isAbort, pickSaveFile, renderFailedMessage, saveUrlToHandle } from "../../../../lib/save-file";
import { Icon } from "../../../components/Icon";
import s from "./motion.module.css";

type Material = MaterialInfo & { size_bytes: number | null };
type ExportInfo = { renderJob: { status: string; progress: number; error: string | null } | null; outputs: Array<{ id: string; size_bytes: number | null; duration_s: number | null; width: number | null; height: number | null; created_at: string }> };

const EXAMPLES = [
  { label: "Intro logo", prompt: "Intro logo 5 detik: latar gelap dengan cahaya halus, logo muncul dengan reveal mask dan sedikit scale, lalu nama brand mengetik di bawahnya. Akhiri dengan logo diam 1 detik." },
  { label: "Grafik angka", prompt: "Animasikan data di tabel menjadi grafik batang yang tumbuh satu per satu dengan counter angka. Judul di atas, sumber kecil di bawah. Gaya bersih dan modern." },
  { label: "Ajakan bertindak", prompt: "Penutup 6 detik: teks besar 'Follow untuk tips berikutnya' dengan tipografi kinetik per kata, ikon panah yang berdenyut, dan logo di pojok." },
  { label: "Judul bab", prompt: "Kartu judul bab 4 detik: nomor bab besar, judul masuk dari kiri dengan motion blur, garis aksen tumbuh di bawahnya." },
];
/** Project Animasi: cerita bergambar dengan karakter (skill animate-story). */
const EXAMPLES_ANIMASI = [
  { label: "Kisah pelanggan", prompt: "Animasi cerita 20 detik gaya cut paper: seorang pemilik toko kecil kewalahan membalas chat pelanggan malam hari (jam dinding, mug kopi, tumpukan pesan), lalu menemukan cara baru dan bisa tidur tenang. Satu tokoh dari awal sampai akhir, akhiri dengan logo." },
  { label: "Explainer bergambar", prompt: "Explainer 30 detik gaya sketchbook: jelaskan 3 langkah cara kerja produk ini dengan satu karakter pemandu yang menunjuk tiap langkah. Tiap langkah punya ilustrasi sendiri, transisi bentuk ke bentuk, teks singkat tulisan tangan." },
  { label: "Sejarah singkat", prompt: "Animasi sejarah singkat 25 detik: perjalanan dari dulu sampai sekarang dalam 5 era, tiap era berubah lewat morph dari satu bentuk yang sama (hero tetap), label tahun di pojok. Gaya kertas sobek, hangat." },
  { label: "Maskot", prompt: "Maskot brand yang ramah (wajah sederhana, berkedip, bergoyang) memperkenalkan promo dalam 15 detik: muncul, melambai, menunjuk ke teks promo, lalu menutup dengan ajakan bertindak. Gaya kartun datar." },
];
/** Fase 19: project Opinion Motion: arahan visual; isi opini ada di naskah voice over. */
const EXAMPLES_OPINI = [
  { label: "Editorial gelap", prompt: "Gaya editorial gelap ala kanal berita: latar hitam dengan grain halus, aksen merah, tipografi tebal. Foto tokoh masuk dengan reveal mask + lower third nama. Screenshot berita sebagai kartu miring dengan zoom pelan ke kutipan. Kata kunci opini muncul besar di antara aset." },
  { label: "Bersih & terang", prompt: "Gaya bersih dan terang: latar krem, aksen biru, tipografi modern. Foto tokoh dalam bingkai bulat dengan nama di bawahnya. Screenshot artikel melayang dengan bayangan lembut, kutipan yang disorot diperbesar. Angka penting jadi counter besar." },
  { label: "Cepat & energik", prompt: "Tempo cepat untuk Reels/TikTok: potongan tiap 1-2 detik, zoom punch saat nama disebut, screenshot berita masuk dengan whip, kata kunci di-slam besar. Tetap terbaca: tiap aset minimal 1,5 detik." },
];
const fmt = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;
const kindOf = (m: { mime: string; role?: string }) => (m.role === "design" ? "design" : m.mime.startsWith("image/") ? "image" : m.mime.startsWith("audio/") ? "audio" : (MOTION_GFX.knowledge.mimes as readonly string[]).includes(m.mime) ? "knowledge" : "lain");

/** Ukuran gambar / durasi audio dibaca di browser agar AI dan komposisi tahu bentuk bahan. */
async function mediaInfo(file: File): Promise<{ width?: number; height?: number; durationS?: number }> {
  const url = URL.createObjectURL(file);
  try {
    if (file.type.startsWith("image/")) {
      const img = new Image();
      await new Promise((ok, err) => { img.onload = ok; img.onerror = err; img.src = url; });
      return { width: img.naturalWidth, height: img.naturalHeight };
    }
    if (file.type.startsWith("audio/")) {
      const a = new Audio();
      await new Promise((ok, err) => { a.onloadedmetadata = ok; a.onerror = err; a.src = url; });
      return Number.isFinite(a.duration) ? { durationS: a.duration } : {};
    }
    return {};
  } catch { return {}; } finally { URL.revokeObjectURL(url); }
}

export default function MotionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [project, setProject] = useState<{ name: string; kind?: string } | null>(null);
  const [style, setStyle] = useState<StyleChoice | null>(null);
  const serverStyle = useRef<StyleChoice | null>(null);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [analyzers, setAnalyzers] = useState<{ analyzers: AnalyzersState | null; stale: boolean } | null>(null);
  const [started, setStarted] = useState<boolean | null>(null);
  const [brief, setBrief] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [link, setLink] = useState("");
  const [exportInfo, setExportInfo] = useState<ExportInfo | null>(null);
  const [saveState, setSaveState] = useState<string | null>(null);
  const [creativeErrors, setCreativeErrors] = useState<string[]>([]);
  const [sideTab, setSideTab] = useState<"atur" | "suara" | "sfx" | "aset">("atur");
  const [researchProvider, setResearchProvider] = useState<Provider | null>(null);
  // Model dipilih di halaman brief; disimpan per project di browser agar motion Opinion (dibuat setelah aset dipilih) dan
  // versi berikutnya memakai model yang sama. Server tetap memeriksa id model (isAllowedModel).
  const [motionModel, setMotionModelState] = useState<string>(CREATIVE.defaultModel);
  const [researchModel, setResearchModel] = useState<string | null>(null);
  const modelKey = `mantiq:motion-model:${id}`;
  useEffect(() => { try { const m = localStorage.getItem(modelKey); if (m !== null && isAllowedModel("claude", m)) setMotionModelState(m); } catch { /* pakai bawaan */ } }, [modelKey]);
  const setMotionModel = (m: string) => { setMotionModelState(m); try { localStorage.setItem(modelKey, m); } catch { /* hanya sampai halaman ditutup */ } };
  const [voInfo, setVoInfo] = useState<VoiceoverInfo | null>(null);
  const [voJob, setVoJob] = useState<VoiceoverJob | null>(null);
  const [voScript, setVoScript] = useState("");
  const [voProfile, setVoProfile] = useState<VoiceProfile | null>(null);
  const [voMode, setVoMode] = useState<VoiceoverMode>("naskah");
  const [voFile, setVoFile] = useState<{ file: File; durationS?: number } | null>(null);
  const [panelKey, setPanelKey] = useState(0);
  const [selectedSfx, setSelectedSfx] = useState<number | null>(null);
  const sfxLib = useSfxLibrary();
  const playerRef = useRef<PlayerRef>(null);
  // Fase 23: garis bantu safe area Reels/TikTok di pratinjau (tidak ikut render)
  const [safeGuide, setSafeGuide] = useSafeAreaGuide(style?.aspect ?? "9:16");
  const say = useCallback((m: string) => { setMsg(m); setTimeout(() => setMsg((c) => (c === m ? null : c)), 8000); }, []);

  const loadMaterials = useCallback(async () => {
    const r = await fetch(`/api/projects/${id}/materials`);
    const b = await r.json().catch(() => ({}));
    if (r.ok) setMaterials(b.materials ?? []);
  }, [id]);
  const loadExport = useCallback(async () => {
    const r = await fetch(`/api/projects/${id}/export`);
    if (r.ok) setExportInfo(await r.json());
  }, [id]);
  const loadVoiceover = useCallback(async () => {
    const r = await fetch(`/api/projects/${id}/voiceover`);
    if (!r.ok) return null;
    const b = await r.json() as { voiceover: VoiceoverInfo | null; job: VoiceoverJob | null };
    setVoInfo(b.voiceover); setVoJob(b.job);
    return b;
  }, [id]);
  useEffect(() => {
    void (async () => {
      const vo = await loadVoiceover();
      if (vo?.voiceover || vo?.job?.script) { setVoScript(vo.voiceover?.script ?? vo.job?.script ?? ""); }
      if (vo?.voiceover?.direction === "unggahan" || vo?.job?.upload) setVoMode("unggah");
      void fetch("/api/voiceover/profile").then((x) => x.json()).then((b) => setVoProfile(b.profile ?? null)).catch(() => {});
      const r = await fetch(`/api/projects/${id}`);
      const b = await r.json().catch(() => ({}));
      if (!r.ok) return setMsg(b.error ?? `HTTP ${r.status}`);
      setProject(b.project);
      const st = normalizeStyle(b.project.style);
      serverStyle.current = st; setStyle(st);
      if (st.motion?.opini) setSideTab("aset");
      const c = await fetch(`/api/projects/${id}/creative`).then((x) => x.json()).catch(() => ({}));
      setStarted((c.versions?.length ?? 0) > 0 || !!c.job || !!vo?.voiceover || !!vo?.job);
    })();
    void loadMaterials(); void loadExport();
    void fetch("/api/analyzers").then((r) => r.json()).then(setAnalyzers).catch(() => {});
  }, [id, loadMaterials, loadExport, loadVoiceover]);

  // ---- gaya: simpan langsung (dengan cek konkurensi yang sama dengan editor video)
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const updateStyle = useCallback((patch: Partial<StyleChoice>) => {
    setStyle((cur) => {
      if (!cur) return cur;
      const next = normalizeStyle({ ...cur, ...patch });
      saveQueue.current = saveQueue.current.then(async () => {
        const r = await fetch(`/api/projects/${id}/style`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ style: next, baseStyle: serverStyle.current }) });
        const b = await r.json().catch(() => ({}));
        if (r.ok) serverStyle.current = normalizeStyle(b.style);
        else { say(b.error ?? "Gagal menyimpan pengaturan"); if (b.style) { serverStyle.current = normalizeStyle(b.style); setStyle(serverStyle.current); } }
      });
      return next;
    });
  }, [id, say]);
  const motion: MotionSettings = style?.motion ?? { durationS: MOTION_GFX.durationS.default };
  const animasi = motion.animasi === true;
  const opini = motion.opini === true;
  const examples = animasi ? EXAMPLES_ANIMASI : opini ? EXAMPLES_OPINI : EXAMPLES;
  const provider: Provider = researchProvider ?? readyProvider(analyzers?.analyzers);
  const resModel = researchModel !== null && isAllowedModel(provider, researchModel) ? researchModel : OPINION.defaultModel[provider];
  const setMotion = (patch: Partial<MotionSettings>) => updateStyle({ motion: { ...motion, ...patch } });

  // ---- bahan
  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    try {
      for (const f of Array.from(files)) {
        const info = await mediaInfo(f);
        const form = new FormData();
        form.append("file", f);
        if (info.width) form.append("width", String(info.width));
        if (info.height) form.append("height", String(info.height));
        if (info.durationS) form.append("durationS", String(info.durationS));
        const r = await fetch(`/api/projects/${id}/materials`, { method: "POST", body: form });
        const b = await r.json().catch(() => ({}));
        if (!r.ok) { say(b.error ?? "Gagal mengunggah"); continue; }
        // Musik pertama otomatis jadi musik video
        if (kindOf(b.material) === "audio" && !motion.musicId) setMotion({ musicId: b.material.id });
      }
      await loadMaterials();
    } finally { setUploading(false); }
  }
  // Link knowledge: diambil server (bukan AI), disimpan sebagai dokumen
  async function addLink() {
    const url = link.trim();
    if (!url || uploading) return;
    setUploading(true);
    try {
      const r = await fetch(`/api/projects/${id}/materials/link`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url }) });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) return say(b.error ?? "Link gagal diambil");
      setLink(""); say(`Link ditambahkan: ${b.material.label}`);
      await loadMaterials();
    } finally { setUploading(false); }
  }
  async function removeMaterial(m: Material) {
    const r = await fetch(`/api/projects/${id}/materials/${m.id}`, { method: "DELETE" });
    if (!r.ok) return say((await r.json().catch(() => ({}))).error ?? "Gagal menghapus");
    if (motion.musicId === m.id) setMotion({ musicId: undefined, fitMusic: false });
    await loadMaterials();
  }

  // ---- voice over (Fase 17): dibuat worker; selama berjalan status dipantau. Selesai dengan motion antrean = panel kreatif dimuat ulang.
  const voBusy = voJob?.status === "queued" || voJob?.status === "running";
  useEffect(() => {
    if (!voBusy) return;
    const t = setInterval(() => void loadVoiceover().then((b) => { if (b?.job?.status === "done" && b.job.next) setPanelKey((k) => k + 1); }), 2000);
    return () => clearInterval(t);
  }, [voBusy, loadVoiceover]);
  async function generateVoiceover(o: { readingText?: string; segments?: VoiceoverSegment[]; next?: VoiceoverJob["next"] } = {}): Promise<boolean> {
    const r = await fetch(`/api/projects/${id}/voiceover`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ script: voScript.trim(), ...(o.readingText ? { readingText: o.readingText } : {}), ...(o.segments ? { segments: o.segments } : {}), ...(o.next ? { next: o.next } : {}) }) });
    const b = await r.json().catch(() => ({}));
    if (!r.ok) { say(b.error ?? `HTTP ${r.status}`); return false; }
    await loadVoiceover();
    return true;
  }
  // Voice over jadi dari file pengguna: durasi dicek di browser agar penolakan terasa langsung; worker tetap memeriksa ulang.
  async function pickVoiceoverFile(file: File | null) {
    if (!file) return setVoFile(null);
    if (!voiceoverUploadExt(file.name, file.type)) return say("Jenis file belum didukung. Pakai MP3, M4A, WAV, AAC, atau OGG.");
    if (file.size > MOTION_GFX.voiceover.upload.maxBytes) return say(`File terlalu besar (maks. ${Math.round(MOTION_GFX.voiceover.upload.maxBytes / 1048576)} MB).`);
    const { durationS } = await mediaInfo(new File([file], file.name, { type: file.type || "audio/mpeg" }));
    if (durationS && durationS > MOTION_GFX.voiceover.maxDurationS) return say(`Voice over ${Math.round(durationS)} detik, maksimal ${MOTION_GFX.voiceover.maxDurationS} detik.`);
    setVoFile({ file, durationS });
  }
  async function uploadVoiceover(next?: VoiceoverJob["next"]): Promise<boolean> {
    if (!voFile) return false;
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", voFile.file);
      if (voScript.trim()) form.append("script", voScript.trim());
      if (next) form.append("next", JSON.stringify(next));
      const r = await fetch(`/api/projects/${id}/voiceover/upload`, { method: "POST", body: form });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) { say(b.error ?? `HTTP ${r.status}`); return false; }
      setVoFile(null);
      await loadVoiceover();
      return true;
    } finally { setUploading(false); }
  }
  async function cancelVoiceover() {
    const r = await fetch(`/api/projects/${id}/voiceover`, { method: "PATCH" });
    if (!r.ok) return say("Gagal membatalkan voice over");
    await loadVoiceover();
  }
  async function removeVoiceover() {
    const r = await fetch(`/api/projects/${id}/voiceover`, { method: "DELETE" });
    if (!r.ok) return say("Gagal menghapus voice over");
    await loadVoiceover();
    say("Voice over dihapus.");
  }

  // Fase 22: referensi gaya di brief pertama (ikut ke motion sesudah suara, atau ke Opinion Motion lewat status riset)
  const [briefReference, setBriefReference] = useState<ReferenceInput | undefined>();
  const [refUploading, setRefUploading] = useState(false);

  // ---- brief pertama: simpan pengaturan, lalu kirim ke Mode Kreatif. Ada naskah = suara dulu, motion menyusul otomatis.
  async function start() {
    const v = brief.trim();
    if (!v || busy) return;
    setBusy(true);
    try {
      await saveQueue.current;
      // Opinion Motion: voice over wajib (waktu aset mengikuti kata), lalu riset aset; motion dibuat setelah aset dipilih
      const next: NonNullable<VoiceoverJob["next"]> = { prompt: v, model: motionModel, ...(opini ? { assets: { provider, ...(resModel ? { model: resModel } : {}) } } : {}), ...(briefReference ? { reference: briefReference } : {}) };
      if (opini && voMode !== "unggah" && !voScript.trim()) return say("Opinion Motion butuh voice over: tulis naskah opini (dibacakan dengan suara Anda) atau unggah voice over jadi.");
      if (voMode === "unggah") {
        if (!voFile) return say("Pilih file voice over dulu, atau pindah ke Buat dari naskah.");
        if (await uploadVoiceover(next)) setStarted(true);
        return;
      }
      if (voScript.trim()) {
        if (!voProfile) return say("Rekam suara Anda dulu, atau kosongkan naskah voice over.");
        if (await generateVoiceover({ next })) setStarted(true);
        return;
      }
      const r = await fetch(`/api/projects/${id}/creative`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt: v, model: motionModel, ...(briefReference ? { reference: briefReference } : {}) }) });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) return say(b.error ?? `HTTP ${r.status}`);
      setStarted(true);
    } finally { setBusy(false); }
  }

  // ---- Opinion Motion: motion dibuat setelah aset dipilih (Mode Kreatif biasa; aset ber-cue sudah ada di bahan)
  const startOpinionMotion = useCallback(async (prompt: string, reference?: ReferenceInput) => {
    await saveQueue.current;
    const r = await fetch(`/api/projects/${id}/creative`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt, model: motionModel, ...(reference ? { reference } : {}) }) });
    const b = await r.json().catch(() => ({}));
    if (!r.ok) { say(b.error ?? `HTTP ${r.status}`); return false; }
    setPanelKey((k) => k + 1);
    say("Motion sedang dibuat dengan aset pilihan Anda. Progres terlihat di panel kiri.");
    return true;
  }, [id, say, motionModel]);
  const [assetsInfo, setAssetsInfo] = useState<{ pending: number; running: boolean; hasState: boolean } | null>(null);
  const onAssetsInfo = useCallback((i: { state: { mentions: Array<{ status: string }> } | null; job: { status: string } | null }) => setAssetsInfo({ pending: i.state?.mentions.filter((m) => m.status === "pending").length ?? 0, running: i.job?.status === "queued" || i.job?.status === "running", hasState: !!i.state }), []);

  // ---- pratinjau: versi aktif; versi baru yang selesai otomatis ditampilkan (tidak ada video lain untuk dibandingkan)
  const activeId = style?.creativeId;
  const creative = useCreativeCode(id, activeId);
  const autoShown = useRef<string | null>(null);
  const onCreativeChanged = useCallback((st: { versions: Array<{ id: string; status: string }>; job: { status: string; creativeVersionId: string | null } | null }) => {
    const newest = st.job?.status === "done" ? st.job.creativeVersionId : null;
    if (newest && autoShown.current !== newest && st.versions.some((v) => v.id === newest && v.status === "draft")) {
      autoShown.current = newest;
      updateStyle({ creativeId: newest });
    }
  }, [updateStyle]);
  const props = useMemo(() => style && buildMotionProps({
    aspect: style.aspect, settings: style.motion, colors: resolveStyle(style).def.colors, materials,
    srcFor: (mid) => (mid === VOICEOVER_ID ? `/api/projects/${id}/voiceover/file?v=${voInfo?.jobId}` : mid.startsWith("font:") ? creative.code?.fonts?.find((f) => `font:${f.id}` === mid)?.src ?? "" : `/api/assets/${mid}/file`), overlay: creative.code?.overlay,
    ...(creative.code?.fonts?.length ? { fonts: creative.code.fonts } : {}),
    sfx: { style, creativeSfx: creative.code?.sfx, lengthFor: (sid) => sfxLib.items.find((x) => x.id === sid)?.durationS },
    voiceover: voInfo, captions: creative.code?.replacesCaptions ? undefined : motionCaptions(style, voInfo?.words), safeArea: resolveStyle(style).safeArea,
  }), [style, materials, creative.code, sfxLib.items, voInfo, id]);
  // ---- SFX (Fase 14): di motion, waktu sumber = waktu hasil (tidak ada cut)
  const sfxCues = style?.sfx?.cues ?? [];
  const sfxUseCreative = style?.sfx?.useCreative !== false;
  const creativeSfx = creative.code?.sfx ?? [];
  const totalS = props ? props.durationInFrames / props.fps : MOTION_GFX.durationS.default;
  const nowS = () => (props ? (playerRef.current?.getCurrentFrame() ?? 0) / props.fps : 0);
  const seekS = (t: number) => { if (props) playerRef.current?.seekTo(Math.max(0, Math.min(props.durationInFrames - 1, Math.round(t * props.fps)))); };
  const setSfx = (cues: SfxCue[], msg: string | null, useCreative = sfxUseCreative) => {
    const r = normalizeCues(cues, totalS);
    updateStyle({ sfx: { cues: r.cues, useCreative } });
    if (r.dropped.length) say(`SFX tidak dipasang: ${r.dropped[0]}.`); else if (msg) say(msg);
    return r.cues;
  };
  const onCreativeError = useCallback((where: string, message: string) => setCreativeErrors((e) => (e.length >= 5 || e.includes(`${where}: ${message}`) ? e : [...e, `${where}: ${message}`])), []);
  useEffect(() => setCreativeErrors([]), [activeId]);

  // ---- ekspor: pilih lokasi dulu, simpan otomatis setelah render selesai
  const renderBusy = ["queued", "running"].includes(exportInfo?.renderJob?.status ?? "");
  useEffect(() => {
    if (!renderBusy && !saveState) return;
    const t = setInterval(() => void loadExport(), 2500);
    return () => clearInterval(t);
  }, [renderBusy, saveState, loadExport]);
  const pending = useRef<{ handle: Awaited<ReturnType<typeof pickSaveFile>>; since: number } | null>(null);
  const fileName = `${(project?.name ?? "motion").replace(/[\\/:*?"<>|]+/g, "_").trim() || "motion"}.mp4`;
  const saveOutput = useCallback(async (o: { id: string }, preset?: Awaited<ReturnType<typeof pickSaveFile>>) => {
    const url = `/api/assets/${o.id}/file?download=1`;
    try {
      const handle = preset !== undefined ? preset : await pickSaveFile(fileName);
      if (!handle) { downloadUrl(url, fileName); return; }
      setSaveState(`Menyimpan ${handle.name}… 0%`);
      await saveUrlToHandle(url, handle, (f) => setSaveState(`Menyimpan ${handle.name}… ${Math.round(f * 100)}%`));
      setSaveState(null); say(`MP4 tersimpan: ${handle.name}`);
    } catch (e) { setSaveState(null); if (!isAbort(e)) say(e instanceof Error ? e.message : "Gagal menyimpan file"); }
  }, [fileName, say]);
  useEffect(() => {
    const p = pending.current, rj = exportInfo?.renderJob, last = exportInfo?.outputs[0];
    if (!p || !rj) return;
    if (rj.status === "failed" || rj.status === "cancelled") { pending.current = null; setSaveState(null); void renderFailedMessage(p.handle, rj.error, rj.status === "cancelled").then(say); return; }
    if (rj.status === "done" && last && new Date(last.created_at).getTime() >= p.since) { pending.current = null; void saveOutput(last, p.handle); }
  }, [exportInfo, saveOutput, say]);
  async function exportNow() {
    if (!activeId) return say("Belum ada versi untuk diekspor.");
    let handle: Awaited<ReturnType<typeof pickSaveFile>> = null;
    try { handle = await pickSaveFile(fileName); } catch (e) { if (isAbort(e)) return; }
    await saveQueue.current;
    const r = await fetch(`/api/projects/${id}/motion/render`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ versionId: activeId }) });
    const b = await r.json().catch(() => ({}));
    if (!r.ok) { if (handle) void discardEmptySave(handle); return say(b.error ?? "Gagal memulai render"); }
    pending.current = { handle, since: Date.now() - 5000 };
    if (handle) setSaveState(`Menunggu render selesai, lalu disimpan ke ${handle.name}. Jangan tutup tab ini.`);
    await loadExport();
  }

  if (!project || !style || started === null) return <main className={s.loading}>{msg ?? "Memuat…"}</main>;
  if (project.kind && project.kind !== "motion") return <main className={s.loading}>Ini project video. <Link href={`/projects/${id}/editor`}>Buka workspace video</Link></main>;

  const voicePanel = (asBrief: boolean) => (
    <VoiceoverPanel projectId={id} info={voInfo} job={voJob} profile={voProfile} script={voScript} onScript={setVoScript} onProfile={setVoProfile} brief={asBrief}
      mode={voMode} onMode={setVoMode} file={voFile} onFile={(f) => void pickVoiceoverFile(f)} uploading={uploading}
      onUpload={() => void uploadVoiceover(voJob?.status === "failed" || voJob?.status === "cancelled" ? voJob.next ?? undefined : undefined)}
      onGenerate={(o) => void generateVoiceover(o)} onCancel={() => void cancelVoiceover()} onRemove={() => void removeVoiceover()} />
  );
  const followsVoice = !!voInfo || (voMode === "unggah" && !!voFile);
  const settings = (
    <div className={s.settings}>
      <div className={s.field}><span>Rasio</span><div className={s.seg}>{(Object.keys(ASPECTS) as AspectId[]).map((a) => <button key={a} aria-pressed={style.aspect === a} onClick={() => updateStyle({ aspect: a })}>{a}</button>)}</div></div>
      <div className={s.field}><span>Durasi</span>
        <input type="number" min={MOTION_GFX.durationS.min} max={MOTION_GFX.durationS.max} step={1} value={motion.durationS} disabled={followsVoice || (!!motion.fitMusic && !!motion.musicId)}
          onChange={(e) => setMotion({ durationS: Number(e.target.value) })} /> dtk
        {followsVoice && <span className={s.matMeta}>Mengikuti panjang voice over.</span>}
        {motion.musicId && !followsVoice && <label className={s.inline}><input type="checkbox" checked={!!motion.fitMusic} onChange={(e) => setMotion({ fitMusic: e.target.checked })} /> ikuti panjang musik</label>}
      </div>
      {followsVoice && <div className={s.field}><span>Subtitle</span>
        <label className={s.inline}><input type="checkbox" checked={motionSubtitleOn(motion)} onChange={(e) => setMotion({ subtitle: e.target.checked })} /> subtitle otomatis dari voice over</label>
        {motionSubtitleOn(motion) && <div className={s.seg}>{(Object.keys(CAPTION_ANIMS) as CaptionAnim[]).map((a) => <button key={a} aria-pressed={resolveStyle(style).captionAnim === a} onClick={() => updateStyle({ params: { ...style.params, "teks.animasi": a } })}>{CAPTION_ANIMS[a].label}</button>)}</div>}
        <span className={s.matMeta}>Teks mengikuti waktu tiap kata dan ikut ter-ekspor. Isi naskah {started ? "di tab 🎙 Voice over" : "di atas"} agar ejaan nama dan istilah tepat.</span>
      </div>}
      {(voInfo || motion.musicId) && <div className={s.field}><span>Audio</span>
        {voInfo && <label className={s.inline} title="Volume voice over; 100% = asli">Voice over
          <input type="range" min={MOTION_GFX.audioVolume.min} max={MOTION_GFX.audioVolume.max} step={MOTION_GFX.audioVolume.step} value={motion.voVolume ?? MOTION_GFX.voiceover.volume} onChange={(e) => setMotion({ voVolume: Number(e.target.value) })} aria-label="Volume voice over" />
          <output>{Math.round((motion.voVolume ?? MOTION_GFX.voiceover.volume) * 100)}%</output></label>}
        {motion.musicId && <label className={s.inline} title={voInfo ? "Volume musik; saat voice over bicara musik tetap diturunkan otomatis" : "Volume musik; 100% = asli"}>Musik
          <input type="range" min={MOTION_GFX.audioVolume.min} max={MOTION_GFX.audioVolume.max} step={MOTION_GFX.audioVolume.step} value={motion.musicVolume ?? MOTION_GFX.musicVolume} onChange={(e) => setMotion({ musicVolume: Number(e.target.value) })} aria-label="Volume musik" />
          <output>{Math.round((motion.musicVolume ?? MOTION_GFX.musicVolume) * 100)}%</output></label>}
        <span className={s.matMeta}>Langsung berlaku di pratinjau dan ekspor, tanpa membuat versi baru. SFX diatur di tab ♪ SFX.</span>
      </div>}
      <div className={s.field}><span>Bahan</span>
        <div className={s.materials}>
          {materials.map((m) => (
            <div key={m.id} className={s.material}>
              {kindOf(m) === "image" ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={`/api/assets/${m.id}/file`} alt={m.label} /> : <span className={s.audioIcon}>{kindOf(m) === "audio" ? "♪" : m.label.endsWith("(link)") ? "🔗" : "📄"}</span>}
              <span className={s.matName} title={m.label}>{m.label}</span>
              <span className={s.matMeta}>{kindOf(m) === "audio" ? (m.duration_s ? fmt(Number(m.duration_s)) : "audio") : kindOf(m) === "knowledge" ? "knowledge" : kindOf(m) === "design" ? "design system" : m.width ? `${m.width}×${m.height}` : ""}</span>
              {kindOf(m) === "audio" && <label className={s.inline} title="Diputar sebagai musik"><input type="radio" name="music" checked={motion.musicId === m.id} onChange={() => setMotion({ musicId: m.id })} /> musik</label>}
              <button className={s.x} onClick={() => void removeMaterial(m)} aria-label={`Hapus ${m.label}`}>✕</button>
            </div>
          ))}
          <label className={s.uploadBtn}>{uploading ? "Memproses…" : "＋ Logo, gambar, musik, atau dokumen (PDF/TXT/MD)"}<input type="file" multiple accept={[...MOTION_GFX.materials.image, ...MOTION_GFX.materials.audio, ...MOTION_GFX.knowledge.mimes, ".md", ".txt", ".pdf"].join(",")} onChange={(e) => { void upload(e.target.files); e.target.value = ""; }} hidden /></label>
          <div className={s.linkRow}>
            <input type="url" placeholder="Tempel link knowledge (https://…)" value={link} onChange={(e) => setLink(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void addLink(); } }} disabled={uploading} />
            <button onClick={() => void addLink()} disabled={!link.trim() || uploading}>Tambah</button>
          </div>
          {materials.some((m) => kindOf(m) === "knowledge") && <span className={s.matMeta}>AI membaca knowledge dulu, menulis analisis pesannya (tampil di Catatan AI), lalu membuat motion sesuai pesan itu.</span>}
          {motion.musicId && <button className={s.link} onClick={() => setMotion({ musicId: undefined, fitMusic: false })}>Tanpa musik</button>}
        </div>
      </div>
      <div className={s.field}><span>Data/angka <small>(opsional, CSV)</small></span>
        <textarea rows={4} placeholder={"Bulan,Penjualan\nJan,120\nFeb,180\nMar,260"} defaultValue={motion.table ?? ""} maxLength={MOTION_GFX.table.maxChars}
          onBlur={(e) => { if ((e.target.value.trim() || undefined) !== (motion.table || undefined)) setMotion({ table: e.target.value.trim() || undefined }); }} />
      </div>
    </div>
  );

  // ---- halaman brief (pertama kali)
  if (!started) return (
    <main className={s.briefPage}>
      <nav className={s.nav}><Link href="/"><Icon name="back" size={15}/> Semua project</Link><span>{project.name}</span></nav>
      <section className={s.briefCard}>
        <span className="eyebrow">{animasi ? "ANIMASI" : opini ? "OPINION MOTION" : "MOTION GRAPHICS"}</span>
        <h1>{animasi ? "Ceritakan kisah yang ingin dianimasikan." : opini ? "Sampaikan opini Anda, asetnya kami carikan." : "Ceritakan motion yang ingin dibuat."}</h1>
        {opini
          ? <p>Tulis naskah opini di bagian voice over (atau unggah rekaman jadi). Setelah suaranya siap, AI mencari foto tokoh, screenshot artikel berita, logo, dan foto tempat yang Anda sebut. Anda memilih tiap aset dulu, baru Claude Code membuat motion yang memunculkannya tepat saat disebut.</p>
          : <p>Claude Code menulis animasinya dengan kode, diuji dengan render sungguhan, lalu hasilnya muncul di workspace. Bukan rekaman realistis: tipografi, bentuk, ikon, grafik, gambar Anda, dan transisi.</p>}
        <textarea className={s.brief} rows={opini ? 4 : 6} value={brief} onChange={(e) => setBrief(e.target.value)} maxLength={CREATIVE.maxPromptChars} placeholder={opini ? "Arahan visual: gaya, warna, tempo. Contoh: editorial gelap, aksen merah, foto tokoh dengan lower third nama…" : "Contoh: Intro 6 detik untuk channel tips AI. Latar gelap, logo muncul dengan glow, lalu judul 'Otomasi 1 Pekerjaan' masuk per kata…"} autoFocus />
        {opini && <p className={s.muted}>Foto dari web umum kebanyakan berhak cipta. Sumber tiap aset dicatat dan kredit tampil di layar (bisa dimatikan), tetapi itu bukan izin: keputusan memakai tetap di tangan Anda.</p>}
        {animasi && <p className={s.muted}>Tulis tokohnya, alur ceritanya (awal, masalah, perubahan, akhir), dan gaya gambar bila punya: cut paper, sketchbook, tinta crosshatch, riso, pixel, isometric, atau math. AI menyusun rencana beat dulu (tampil di Catatan AI), lalu menggambar.</p>}
        <div className={s.chips}>{examples.map((x) => <button key={x.label} onClick={() => setBrief(x.prompt)}>{x.label}</button>)}</div>
        <ReferencePicker projectId={id} disabled={busy} onBusy={setRefUploading} onChange={setBriefReference} title="Referensi gaya (video / link)" note={CREATIVE_REFERENCE_NOTE} />
        {voicePanel(true)}
        <div className={s.modelRow}>
          <label className={s.field}><span>Model AI pembuat {animasi ? "animasi" : "motion"} <small>(Claude Code)</small></span>
            <select value={motionModel} onChange={(e) => setMotionModel(e.target.value)}>
              {AI_MODELS.claude.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </label>
          {opini && <div className={s.field}><span>AI untuk mencari aset</span>
            <div className={s.modelPick}>
              <ProviderPick value={provider} onChange={(p) => { setResearchProvider(p); setResearchModel(null); }} analyzers={analyzers?.analyzers} />
              {AI_MODELS[provider].length > 1 && <select aria-label="Model riset aset" value={resModel} onChange={(e) => setResearchModel(e.target.value)}>
                {AI_MODELS[provider].map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>}
            </div>
          </div>}
        </div>
        <p className={s.muted}>Opus paling teliti tetapi paling lama dan paling banyak memakai kuota; Sonnet lebih cepat; Haiku tercepat untuk motion sederhana.</p>
        {settings}
        <div className={s.actions}>
          <button className="primary-action" disabled={!brief.trim() || busy || uploading || refUploading} onClick={() => void start()}><Icon name="sparkle" size={16}/> {busy ? "Mengirim…" : animasi ? "Buat animasi" : opini ? "Buat suara lalu cari aset" : "Buat motion"}</button>
          <span className={s.muted}>{opini ? "Suara dulu, lalu AI mencari aset (beberapa menit). Anda memilih aset di workspace, baru motion dibuat. " : ""}{voMode === "unggah" ? "Waktu kata dicatat dulu, lalu motion ±2–8 menit (lebih lama untuk voice over panjang)" : voScript.trim() ? "Suara dibuat dulu (puluhan menit sampai beberapa jam), lalu motion ±2–8 menit (lebih lama untuk voice over panjang)" : "±2–8 menit"}. Progres terlihat di workspace.</span>
        </div>
        {msg && <div className={s.msg}>{msg}</div>}
      </section>
    </main>
  );

  // ---- workspace
  const out = ASPECTS[style.aspect];
  return (
    <main className={`${s.root} ${opini ? s.rootWide : ""}`}>
      <header className={s.top}>
        <Link href="/" className={s.home}><Icon name="back" size={15}/></Link>
        <div><small>{animasi ? "ANIMASI" : opini ? "OPINION MOTION" : "MOTION GRAPHICS"}</small><b>{project.name}</b></div>
        <span className={s.spacer} />
        {msg && <span className={s.toast} role="status">{msg}</span>}
        <button className="primary-action" disabled={!activeId || renderBusy || !!saveState?.startsWith("Menyimpan")} onClick={() => void exportNow()}
          title={renderBusy ? "Render sedang berjalan" : activeId ? "Pilih lokasi file, lalu render MP4" : "Belum ada versi"}>
          <Icon name="export" size={15}/>{exportInfo?.renderJob?.status === "queued" ? "Menunggu render…" : renderBusy ? `Merender… ${Math.round((exportInfo?.renderJob?.progress ?? 0) * 100)}%` : saveState?.startsWith("Menyimpan") ? "Menyimpan…" : "Ekspor MP4"}
        </button>
        {renderBusy && <button onClick={() => void cancelRender(id).then((m) => { say(m); void loadExport(); })} title="Hentikan render ini. Versi motion dan hasil ekspor sebelumnya tidak berubah.">Batalkan render</button>}
      </header>
      <section className={s.left}>
        <CreativePanel key={panelKey} rig={{ images: materials.filter((m) => String(m.mime ?? "").startsWith("image/") && m.role !== "logo" && m.role !== "design").length, rigged: materials.filter((m) => (m as { rig?: unknown }).rig && m.role !== "logo").length }} materialsVersion={materials.map((m) => `${m.id}:${m.role ?? ""}`).join(",")} onMaterialsChanged={() => void loadMaterials()} projectId={id} aspect={style.aspect} ready analyzers={analyzers} activeId={activeId} styleLocked={false}
          onActivate={(creativeId) => updateStyle({ creativeId })} onChanged={onCreativeChanged} examples={examples} defaultModel={motionModel}
          intro={animasi
            ? { title: "Animasi bercerita dari brief.", body: "Tulis tokoh dan alur ceritanya, atau minta revisi dari versi yang ada (mis. “beat 3 lebih lambat”, “ganti gaya ke sketchbook”)." }
            : { title: "Motion graphics dari brief.", body: "Tulis brief, atau minta revisi dari versi yang ada. Versi baru otomatis tampil di pratinjau." }} />
      </section>
      <section className={s.center}>
        <div className={s.stage} style={{ aspectRatio: `${out.width} / ${out.height}` }}>
          {props && <Player numberOfSharedAudioTags={SFX.playerAudioTags} ref={playerRef} key={`${style.aspect}-${props.durationInFrames}`} component={Motion} inputProps={{ ...props, onCreativeError }}
            durationInFrames={props.durationInFrames} fps={props.fps} compositionWidth={props.width} compositionHeight={props.height}
            style={{ width: "100%", height: "100%" }} controls loop acknowledgeRemotionLicense />}
          <SafeAreaGuide aspect={style.aspect} show={safeGuide && !!props} />
          {!activeId && <div className={s.empty}>{voBusy
            ? <>Tahap 1/2 · {voJob?.status === "queued" ? "Menunggu worker…" : voJob?.stageLabel ?? "Menyiapkan suara…"} · {Math.round((voJob?.progress ?? 0) * 100)}%<br/>
                <small>{voJob?.next?.assets ? "Sesudah itu AI mencari aset (tahap 2/3), lalu Anda memilihnya. " : voJob?.next ? `Sesudah itu ${animasi ? "animasi" : "motion"} dibuat otomatis (tahap 2/2). ` : ""}Detail dan tombol batal di tab 🎙 Voice over.</small></>
            : (voJob?.status === "failed" || voJob?.status === "cancelled") && voJob.next
              ? <>Voice over {voJob.status === "cancelled" ? "dibatalkan" : "gagal"}{voJob.error ? `: ${voJob.error}` : ""}.<br/><small>Buka tab 🎙 Voice over untuk mencoba lagi.</small></>
              : opini && assetsInfo?.running ? <>Tahap 2/3 · AI mencari aset di web…<br/><small>Progres dan pilihan aset di tab 🖼 Aset.</small></>
              : opini && assetsInfo && (!assetsInfo.hasState || assetsInfo.pending > 0) ? <>Tahap 3/3 · Pilih aset di tab 🖼 Aset{assetsInfo.pending ? ` (${assetsInfo.pending} belum diputuskan)` : ""}, lalu klik Buat motion.</>
              : <>{animasi ? "Animasi" : "Versi"} pertama sedang dibuat… progresnya terlihat di panel kiri, hasilnya muncul di sini.</>}</div>}
        </div>
        <div className={s.info}><label style={{ marginRight: 10, cursor: "pointer" }} title="Bagian yang tertutup tombol dan caption Reels/TikTok (tidak ikut terekspor)"><input type="checkbox" checked={safeGuide} onChange={(e) => setSafeGuide(e.target.checked)} /> Garis safe area</label><label style={{ marginRight: 10, cursor: "pointer" }} title="Dicentang: subtitle, judul, dan animasi AI menghindari bagian yang tertutup UI Reels/TikTok. Tidak dicentang: hanya jarak tepi biasa (berlaku untuk pratinjau, render, dan versi AI berikutnya)"><input type="checkbox" checked={resolveStyle(style).safeArea} onChange={(e) => { const { ["bingkai.safeArea"]: _drop, ...rest } = style.params; updateStyle({ params: e.target.checked ? rest : { ...style.params, "bingkai.safeArea": false } }); }} /> Ikuti safe area</label>{style.aspect} · {out.width}×{out.height} · {fmt(props ? props.durationInFrames / props.fps : 0)}{voInfo ? " · dengan voice over" : ""}{motion.musicId ? " · dengan musik" : ""}</div>
        {(creative.error || creativeErrors.length > 0) && <div className={s.warn}><b>Kode motion error di sebagian frame.</b> {creative.error ?? creativeErrors[0]} Minta revisi “perbaiki error” bila perlu.</div>}
        {saveState && <div className={s.info}>{saveState}</div>}
        {exportInfo?.renderJob?.status === "failed" && <div className={s.warn}>Render gagal: {exportInfo.renderJob.error}</div>}
        {(exportInfo?.outputs.length ?? 0) > 0 && (
          <div className={s.outputs}><b>Hasil ekspor</b>
            {exportInfo!.outputs.slice(0, 5).map((o) => (
              <div key={o.id}>{o.width}×{o.height} · {o.duration_s != null ? fmt(Number(o.duration_s)) : "?"} · {o.size_bytes ? (o.size_bytes / 1048576).toFixed(1) + " MB" : ""}{" "}
                <a href={`/api/assets/${o.id}/file`} target="_blank" rel="noreferrer">Putar</a> · <button className={s.link} onClick={() => void saveOutput(o)}>Simpan ke…</button>
              </div>
            ))}
          </div>
        )}
      </section>
      <aside className={s.right}>
        <div className={s.seg} role="tablist" aria-label="Panel kanan">{opini && <button role="tab" aria-pressed={sideTab === "aset"} onClick={() => setSideTab("aset")}>🖼 Aset{assetsInfo?.pending ? ` (${assetsInfo.pending})` : ""}</button>}<button role="tab" aria-pressed={sideTab === "atur"} onClick={() => setSideTab("atur")}>Pengaturan</button><button role="tab" aria-pressed={sideTab === "suara"} onClick={() => setSideTab("suara")}>🎙 Voice over</button><button role="tab" aria-pressed={sideTab === "sfx"} onClick={() => setSideTab("sfx")}>♪ SFX{sfxCues.length + (sfxUseCreative ? creativeSfx.length : 0) ? ` (${sfxCues.length + (sfxUseCreative ? creativeSfx.length : 0)})` : ""}</button></div>
        {opini && <div hidden={sideTab !== "aset"}><AssetPanel projectId={id} analyzers={analyzers?.analyzers} hasVoiceover={!!voInfo} kredit={motion.kredit !== false} onKredit={(on) => setMotion({ kredit: on })}
          onMaterialsChanged={loadMaterials} onStartMotion={startOpinionMotion} hasVersion={!!activeId} onInfo={onAssetsInfo} say={say} /></div>}
        {sideTab === "aset" ? null : sideTab === "suara" ? voicePanel(false) : sideTab === "atur" ? <>{settings}<p className={s.muted}>Perubahan rasio, durasi, musik, atau bahan dipakai versi berikutnya. Versi yang ada tetap jalan, tapi tata letaknya mungkin perlu direvisi.</p></>
          : <SfxPanel lib={sfxLib} cues={sfxCues} selected={selectedSfx} onSelect={setSelectedSfx}
              onAdd={(item) => { const at = Math.round(nowS() * 100) / 100; const next = setSfx([...sfxCues, { id: item.id, at, volume: 1 }], `SFX ${item.name} ditambahkan di ${at.toFixed(2)} dtk.`); setSelectedSfx(next.findIndex((c) => c.id === item.id && Math.abs(c.at - at) < 1e-3)); }}
              onPatch={(i, patch) => { const next = setSfx(sfxCues.map((c, k) => (k === i ? { ...c, ...patch } : c)), patch.at !== undefined ? "SFX dipindahkan." : null); if (patch.at !== undefined) setSelectedSfx(next.findIndex((c) => Math.abs(c.at - patch.at!) < 1e-3)); }}
              onDelete={(i) => { setSfx(sfxCues.filter((_, k) => k !== i), "SFX dihapus."); setSelectedSfx(null); }}
              master={Number(style.params["audio.sfx"] ?? SFX.defaultMaster)} onMaster={(v) => updateStyle({ params: { ...style.params, "audio.sfx": v } })}
              creativeCount={creativeSfx.length} useCreative={sfxUseCreative} onUseCreative={(on) => setSfx(sfxCues, on ? "SFX dari versi motion dinyalakan." : "SFX dari versi motion dimatikan.", on)}
              onCopyCreative={() => setSfx([...sfxCues, ...creativeSfx], `${creativeSfx.length} SFX versi disalin ke edit.`, false)}
              onSeek={seekS} disabled={false} onMessage={say} timeNote="Waktu = detik pada video motion. Revisi Mode Kreatif bisa mengubah SFX versinya sendiri."/>}
      </aside>
    </main>
  );
}
