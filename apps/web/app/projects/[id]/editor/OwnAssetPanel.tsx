"use client";
// Fase 21: tab Aset di editor video bicara. Pengguna mengunggah gambar sendiri + keterangan; AI mencocokkan keterangan dengan
// transkrip dan MENGUSULKAN waktu munculnya; pengguna memutuskan (pakai usulan, pakai di posisi playhead, atau tidak dipakai).
// Baru setelah itu Mode Kreatif menampilkannya tepat di waktu itu. Tidak ada aset yang masuk tanpa diputuskan.
import { useCallback, useEffect, useRef, useState } from "react";
import { AI_MODELS, MOTION_GFX, OWN_ASSETS } from "@app/config";
import type { AnalyzersState, Provider } from "@app/shared";
import type { OwnItem, OwnState, Placement } from "@app/shared/own-assets";
import { ActivityFeed, type ActivityEntry } from "../../../components/ActivityFeed";
import { imageSize, type Material } from "../../../../lib/use-materials";
import { ProviderPick, readyProvider } from "../motion/AssetPanel";
import s from "./own-assets.module.css";

type Job = { id: string; status: string; progress: number; error: string | null; stageLabel: string | null; only: string[] | null; provider: Provider | null; activity?: ActivityEntry[] };
type Info = { state: OwnState | null; job: Job | null };

const fmt = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;
const providerLabel = (p: Provider) => (p === "claude" ? "Claude Code" : "Codex");
const same = (a?: Placement, b?: Placement) => !!a && !!b && a.wordStart === b.wordStart && a.wordEnd === b.wordEnd;

export function OwnAssetPanel(p: {
  projectId: string;
  analyzers: AnalyzersState | null | undefined;
  materials: Material[];
  onMaterialsChanged: () => Promise<void> | void;
  hasTranscript: boolean;
  /** Detik video mentah di posisi playhead. */
  getPlayhead: () => number;
  onSeek: (sourceS: number) => void;
  /** Kalimat itu terpotong cut yang disetujui sekarang? */
  isCut: (startS: number, endS: number) => boolean;
  onGoCreative: () => void;
  disabled?: boolean;
  say: (m: string) => void;
}) {
  const { projectId: id, say, onMaterialsChanged } = p;
  const images = p.materials.filter((m) => m.mime.startsWith("image/"));
  const [info, setInfo] = useState<Info | null>(null);
  const [provider, setProvider] = useState<Provider>(() => readyProvider(p.analyzers));
  const [model, setModel] = useState<string>(OWN_ASSETS.defaultModel.claude);
  const [busy, setBusy] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const [fresh, setFresh] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const r = await fetch(`/api/projects/${id}/aset-sendiri`, { cache: "no-store" });
    if (!r.ok) return null;
    const b = (await r.json()) as Info;
    setInfo(b);
    return b;
  }, [id]);
  useEffect(() => { void load(); }, [load]);
  const running = info?.job?.status === "queued" || info?.job?.status === "running";
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => void load().then((b) => { if (b && !(b.job?.status === "queued" || b.job?.status === "running")) void onMaterialsChanged(); }), 2500);
    return () => clearInterval(t);
  }, [running, load, onMaterialsChanged]);
  useEffect(() => { if (info?.job?.provider) setProvider(info.job.provider); }, [info?.job?.provider]);
  useEffect(() => { setModel(OWN_ASSETS.defaultModel[provider]); }, [provider]);

  const items = new Map((info?.state?.items ?? []).map((i) => [i.assetId, i]));
  const statusOf = (m: Material) => items.get(m.id)?.status ?? "pending";
  const pendingIds = images.filter((m) => statusOf(m) === "pending").map((m) => m.id);
  const used = images.filter((m) => statusOf(m) === "dipakai").length;
  const lockedFor = (mid: string) => running && (!info?.job?.only || info.job.only.includes(mid));

  async function upload(files: FileList | File[]) {
    const list = [...files].filter((f) => (MOTION_GFX.materials.image as readonly string[]).includes(f.type));
    if (!list.length) return say("Pilih gambar PNG, JPG, WebP, atau SVG.");
    setBusy("upload");
    try {
      let last: string | null = null;
      for (const f of list) {
        const form = new FormData();
        form.append("file", f);
        const dims = await imageSize(f);
        if (dims) { form.append("width", String(dims.width)); form.append("height", String(dims.height)); }
        const r = await fetch(`/api/projects/${id}/materials`, { method: "POST", body: form });
        const b = await r.json().catch(() => ({}));
        if (!r.ok) { say(b.error ?? `HTTP ${r.status}`); break; }
        last = b.material?.id ?? last;
      }
      await onMaterialsChanged();
      // Kolom keterangan aset terakhir langsung aktif: keterangan adalah kunci penempatan
      if (last) setFresh(last);
    } finally { setBusy(null); }
  }
  async function saveNote(m: Material, note: string) {
    if ((m.note ?? "") === note.trim()) return;
    const r = await fetch(`/api/projects/${id}/materials/${m.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ note }) });
    const b = await r.json().catch(() => ({}));
    if (!r.ok) return say(b.error ?? `HTTP ${r.status}`);
    await onMaterialsChanged();
  }
  async function remove(m: Material) {
    setBusy(m.id);
    try {
      const r = await fetch(`/api/projects/${id}/materials/${m.id}`, { method: "DELETE" });
      if (!r.ok) { const b = await r.json().catch(() => ({})); return say(b.error ?? `HTTP ${r.status}`); }
      await onMaterialsChanged(); await load();
    } finally { setBusy(null); }
  }
  async function match(only?: string[]) {
    setBusy(only?.length === 1 ? only[0] : "match");
    try {
      const r = await fetch(`/api/projects/${id}/aset-sendiri`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider, ...(model ? { model } : {}), ...(only ? { only } : {}) }) });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) return say(b.error ?? `HTTP ${r.status}`);
      await load();
    } finally { setBusy(null); }
  }
  async function decide(m: Material, body: Record<string, unknown>) {
    setBusy(m.id);
    try {
      const r = await fetch(`/api/projects/${id}/aset-sendiri/${m.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) return say(b.error ?? `HTTP ${r.status}`);
      await load(); await onMaterialsChanged();
    } finally { setBusy(null); }
  }
  async function cancel() { await fetch(`/api/projects/${id}/aset-sendiri`, { method: "PATCH" }); await load(); }

  const st = p.analyzers?.[provider];
  return (
    <div className={s.panel}>
      <p className={s.intro}>Unggah gambar milikmu dan tulis <b>keterangannya</b>: isi gambar dan kapan sebaiknya muncul (mis. “foto produk botol hijau, saat aku bahas harga”). AI mencocokkan keterangan dengan transkrip lalu mengusulkan waktunya. Kamu yang memutuskan, lalu tampilannya dibuat di Prompt → Kreatif.</p>

      <div className={s.drop} data-over={over} role="button" tabIndex={0} aria-disabled={p.disabled || busy === "upload"}
        onClick={() => !p.disabled && fileRef.current?.click()} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") fileRef.current?.click(); }}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); if (!p.disabled && e.dataTransfer.files.length) void upload(e.dataTransfer.files); }}>
        {busy === "upload" ? "Mengunggah…" : "+ Tambah gambar (klik atau seret ke sini) · PNG, JPG, WebP, SVG"}
        <input ref={fileRef} type="file" accept={MOTION_GFX.materials.image.join(",")} multiple hidden onChange={(e) => { if (e.target.files) void upload(e.target.files); e.target.value = ""; }} />
      </div>

      {images.length > 0 && <div className={s.row}>
        <ProviderPick value={provider} onChange={setProvider} analyzers={p.analyzers} disabled={running} />
        {provider === "claude" && <select className={s.select} aria-label="Model untuk mencocokkan" value={model} onChange={(e) => setModel(e.target.value)} disabled={running}>{AI_MODELS.claude.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select>}
        {st && !st.loggedIn && <span className={s.warn}>{providerLabel(provider)} belum siap: {st.detail}</span>}
      </div>}
      {images.length > 0 && <div className={s.row}>
        <button className={`${s.btn} ${s.primary}`} disabled={!p.hasTranscript || running || !!busy || !pendingIds.length || p.disabled} onClick={() => void match()}
          title={!p.hasTranscript ? "Buat transkrip dulu (Auto subtitle / Auto cut)" : pendingIds.length ? "AI membaca transkrip + keterangan lalu mengusulkan waktu" : "Semua aset sudah diputuskan; pakai Cocokkan ulang per aset"}>
          {busy === "match" ? "Mengirim…" : `Cocokkan dengan transkrip${pendingIds.length ? ` (${pendingIds.length})` : ""}`}
        </button>
        {!p.hasTranscript && <span className={s.warn}>Transkrip belum ada. Buat dulu lewat Auto subtitle atau Auto cut.</span>}
      </div>}

      {running && <div className={s.job} role="status">
        <b>{info!.job!.status === "queued" ? "Menunggu worker…" : info!.job!.stageLabel ?? "Mencocokkan…"}</b>
        <span className={s.meta}>{Math.round((info!.job!.progress ?? 0) * 100)}% · keputusan aset yang sedang dicocokkan dikunci sampai selesai. <button className={s.link} onClick={() => void cancel()}>Batalkan</button></span>
        <ActivityFeed entries={info!.job!.activity ?? []} live={info!.job!.status === "running"} title="Yang sedang dikerjakan AI" />
      </div>}
      {!running && info?.job?.status === "failed" && <div className={s.err}>Pencocokan terakhir gagal: {info.job.error}</div>}
      {(info?.state?.warnings.length ?? 0) > 0 && <details className={s.meta}><summary>{info!.state!.warnings.length} catatan AI</summary><ul>{info!.state!.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></details>}

      {images.length === 0 && <p className={s.meta}>Belum ada gambar. Gambar yang dilampirkan di Prompt → Kreatif juga muncul di sini.</p>}
      {images.map((m) => <AssetCard key={m.id} m={m} item={items.get(m.id)} locked={lockedFor(m.id) || busy === m.id || !!p.disabled} autoFocus={fresh === m.id}
        onNote={(t) => void saveNote(m, t)} onPick={(i) => void decide(m, { action: "pakai", option: i })}
        onHere={() => void decide(m, { action: "di-sini", atS: p.getPlayhead() })} onSkip={() => void decide(m, { action: statusOf(m) === "tidak-dipakai" ? "ulang" : "tidak-dipakai" })}
        onReset={() => void decide(m, { action: "ulang" })} onRematch={() => void match([m.id])} canMatch={p.hasTranscript && !running}
        onRemove={() => void remove(m)} onSeek={p.onSeek} isCut={p.isCut} />)}

      {images.length > 0 && <div className={s.footer}>
        <span className={s.meta}>{used} dipakai · {pendingIds.length} belum diputuskan</span>
        <button className={s.btn} disabled={!used} onClick={p.onGoCreative} title="Tulis gaya tampilnya di Prompt Kreatif, mis. “tampilkan aset saya sebagai kartu pop-up di samping”">Buat tampilannya di Kreatif →</button>
      </div>}
    </div>
  );
}

function AssetCard(p: {
  m: Material; item: OwnItem | undefined; locked: boolean; autoFocus: boolean; canMatch: boolean;
  onNote: (t: string) => void; onPick: (i: number) => void; onHere: () => void; onSkip: () => void; onReset: () => void; onRematch: () => void; onRemove: () => void;
  onSeek: (s: number) => void; isCut: (a: number, b: number) => boolean;
}) {
  const { m, item } = p;
  const [note, setNote] = useState(m.note ?? "");
  useEffect(() => { setNote(m.note ?? ""); }, [m.note]);
  const [confirmDel, setConfirmDel] = useState(false);
  const status = item?.status ?? "pending";
  const chosen = item?.chosen;
  const chosenIsOption = !!chosen && !!item?.options.some((o) => same(o, chosen));
  const noteChanged = !!item && item.noteUsed !== (m.note ?? "") && (item.options.length > 0 || !!item.error);
  const cut = chosen ? p.isCut(chosen.startS, chosen.endS) : false;
  return (
    <section className={s.card} data-status={status}>
      <div className={s.head}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className={s.thumb} src={`/api/assets/${m.id}/file`} alt={m.note || m.label} loading="lazy" />
        <div style={{ minWidth: 0 }}>
          <div className={s.name} title={m.label}>{m.label}</div>
          <span className={s.meta}>{m.role === "logo" ? "logo" : "gambar"}{m.width ? ` · ${m.width}×${m.height}` : ""}</span>
        </div>
        <span className={s.chip} data-status={status}>{status === "dipakai" ? `✓ dipakai ${fmt(chosen?.startS ?? 0)}` : status === "tidak-dipakai" ? "tidak dipakai" : "belum diputuskan"}</span>
      </div>
      <textarea className={s.note} rows={2} value={note} maxLength={OWN_ASSETS.noteMaxChars} autoFocus={p.autoFocus} disabled={p.locked}
        aria-label={`Keterangan ${m.label}`} placeholder="Keterangan: isi gambar + kapan muncul, mis. “grafik penjualan naik, saat aku sebut omzet 2x lipat”"
        onChange={(e) => setNote(e.target.value)} onBlur={() => p.onNote(note)} />
      {!note.trim() && <span className={s.warn}>Keterangan kosong: AI hanya tahu nama berkas, jadi penempatannya bisa meleset atau ditandai tidak bisa dinilai.</span>}
      {noteChanged && status === "pending" && <span className={s.warn}>Keterangan berubah sesudah dicocokkan. Pakai “Cocokkan ulang” agar usulan mengikuti keterangan baru.</span>}
      {item?.error && <span className={s.err}>{item.error}</span>}
      {cut && <span className={s.warn}>Kalimatnya terpotong oleh cut sekarang, jadi aset ini tidak tampil. Pilih tempat lain atau kembalikan bagian itu.</span>}

      {item?.options.map((o, i) => (
        <div key={`${o.wordStart}-${o.wordEnd}`} className={s.opt} aria-current={same(o, chosen) && status === "dipakai"}>
          <div className={s.optHead}>
            <b>{i === 0 ? "Usulan utama" : `Alternatif ${i}`}</b>
            <button className={s.time} onClick={() => p.onSeek(o.startS)} title="Putar dari sini">▶ {fmt(o.startS)}–{fmt(o.endS)}</button>
            <span style={{ marginLeft: "auto" }} />
            <button className={s.btn} disabled={p.locked || (same(o, chosen) && status === "dipakai")} onClick={() => p.onPick(i)}>{same(o, chosen) && status === "dipakai" ? "✓ Dipakai" : "Pakai"}</button>
          </div>
          <p className={s.quote}>“{o.context}”</p>
          {o.alasan && <span className={s.meta}>{o.alasan}</span>}
          {p.isCut(o.startS, o.endS) && <span className={s.warn}>Bagian ini terpotong oleh cut sekarang.</span>}
        </div>
      ))}
      {chosen && status === "dipakai" && !chosenIsOption && (
        <div className={s.opt} aria-current>
          <div className={s.optHead}><b>Dipilih manual</b><button className={s.time} onClick={() => p.onSeek(chosen.startS)}>▶ {fmt(chosen.startS)}–{fmt(chosen.endS)}</button></div>
          <p className={s.quote}>“{chosen.context}”</p>
        </div>
      )}

      <div className={s.row}>
        <button className={s.btn} disabled={p.locked} onClick={p.onHere} title="Gulir/putar video ke kalimat yang diinginkan, lalu klik ini">Pakai di posisi playhead</button>
        {status === "dipakai" && <button className={s.btn} disabled={p.locked} onClick={p.onReset}>Lepas</button>}
        <button className={s.btn} disabled={p.locked} onClick={p.onSkip}>{status === "tidak-dipakai" ? "Pakai lagi" : "Tidak dipakai"}</button>
        <button className={s.link} disabled={p.locked || !p.canMatch} onClick={p.onRematch}>{item?.options.length || item?.error ? "Cocokkan ulang" : "Cocokkan ini saja"}</button>
        <span style={{ marginLeft: "auto" }} />
        {!confirmDel
          ? <button className={s.link} disabled={p.locked} onClick={() => setConfirmDel(true)}>Hapus</button>
          : <span className={s.meta}>Hapus gambar? <button className={s.link} onClick={() => { setConfirmDel(false); p.onRemove(); }}>Ya</button> · <button className={s.link} onClick={() => setConfirmDel(false)}>Batal</button></span>}
      </div>
    </section>
  );
}
