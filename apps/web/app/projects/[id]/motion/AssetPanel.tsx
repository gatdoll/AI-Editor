"use client";
// Fase 19: panel Aset Opinion Motion. AI mencari foto tokoh / screenshot berita / logo / tempat; pengguna MEMILIH tiap sebutan
// (atau tidak dipakai / cari ulang / unggah sendiri) sebelum motion dibuat. Tidak ada aset yang masuk video tanpa dipilih.
import { useCallback, useEffect, useState } from "react";
import { AI_MODELS, CREATIVE, OPINION } from "@app/config";
import type { AnalyzersState, Provider } from "@app/shared";
import { allDecided, ARTICLE_FOCUS, MENTION_LABEL, type ArticleFocus, type Candidate, type Mention, type OpinionState } from "@app/shared/opinion";
import { ActivityFeed, type ActivityEntry } from "../../../components/ActivityFeed";
import s from "./motion.module.css";
import { CREATIVE_REFERENCE_NOTE, ReferencePicker } from "../editor/ReferencePicker";
import type { ReferenceInput } from "@app/shared/reference";

export type AssetsJob = { id: string; status: string; progress: number; error: string | null; stageLabel: string | null; only: string | null; shot: string | null; provider: Provider | null; activity?: ActivityEntry[] };
type Info = { state: OpinionState | null; stale: boolean; job: AssetsJob | null };

const fmt = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;
const FOCUS_LABEL: Record<ArticleFocus, string> = { judul: "Judul + foto utama", kutipan: "Kutipan (disorot)", atas: "Bagian atas halaman" };
const providerLabel = (p: Provider) => (p === "claude" ? "Claude Code" : "Codex");

/** Provider yang siap dipakai (terpasang + login) menurut status worker. */
export function readyProvider(a: AnalyzersState | null | undefined, prefer: Provider = "claude"): Provider {
  if (a?.[prefer]?.loggedIn) return prefer;
  const other: Provider = prefer === "claude" ? "codex" : "claude";
  return a?.[other]?.loggedIn ? other : prefer;
}

export function ProviderPick({ value, onChange, analyzers, disabled }: { value: Provider; onChange: (p: Provider) => void; analyzers: AnalyzersState | null | undefined; disabled?: boolean }) {
  return (
    <div className={s.seg} role="radiogroup" aria-label="AI untuk riset aset">
      {(["claude", "codex"] as Provider[]).map((p) => {
        const st = analyzers?.[p];
        return <button key={p} type="button" aria-pressed={value === p} disabled={disabled} onClick={() => onChange(p)} title={st ? st.detail : "Status CLI belum terbaca dari worker"}>
          {providerLabel(p)}{st && !st.loggedIn ? " (belum siap)" : ""}
        </button>;
      })}
    </div>
  );
}

export function AssetPanel(p: {
  projectId: string; analyzers: AnalyzersState | null | undefined; hasVoiceover: boolean; kredit: boolean; onKredit: (on: boolean) => void;
  onMaterialsChanged: () => void; onStartMotion: (prompt: string, reference?: ReferenceInput) => Promise<boolean>; hasVersion: boolean; onInfo?: (i: Info) => void; say: (m: string) => void;
}) {
  const { projectId: id, say, onInfo, onMaterialsChanged } = p;
  const [info, setInfo] = useState<Info | null>(null);
  const [provider, setProvider] = useState<Provider>(() => readyProvider(p.analyzers));
  const [model, setModel] = useState<string>(OPINION.defaultModel.claude);
  const [busy, setBusy] = useState<string | null>(null);
  const [brief, setBrief] = useState<string | null>(null);
  const [confirmFull, setConfirmFull] = useState(false);
  // Fase 22: referensi gaya. Bawaan = yang dilampirkan di brief pertama (disimpan di status riset); bisa dilepas/diganti.
  const [newRef, setNewRef] = useState<ReferenceInput | undefined>();
  const [dropBriefRef, setDropBriefRef] = useState(false);
  const [refUploading, setRefUploading] = useState(false);

  const load = useCallback(async () => {
    const r = await fetch(`/api/projects/${id}/opini`);
    if (!r.ok) return null;
    const b = (await r.json()) as Info;
    setInfo(b); onInfo?.(b);
    return b;
  }, [id, onInfo]);
  useEffect(() => { void load(); }, [load]);
  const running = info?.job?.status === "queued" || info?.job?.status === "running";
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => void load().then((b) => { if (b && !(b.job?.status === "queued" || b.job?.status === "running")) onMaterialsChanged(); }), 2500);
    return () => clearInterval(t);
  }, [running, load, onMaterialsChanged]);
  useEffect(() => { if (info?.job?.provider) setProvider(info.job.provider); }, [info?.job?.provider]);
  useEffect(() => { setModel(OPINION.defaultModel[provider]); }, [provider]);
  const state = info?.state ?? null;
  useEffect(() => { if (brief === null && state) setBrief(state.brief); }, [state, brief]);

  async function research(body: Record<string, unknown>, label: string) {
    setBusy(label);
    try {
      const r = await fetch(`/api/projects/${id}/opini`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider, ...(model ? { model } : {}), ...body }) });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) return say(b.error ?? `HTTP ${r.status}`);
      await load();
    } finally { setBusy(null); }
  }
  async function decide(m: Mention, body: Record<string, unknown>) {
    setBusy(m.id);
    try {
      const r = await fetch(`/api/projects/${id}/opini/${m.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) return say(b.error ?? `HTTP ${r.status}`);
      await load(); onMaterialsChanged();
    } finally { setBusy(null); }
  }
  async function uploadOwn(m: Mention, file: File, source: string) {
    setBusy(m.id);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("source", source);
      const dims = await new Promise<{ w: number; h: number } | null>((ok) => { const u = URL.createObjectURL(file); const img = new Image(); img.onload = () => { ok({ w: img.naturalWidth, h: img.naturalHeight }); URL.revokeObjectURL(u); }; img.onerror = () => { ok(null); URL.revokeObjectURL(u); }; img.src = u; });
      if (dims) { form.append("width", String(dims.w)); form.append("height", String(dims.h)); }
      const r = await fetch(`/api/projects/${id}/opini/${m.id}`, { method: "POST", body: form });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) return say(b.error ?? `HTTP ${r.status}`);
      await load(); onMaterialsChanged();
    } finally { setBusy(null); }
  }
  async function cancel() {
    await fetch(`/api/projects/${id}/opini`, { method: "PATCH" });
    await load();
  }

  const decided = allDecided(state);
  const briefRef = state?.reference && !dropBriefRef ? state.reference : undefined;
  const reference: ReferenceInput | undefined = newRef ?? (briefRef ? (briefRef.url ? { kind: "link", url: briefRef.url, startS: briefRef.startS } : { kind: "upload", id: briefRef.id, startS: briefRef.startS }) : undefined);
  const chosen = state?.mentions.filter((m) => m.status === "dipilih").length ?? 0;
  const pending = state?.mentions.filter((m) => m.status === "pending").length ?? 0;
  const statusOf = (pr: Provider) => p.analyzers?.[pr];

  return (
    <div className={s.assetPanel}>
      <div className={s.field}><span>AI untuk riset aset</span>
        <ProviderPick value={provider} onChange={setProvider} analyzers={p.analyzers} disabled={running} />
        {provider === "claude" && <select aria-label="Model riset" value={model} onChange={(e) => setModel(e.target.value)} disabled={running}>{AI_MODELS.claude.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select>}
        {statusOf(provider) && !statusOf(provider)!.loggedIn && <span className={s.warn}>{providerLabel(provider)} belum siap: {statusOf(provider)!.detail}</span>}
      </div>

      {running && <div className={s.jobBox} role="status">
        <b>{info!.job!.status === "queued" ? "Menunggu worker…" : info!.job!.stageLabel ?? "Mencari aset…"}</b> · {Math.round((info!.job!.progress ?? 0) * 100)}%
        <span className={s.matMeta}>Pencarian web bisa beberapa menit. Pilihan aset dikunci sampai selesai.</span>
        <button className={s.link} onClick={() => void cancel()}>Batalkan</button>
        <ActivityFeed entries={info!.job!.activity ?? []} live={info!.job!.status === "running"} title="Yang sedang dikerjakan AI" />
      </div>}
      {!running && info?.job?.status === "failed" && <div className={s.warn}>Riset terakhir gagal: {info.job.error}</div>}
      {!running && (info?.job?.activity?.length ?? 0) > 0 && <details className={s.matMeta}><summary>Log riset terakhir</summary><ActivityFeed entries={info!.job!.activity!} live={false} /></details>}
      {info?.stale && <div className={s.warn}>Voice over sudah diganti sesudah riset: waktu sebutan tidak lagi cocok. Jalankan <b>Riset ulang semua</b> agar foto muncul tepat saat disebut.</div>}
      {!p.hasVoiceover && <div className={s.warn}>Opinion Motion butuh voice over. Buat atau unggah di tab 🎙 Voice over.</div>}

      {!state && !running && p.hasVoiceover && <button className="primary-action" disabled={!!busy} onClick={() => void research({ ...(brief ? { brief } : {}) }, "full")}>Cari aset dari naskah</button>}

      {state && <>
        <div className={s.assetSummary}>
          <span>{state.mentions.length} sebutan · {chosen} dipilih · {pending} belum diputuskan</span>
          {!confirmFull
            ? <button className={s.link} disabled={running || !!busy} onClick={() => setConfirmFull(true)}>Riset ulang semua</button>
            : <span className={s.matMeta}>Pilihan sekarang dilepas. <button className={s.link} onClick={() => { setConfirmFull(false); void research({ ...(brief ? { brief } : {}) }, "full"); }}>Lanjut</button> · <button className={s.link} onClick={() => setConfirmFull(false)}>Batal</button></span>}
        </div>
        <label className={s.inline} style={{ marginLeft: 0 }}><input type="checkbox" checked={p.kredit} onChange={(e) => p.onKredit(e.target.checked)} /> Kredit sumber di layar (mis. “{OPINION.credit.prefix}kompas.com”)</label>
        {state.warnings.length > 0 && <details className={s.matMeta}><summary>{state.warnings.length} catatan riset</summary><ul>{state.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></details>}
        {state.mentions.map((m) => <MentionCard key={m.id} m={m} projectId={id} locked={running || busy === m.id} running={running && (info?.job?.only === m.id || info?.job?.shot === m.id)}
          onPick={(c) => void decide(m, { action: "pilih", candidateId: c.id })}
          onSkip={() => void decide(m, { action: m.status === "tidak-dipakai" ? "ulang" : "tidak-dipakai" })}
          onResearch={(q) => void research({ only: m.id, ...(q ? { query: q } : {}) }, m.id)}
          onShot={(shot) => void research({ shot: { mentionId: m.id, ...shot } }, m.id)}
          onUpload={(f, src) => void uploadOwn(m, f, src)} />)}

        <div className={s.field}><span>Arahan visual motion</span>
          <textarea className={s.brief} rows={3} value={brief ?? ""} maxLength={CREATIVE.maxPromptChars} onChange={(e) => setBrief(e.target.value)} placeholder="Gaya visual, warna, tempo…" />
        </div>
        {briefRef && !newRef && <div className={s.matMeta}>Referensi gaya dari brief: <b>{briefRef.label}</b>{briefRef.url && <> · <a href={briefRef.url} target="_blank" rel="noreferrer">buka ↗</a></>} · mulai {briefRef.startS} dtk · <button className={s.link} onClick={() => setDropBriefRef(true)}>Lepas</button></div>}
        <ReferencePicker projectId={id} disabled={running || !!busy} onBusy={setRefUploading} onChange={setNewRef} title={briefRef ? "Ganti referensi gaya" : "Referensi gaya (video / link)"} note={CREATIVE_REFERENCE_NOTE} />
        <div className={s.assetFooter}>
          <span className={s.matMeta}>{decided ? `${chosen} aset dipilih. Siap dibuat.` : `${pending} dari ${state.mentions.length} sebutan belum diputuskan (pilih aset atau “Tidak dipakai”).`}</span>
          <button className="primary-action" disabled={!decided || running || !!busy || refUploading || !(brief ?? "").trim()} onClick={() => { setBusy("motion"); void p.onStartMotion((brief ?? "").trim(), reference).finally(() => setBusy(null)); }}
            title={decided ? "Claude Code membuat motion dari aset yang dipilih" : "Putuskan dulu tiap sebutan: pilih aset atau tandai tidak dipakai"}>
            {busy === "motion" ? "Mengirim…" : p.hasVersion ? "Buat ulang motion dengan aset ini" : "Buat motion"}
          </button>
        </div>
      </>}
    </div>
  );
}

function MentionCard(p: { m: Mention; projectId: string; locked: boolean; running: boolean; onPick: (c: Candidate) => void; onSkip: () => void; onResearch: (q: string) => void; onShot: (o: { fokus: ArticleFocus; kutipan?: string; sorot: boolean; url?: string }) => void; onUpload: (f: File, source: string) => void }) {
  const { m } = p;
  const [q, setQ] = useState("");
  const [src, setSrc] = useState("");
  const [fokus, setFokus] = useState<ArticleFocus>(m.article?.fokus ?? "judul");
  const [kutipan, setKutipan] = useState(m.article?.kutipan ?? "");
  const [sorot, setSorot] = useState(m.article?.sorot ?? true);
  const [url, setUrl] = useState("");
  const ok = m.candidates.filter((c) => c.file && !c.error);
  const failed = m.candidates.filter((c) => c.error);
  const chosen = m.candidates.find((c) => c.id === m.chosen);
  const shown = chosen?.article ? chosen : ok.find((c) => c.article);
  const fileUrl = (c: Candidate) => `/api/projects/${p.projectId}/opini/file?path=${encodeURIComponent(c.file!)}`;
  return (
    <section className={s.mention} data-status={m.status}>
      <header className={s.mentionHead}>
        <span className={s.badge}>{MENTION_LABEL[m.type]}</span><b title={m.label}>{m.label}</b>
        <span className={s.matMeta}>{fmt(m.startS)}</span>
        <span className={s.statusChip} data-status={m.status}>{m.status === "dipilih" ? "✓ dipilih" : m.status === "tidak-dipakai" ? "tidak dipakai" : "belum dipilih"}</span>
      </header>
      <p className={s.context}>“{m.context}”</p>
      {p.running && <span className={s.matMeta}>Sedang diproses…</span>}
      {m.error && <div className={s.warn}>{m.error}</div>}
      {ok.length > 0 && <div className={s.candGrid} data-kind={m.type}>
        {ok.map((c) => (
          <button key={c.id} type="button" className={s.cand} aria-pressed={m.chosen === c.id} disabled={p.locked} onClick={() => p.onPick(c)} title={[c.alasan, c.source && `Sumber: ${c.source}`, c.width && `${c.width}×${c.height}`].filter(Boolean).join(" · ")}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={fileUrl(c)} alt={`${m.label}: kandidat dari ${c.source || "unggahan"}`} loading="lazy" />
            <span>{c.kind === "unggahan" ? "unggahan" : c.source}</span>
            <span className={s.pickLabel}>{m.chosen === c.id ? "✓ Dipakai" : "Pilih"}</span>
          </button>
        ))}
      </div>}
      <div className={s.decideRow}>
        <span className={s.matMeta}>{ok.length ? (m.status === "dipilih" ? "Klik gambar lain untuk mengganti." : "Klik gambar untuk memakainya.") : "Belum ada kandidat: cari ulang atau unggah sendiri."}</span>
        <button type="button" disabled={p.locked} onClick={p.onSkip}>{m.status === "tidak-dipakai" ? "Pakai lagi" : "Tidak dipakai"}</button>
      </div>
      {failed.length > 0 && <details className={s.matMeta}><summary>{failed.length} kandidat gagal</summary><ul>{failed.map((c) => <li key={c.id}>{c.sourceUrl ? <a href={c.sourceUrl} target="_blank" rel="noreferrer">{c.source || "link"}</a> : c.source}: {c.error}</li>)}</ul></details>}
      {shown?.article && <div className={s.article}>
        <a href={shown.article.url} target="_blank" rel="noreferrer">{shown.article.title || shown.article.url} ↗</a>
        <span className={s.matMeta}>{shown.article.publisher ?? shown.source}{shown.article.date ? ` · ${new Date(shown.article.date).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" })}` : ""}</span>
        {shown.article.kutipanDitemukan === false && <span className={s.warn}>Kutipan tidak ditemukan di halaman; tidak ada yang disorot.</span>}
        {shown.article.catatan.filter((c) => !/Kutipan tidak ditemukan/.test(c)).map((c, i) => <span key={i} className={s.matMeta}>{c}</span>)}
      </div>}
      {m.type === "berita" && <details className={s.shotBox}>
        <summary>Instruksi screenshot</summary>
        <label>Fokus <select value={fokus} onChange={(e) => setFokus(e.target.value as ArticleFocus)}>{ARTICLE_FOCUS.map((f) => <option key={f} value={f}>{FOCUS_LABEL[f]}</option>)}</select></label>
        {fokus === "kutipan" && <>
          <textarea rows={2} value={kutipan} onChange={(e) => setKutipan(e.target.value)} placeholder="Kalimat persis dari artikel yang ingin disorot" maxLength={300} />
          <label className={s.inline} style={{ marginLeft: 0 }}><input type="checkbox" checked={sorot} onChange={(e) => setSorot(e.target.checked)} /> sorot kalimat itu</label>
        </>}
        <input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Link artikel lain (opsional)" />
        <button disabled={p.locked || (fokus === "kutipan" && !kutipan.trim())} onClick={() => p.onShot({ fokus, ...(kutipan.trim() && fokus === "kutipan" ? { kutipan: kutipan.trim() } : {}), sorot, ...(url.trim() ? { url: url.trim() } : {}) })}>Ambil ulang screenshot</button>
      </details>}
      <div className={s.mentionActions}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={m.type === "berita" ? "Petunjuk: media, tanggal, topik…" : `Petunjuk: nama lengkap, jabatan…`} disabled={p.locked} />
        <button disabled={p.locked} onClick={() => p.onResearch(q.trim())}>Cari ulang</button>
      </div>
      <div className={s.mentionActions}>
        <input value={src} onChange={(e) => setSrc(e.target.value)} placeholder="Sumber unggahan (untuk kredit)" disabled={p.locked} />
        <label className={s.miniUpload}>Unggah sendiri<input type="file" accept="image/png,image/jpeg,image/webp" hidden disabled={p.locked} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) p.onUpload(f, src.trim()); }} /></label>
      </div>
    </section>
  );
}
