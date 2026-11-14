// Job 'assets' (Fase 19): riset aset Opinion Motion. AI (Claude Code / Codex CLI dengan pencarian web) menandai sebutan dan
// mengusulkan URL -> divalidasi skema kita -> kode kita mengunduh gambar dan memotret artikel -> kandidat menunggu PILIHAN pengguna.
// Tidak ada aset yang masuk video sebelum dipilih. Gagal / tidak ditemukan = ditandai dengan alasan (aturan 7).
import { randomUUID } from "node:crypto";
import { mkdir, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CREATIVE, OPINION, isAllowedModel } from "@app/config";
import { resolveMediaPath, type JobRow, type Provider } from "@app/shared";
import { ARTICLE_FOCUS, checkResearch, domainOf, RESEARCH_JSON_SCHEMA, type ArticleFocus, type ArticleRequest, type Candidate, type Mention, type OpinionState, type ResearchMention } from "@app/shared/opinion";
import { candidateRel, loadOpinion, opinionRel, releaseMention, saveOpinion } from "@app/shared/opinion-store";
import { loadVoiceover } from "@app/shared/voiceover-store";
import { normalizeStyle } from "../../../../packages/remotion/src/build-props.ts";
import { runResearch } from "../analyze/providers.ts";
import { activityLog } from "../activity.ts";
import { launchBrowser, type Browser } from "./browser.ts";
import { fetchImage } from "./fetch-image.ts";
import { fullResearchPrompt, RESEARCH_SYSTEM, singleResearchPrompt } from "./research.ts";
import { screenshotArticle } from "./screenshot.ts";
import { handleOwnAssets } from "../own-assets/handler.ts";
import type { ReferenceAttachment } from "@app/shared/reference";

type Ctx = { db: SupabaseClient; setProgress: (fraction: number) => Promise<void> };

/** Payload job. Tanpa `only`/`shot` = riset penuh. */
export type AssetsPayload = {
  provider?: Provider; model?: string; brief?: string;
  /** Cari ulang satu sebutan, dengan petunjuk pengguna (opsional). */
  only?: string; query?: string;
  /** Ambil ulang screenshot artikel sesuai instruksi pengguna (tanpa AI). */
  shot?: { mentionId: string; fokus: ArticleFocus; kutipan?: string; sorot: boolean; url?: string };
  /** Fase 22: referensi gaya dari brief pertama, disimpan di status untuk "Buat motion". */
  reference?: ReferenceAttachment;
};

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);

/** Unduh/potret kandidat satu sebutan. Kandidat gagal tetap dicatat dengan alasannya. */
export async function gather(a: { projectId: string; mentionId: string; r: Pick<ResearchMention, "type" | "images" | "article">; layout: "portrait" | "landscape"; getBrowser: () => Promise<Browser>; signal: AbortSignal; log?: (text: string) => void }): Promise<Candidate[]> {
  const out: Candidate[] = [];
  const dir = resolveMediaPath(`${opinionRel(a.projectId)}/kandidat/${a.mentionId}`);
  await mkdir(dir, { recursive: true });
  if (a.r.type === "berita" && a.r.article) {
    out.push(await shoot({ ...a, req: a.r.article }));
    return out;
  }
  for (const im of a.r.images) {
    a.signal.throwIfAborted();
    const id = randomUUID().slice(0, 8);
    const base = { id, kind: "gambar" as const, sourceUrl: im.imageUrl, ...(im.pageUrl ? { pageUrl: im.pageUrl } : {}), source: domainOf(im.pageUrl || im.imageUrl), ...(im.alasan ? { alasan: im.alasan } : {}) };
    a.log?.(`Mengunduh gambar dari ${base.source}`);
    try {
      const got = await fetchImage(im.imageUrl, path.join(os.tmpdir(), `opini-${id}.bin`), path.join(dir, id), im.pageUrl || undefined, a.signal);
      out.push({ ...base, file: candidateRel(a.projectId, a.mentionId, id, got.ext), mime: got.mime, ...(got.width ? { width: got.width, height: got.height } : {}) });
      a.log?.(`✓ Gambar dari ${base.source}${got.width ? ` (${got.width}×${got.height})` : ""}`);
    } catch (e) {
      out.push({ ...base, error: errMsg(e) });
      a.log?.(`✕ Gambar dari ${base.source} gagal: ${errMsg(e)}`);
    }
  }
  return out;
}

async function shoot(a: { projectId: string; mentionId: string; req: ArticleRequest; layout: "portrait" | "landscape"; getBrowser: () => Promise<Browser>; log?: (text: string) => void }): Promise<Candidate> {
  const id = randomUUID().slice(0, 8);
  const rel = candidateRel(a.projectId, a.mentionId, id, ".png");
  const base = { id, kind: "screenshot" as const, sourceUrl: a.req.url, pageUrl: a.req.url, source: a.req.publisher || domainOf(a.req.url) };
  a.log?.(`Memotret artikel ${base.source}`);
  try {
    await mkdir(path.dirname(resolveMediaPath(rel)), { recursive: true });
    const r = await screenshotArticle(await a.getBrowser(), { url: a.req.url, fokus: a.req.fokus, kutipan: a.req.kutipan, sorot: a.req.sorot, title: a.req.title, layout: a.layout }, resolveMediaPath(rel));
    a.log?.(`✓ Screenshot ${r.publisher || base.source}${a.req.kutipan ? (r.kutipanDitemukan ? ", kutipan ditemukan" : ", kutipan tidak ditemukan") : ""}`);
    return {
      ...base, file: rel, mime: "image/png", width: r.width, height: r.height, pageUrl: r.finalUrl, source: r.publisher || base.source,
      // Yang dicatat = yang benar-benar ada di halaman (judul halaman, kutipan ditemukan atau tidak), bukan klaim AI
      article: { url: r.finalUrl, title: r.pageTitle || a.req.title, publisher: r.publisher, date: r.date, fokus: a.req.fokus, ...(a.req.kutipan ? { kutipan: a.req.kutipan } : {}), sorot: a.req.sorot, kutipanDitemukan: r.kutipanDitemukan, catatan: r.catatan },
    };
  } catch (e) {
    a.log?.(`✕ Screenshot ${base.source} gagal: ${errMsg(e)}`);
    return { ...base, error: errMsg(e) };
  }
}

/** Hapus berkas kandidat yang tidak dirujuk status TERBARU di disk (sisa riset sebelumnya). */
async function removeUnreferenced(projectId: string): Promise<void> {
  const s = loadOpinion(projectId);
  if (!s) return;
  const keep = new Set(s.mentions.flatMap((m) => m.candidates.map((c) => c.file).filter(Boolean)).map((f) => path.normalize(resolveMediaPath(f!))));
  const root = resolveMediaPath(`${opinionRel(projectId)}/kandidat`);
  for (const d of await readdir(root, { withFileTypes: true }).catch(() => [])) {
    if (!d.isDirectory()) continue;
    const dir = path.join(root, d.name);
    const files = await readdir(dir).catch(() => [] as string[]);
    for (const f of files) if (!keep.has(path.normalize(path.join(dir, f)))) await rm(path.join(dir, f), { force: true });
    if (files.every((f) => !keep.has(path.normalize(path.join(dir, f))))) await rm(dir, { recursive: true, force: true });
  }
}

const usable = (cs: Candidate[]) => cs.filter((c) => c.file && !c.error);
const failReason = (cs: Candidate[]) => (cs.length ? `Tidak ada kandidat yang berhasil: ${cs.map((c) => c.error).filter(Boolean).slice(0, 2).join("; ")}` : "AI tidak menemukan aset yang yakin benar.");

export async function handleAssets(job: JobRow, { db, setProgress }: Ctx): Promise<void> {
  // Fase 21: jenis job yang sama (tanpa migrasi) untuk mencocokkan aset sendiri di video bicara
  if ((job.payload as { own?: unknown }).own === true) return handleOwnAssets(job, { db, setProgress });
  const p = job.payload as AssetsPayload;
  const provider: Provider = p.provider === "codex" ? "codex" : "claude";
  const model = typeof p.model === "string" && p.model && isAllowedModel(provider, p.model) ? p.model : OPINION.defaultModel[provider] || undefined;
  const { data: project } = await db.from("projects").select("kind, style").eq("id", job.project_id).single();
  const style = normalizeStyle(project?.style as never);
  if (project?.kind !== "motion" || style.motion?.opini !== true) throw new Error("Riset aset hanya untuk project Opinion Motion.");
  const voiceover = loadVoiceover(job.project_id);
  if (!voiceover?.words.length) throw new Error("Voice over belum ada. Riset aset mengikuti waktu kata voice over: buat atau unggah voice over dulu.");
  const layout = style.aspect === "16:9" ? "landscape" : "portrait";

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new Error(`Melewati batas waktu ${Math.round(OPINION.researchTimeoutMs / 60000)} menit.`)), OPINION.researchTimeoutMs);
  const poll = setInterval(async () => {
    const { data } = await db.from("jobs").select("status").eq("id", job.id).maybeSingle();
    if (data?.status === "cancelled") ctrl.abort(new Error("Dibatalkan oleh pengguna."));
  }, CREATIVE.cancelPollMs);
  // Aktivitas langsung (query pencarian, halaman dibuka, unduhan) tampil di panel Aset selama job berjalan
  const act = activityLog(db, job);
  const log = act.add;
  const stage = async (label: string, progress: number) => {
    act.add(label);
    await act.patch({ stageLabel: label });
    await setProgress(progress);
  };
  let browser: Browser | null = null;
  const getBrowser = async () => (browser ??= await launchBrowser());

  try {
    // ---- ambil ulang screenshot sesuai instruksi pengguna (tanpa AI)
    if (p.shot) {
      const s0 = loadOpinion(job.project_id);
      const m0 = s0?.mentions.find((m) => m.id === p.shot!.mentionId);
      if (!m0?.article) throw new Error("Sebutan berita tidak ditemukan. Jalankan riset ulang.");
      const fokus = (ARTICLE_FOCUS as readonly string[]).includes(p.shot.fokus) ? p.shot.fokus : "judul";
      const kutipan = p.shot.kutipan?.trim().slice(0, 300) || undefined;
      const req: ArticleRequest = { ...m0.article, ...(p.shot.url ? { url: p.shot.url, title: "", publisher: domainOf(p.shot.url) } : {}), fokus: fokus === "kutipan" && !kutipan ? "judul" : fokus, kutipan, sorot: !!kutipan && p.shot.sorot };
      await stage("Mengambil screenshot artikel", 0.3);
      const c = await shoot({ projectId: job.project_id, mentionId: m0.id, req, layout, getBrowser, log });
      // Baca ulang sebelum menulis: pengguna bisa memilih aset lain selama job berjalan
      const s = loadOpinion(job.project_id)!;
      const m = s.mentions.find((x) => x.id === m0.id);
      if (!m) throw new Error("Sebutan sudah tidak ada (riset ulang berjalan?).");
      m.article = req;
      m.candidates = [c, ...m.candidates].slice(0, OPINION.maxCandidates + 2);
      if (c.error) m.error = `Screenshot gagal: ${c.error}`; else delete m.error;
      await saveOpinion(job.project_id, s);
      await removeUnreferenced(job.project_id);
      if (c.error) throw new Error(`Screenshot gagal: ${c.error}`);
      return;
    }

    // ---- AI riset (penuh atau satu sebutan)
    const prev = loadOpinion(job.project_id);
    const target = p.only ? prev?.mentions.find((m) => m.id === p.only) : undefined;
    if (p.only && !target) throw new Error("Sebutan tidak ditemukan. Jalankan riset penuh.");
    const brief = p.brief?.trim() || prev?.brief || "";
    await stage(`AI mencari aset di web (${provider === "claude" ? "Claude Code" : "Codex"})`, 0.05);
    const t0 = Date.now();
    const res = await runResearch(provider, {
      system: RESEARCH_SYSTEM,
      prompt: target ? singleResearchPrompt({ mention: target, userQuery: p.query }) : fullResearchPrompt({ script: voiceover.script, words: voiceover.words, brief }),
      schema: RESEARCH_JSON_SCHEMA, timeoutMs: Math.max(60_000, OPINION.researchTimeoutMs - 2 * 60_000), model, signal: ctrl.signal, onActivity: log,
    });
    console.log(`[aset] riset ${provider} ${Math.round((Date.now() - t0) / 1000)} dtk, model ${res.model ?? "?"}`);
    const checked = checkResearch(res.json, voiceover.words);
    log(`AI menemukan ${checked.mentions.length} sebutan${checked.mentions.length ? `: ${checked.mentions.map((m) => m.label).join(", ")}` : ""}${checked.dropped.length ? ` (${checked.dropped.length} dibuang validasi)` : ""}`);
    const warnings = [...checked.dropped.map((d) => `Dibuang: ${d}`), ...(checked.catatan ? [`Catatan AI: ${checked.catatan}`] : [])];

    if (target) {
      // Satu sebutan: rentang kata tetap milik sebutan itu; kandidat baru ditambahkan di depan, yang terpilih tetap ada
      const r = checked.mentions.find((m) => m.type === target.type) ?? checked.mentions[0];
      if (!r) throw new Error(`AI tidak memberi hasil untuk "${target.label}". ${warnings.join(" ")}`.trim());
      await stage(`Mengunduh kandidat "${target.label}"`, 0.6);
      const cands = await gather({ projectId: job.project_id, mentionId: target.id, r: { ...r, type: target.type }, layout, getBrowser, signal: ctrl.signal, log });
      const s = loadOpinion(job.project_id)!;
      const m = s.mentions.find((x) => x.id === target.id);
      if (!m) throw new Error("Sebutan sudah tidak ada (riset ulang berjalan?).");
      const keep = m.candidates.filter((c) => c.id === m.chosen);
      m.candidates = [...cands, ...keep];
      m.query = r.query || m.query;
      if (r.article) m.article = r.article;
      if (usable(cands).length) delete m.error; else m.error = failReason(cands);
      s.warnings = warnings;
      await saveOpinion(job.project_id, s);
      await removeUnreferenced(job.project_id);
      return;
    }

    // Riset penuh: kandidat baru diunduh dulu (nama berkas acak, tidak menimpa yang lama). Pilihan lama baru dilepas tepat
    // sebelum status baru disimpan, jadi batal/gagal di tengah jalan tidak menyentuh pilihan pengguna.
    const mentions: Mention[] = [];
    for (const [i, r] of checked.mentions.entries()) {
      ctrl.signal.throwIfAborted();
      const id = `m${i + 1}`;
      await stage(`Mengunduh aset ${i + 1}/${checked.mentions.length}: ${r.label}`, 0.4 + 0.55 * (i / Math.max(1, checked.mentions.length)));
      const cands = await gather({ projectId: job.project_id, mentionId: id, r, layout, getBrowser, signal: ctrl.signal, log });
      const { images: _images, ...rest } = r;
      mentions.push({ ...rest, id, candidates: cands, status: "pending", ...(usable(cands).length ? {} : { error: failReason(cands) }) });
    }
    if (!mentions.length) warnings.unshift("AI tidak menemukan sebutan yang perlu aset. Periksa naskah, atau tambahkan gambar sendiri di panel Bahan.");
    const reference = p.reference ?? prev?.reference;
    const state: OpinionState = { version: 1, voiceoverJobId: voiceover.jobId, brief, provider, model: res.model ?? model ?? null, updatedAt: "", mentions, warnings, ...(reference ? { reference } : {}) };
    ctrl.signal.throwIfAborted();
    const latest = loadOpinion(job.project_id);
    if (latest) for (const m of latest.mentions) await releaseMention(db, job.project_id, m);
    await saveOpinion(job.project_id, state);
    await removeUnreferenced(job.project_id);
    await stage("Selesai. Pilih aset di tab Aset.", 0.99);
  } catch (e) {
    // Batal/batas waktu: pesan penyebabnya, bukan error turunan dari proses yang dihentikan
    throw ctrl.signal.aborted && ctrl.signal.reason instanceof Error ? ctrl.signal.reason : e;
  } finally {
    clearTimeout(timer);
    clearInterval(poll);
    await act.flush();
    if (browser) await (browser as Browser).close();
  }
}
