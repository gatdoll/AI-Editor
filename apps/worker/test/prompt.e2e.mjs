// Uji ujung ke ujung alur prompt terhadap server yang berjalan (butuh web + worker + migrasi Fase 8).
// Jalankan: node apps/worker/test/prompt.e2e.mjs <projectId>
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";

const env = Object.fromEntries(fs.readFileSync("H:/Editing video/.env", "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).trim()]; }));
const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const BASE = "http://localhost:3000";
const pid = process.argv[2];
const results = [];
const check = (label, ok, extra = "") => { results.push(ok); console.log(`${ok ? "LOLOS " : "GAGAL "} ${label}${extra ? "  -> " + extra : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const api = async (m, u, b) => { const r = await fetch(BASE + u, { method: m, headers: { "content-type": "application/json" }, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, body: await r.json().catch(() => ({})) }; };

async function ask(prompt, provider = "claude") {
  const r = await api("POST", `/api/projects/${pid}/prompt`, { prompt, provider });
  if (r.status !== 201) return { sent: r };
  const id = r.body.promptRunId;
  for (let i = 0; i < 200; i++) {
    const list = (await api("GET", `/api/projects/${pid}/prompts`)).body.prompts;
    const p = list.find((x) => x.id === id);
    if (p && ["done", "failed"].includes(p.status)) return { sent: r, p };
    await sleep(1500);
  }
  return { sent: r, p: null };
}
const suggestions = async () => (await api("GET", `/api/projects/${pid}/suggestions`)).body.suggestions;
const detail = async () => (await api("GET", `/api/projects/${pid}`)).body;
const show = (p) => console.log(`       reply: ${p.reply}\n       hasil: ${p.messages.join(" | ")}`);

// ---------------------------------------------------------------- keadaan awal
const before = await suggestions();
const approvedBefore = before.filter((s) => s.status === "approved").map((s) => s.id).sort();
const edlBefore = (await api("GET", `/api/projects/${pid}/export`)).body.edl;
const d0 = await detail();
const wordsBefore = (await api("GET", `/api/transcripts/${d0.transcript.id}`)).body.transcript.words;
console.log(`awal: ${before.length} usulan (${approvedBefore.length} disetujui), EDL v${edlBefore?.version}, ${wordsBefore.length} kata, gaya=${JSON.stringify(d0.project.style)}`);

// ------------------------------------------------------------ gaya (langsung)
let r = await api("PUT", `/api/projects/${pid}/style`, { style: { styleId: "ngawur", aspect: "9:16", focusX: 7 } });
check("PUT gaya dinormalkan (gaya salah -> bersih, focusX dijepit)", r.status === 200 && r.body.style.styleId === "bersih" && r.body.style.aspect === "9:16" && r.body.style.focusX === 1, JSON.stringify(r.body.style));
r = await api("PUT", `/api/projects/${pid}/style`, { style: { aspect: "16:9" } });
check("gaya tersimpan di project", (await detail()).project.style.aspect === "16:9");

// ------------------------------------------------ 1. jeda (Claude) -> hanya usulan
let { sent, p } = await ask("potong semua jeda yang lebih dari 0.5 detik", "claude");
check("perintah diterima (201)", sent.status === 201);
check("perintah selesai (done)", p?.status === "done", p?.error ?? "");
if (p) show(p);
let after = await suggestions();
const newOnes = after.filter((s) => s.prompt_run_id === p?.id);
check("jeda: usulan baru ada dan berjenis 'pause'", p?.createdSuggestions === newOnes.length && newOnes.every((s) => s.kind === "pause"), `${newOnes.length} usulan; AI mengusulkan ${p?.createdSuggestions}`);
check("ATURAN 2: semua usulan dari perintah berstatus 'pending'", newOnes.every((s) => s.status === "pending"));
check("ATURAN 2: persetujuan yang ada tidak berubah", JSON.stringify(after.filter((s) => s.status === "approved").map((s) => s.id).sort()) === JSON.stringify(approvedBefore));
check("usulan dari perintah menunjuk prompt_run (bukan analysis_run)", newOnes.every((s) => s.prompt_run_id && s.run_id === null && s.source === "silence"));
const e1 = (await api("GET", `/api/projects/${pid}/export`)).body.edl;
check("EDL tidak berubah oleh perintah (hanya usulan)", e1?.id === edlBefore?.id);

// ------------------------------------------------ 2. potong frasa (Claude)
({ sent, p } = await ask("hapus kata very", "claude"));
check("potong frasa selesai", p?.status === "done", p?.error ?? "");
if (p) show(p);
after = await suggestions();
const phr = after.filter((s) => s.prompt_run_id === p?.id);
check('potong "very": usulan custom dengan kutipan, pending', phr.length >= 1 && phr.every((s) => s.kind === "custom" && s.status === "pending" && /very/i.test(s.quote ?? "")), `${phr.length} usulan: ${phr.map((s) => `"${s.quote}"`).join(", ")}`);

// ------------------------------------------------ 3. tidak ditemukan (Codex)
({ sent, p } = await ask("hapus kata kucing", "codex"));
check("frasa yang tidak ada: selesai, TANPA usulan, pesan jujur", p?.status === "done" && p.createdSuggestions === 0 && p.messages.some((m) => /Tidak menemukan/.test(m)), p?.messages?.join(" | "));
if (p) show(p);

// ------------------------------------------------ 4. gaya + zoom (Claude) lalu batalkan
const styleBefore = (await detail()).project.style;
({ sent, p } = await ask("ganti gayanya jadi tebal dan zoom pas aku bilang important", "claude"));
check("gaya + zoom selesai", p?.status === "done", p?.error ?? "");
if (p) show(p);
const styleAfter = (await detail()).project.style;
check("gaya berubah menjadi tebal", styleAfter.styleId === "tebal");
check("permintaan zoom tersimpan di gaya (detik mentah)", Array.isArray(styleAfter.cameraOverrides) && styleAfter.cameraOverrides.length >= 1 && styleAfter.cameraOverrides.every((o) => o.endS > o.startS && o.preset === "zoom-point"), JSON.stringify(styleAfter.cameraOverrides));
const styleRunId = p?.id;
check("perintah gaya bisa dibatalkan", p?.canUndo === true);
// pengguna mengubah gaya lagi SESUDAH perintah -> undo tidak boleh menimpa
await api("PUT", `/api/projects/${pid}/style`, { style: { ...styleAfter, styleId: "lembut" } });
let u = await api("POST", `/api/prompts/${styleRunId}/undo`);
check("undo setelah pengguna mengubah gaya: gaya TIDAK ditimpa", (await detail()).project.style.styleId === "lembut" && u.body.messages.some((m) => /DIBIARKAN/.test(m)), u.body.messages.join(" | "));
// undo kedua (sudah dibatalkan) ditolak
u = await api("POST", `/api/prompts/${styleRunId}/undo`);
check("undo kedua pada perintah yang sama ditolak (409)", u.status === 409, u.body.messages?.[0]);

// ------------------------------------------------ 5. undo usulan: yang sudah diputuskan dibiarkan
const pauseRun = (await api("GET", `/api/projects/${pid}/prompts`)).body.prompts.find((x) => x.createdSuggestions > 0 && !x.undone && /jeda/.test(x.prompt));
const pauseSugs = (await suggestions()).filter((s) => s.prompt_run_id === pauseRun?.id);
if (pauseSugs.length >= 2) {
  await api("PATCH", `/api/suggestions/${pauseSugs[0].id}`, { status: "approved" }); // pengguna menyetujui satu
  u = await api("POST", `/api/prompts/${pauseRun.id}/undo`);
  const left = (await suggestions()).filter((s) => s.prompt_run_id === pauseRun.id);
  check("undo usulan: yang sudah disetujui pengguna DIBIARKAN, sisanya dihapus", left.length === 1 && left[0].id === pauseSugs[0].id && left[0].status === "approved", `${u.body.messages.join(" | ")}`);
  await api("PATCH", `/api/suggestions/${pauseSugs[0].id}`, { status: "pending" });
} else console.log(`CATAT  undo usulan dilewati: hanya ${pauseSugs.length} usulan jeda`);

// ------------------------------------------------ 6. perbaiki kata + undo kata
({ sent, p } = await ask('ganti kata quickly menjadi fast', "claude"));
if (p) show(p);
const dWords = (await api("GET", `/api/transcripts/${(await detail()).transcript.id}`)).body.transcript;
check('fix_word: "quickly." -> "fast." di transkrip, hasil mesin tersimpan di original_words', p?.status === "done" && dWords.words.some((w) => w.text === "fast.") && dWords.original_words?.some((w) => w.text === "quickly."));
u = await api("POST", `/api/prompts/${p.id}/undo`);
const dWords2 = (await api("GET", `/api/transcripts/${(await detail()).transcript.id}`)).body.transcript;
check('undo kata: "fast." kembali "quickly."', dWords2.words.some((w) => w.text === "quickly.") && !dWords2.words.some((w) => w.text === "fast."), u.body.messages.join(" | "));
check("jumlah kata transkrip tidak berubah", dWords2.words.length === wordsBefore.length);

// ------------------------------------------------ 7. tidak didukung / pertanyaan
({ sent, p } = await ask("tambahkan musik latar yang santai", "claude"));
check("permintaan tak didukung: selesai, tanpa perubahan apa pun", p?.status === "done" && p.createdSuggestions === 0 && !p.canUndo, p?.reply);
if (p) show(p);

// ------------------------------------------------ 8. dua perintah bersamaan -> satu ditolak
const [x, y] = await Promise.all([api("POST", `/api/projects/${pid}/prompt`, { prompt: "berapa banyak usulan?", provider: "claude" }), api("POST", `/api/projects/${pid}/prompt`, { prompt: "matikan efek film", provider: "claude" })]);
const st = [x.status, y.status].sort();
check("dua perintah bersamaan: satu 201, satu 409", st[0] === 201 && st[1] === 409, st.join(","));
for (let i = 0; i < 60; i++) { const l = (await api("GET", `/api/projects/${pid}/prompts`)).body.prompts; if (!l.some((q) => ["queued", "running"].includes(q.status))) break; await sleep(1500); }
// validasi input
r = await api("POST", `/api/projects/${pid}/prompt`, { prompt: "   ", provider: "claude" });
check("perintah kosong ditolak (400)", r.status === 400);
r = await api("POST", `/api/projects/${pid}/prompt`, { prompt: "x".repeat(2001), provider: "claude" });
check("perintah >2000 karakter ditolak (400)", r.status === 400);
r = await api("POST", `/api/projects/${pid}/prompt`, { prompt: "halo", provider: "gpt" });
check("provider tidak valid ditolak (400)", r.status === 400);

// ------------------------------------------------ 9. persetujuan massal per perintah
const anyRun = (await api("GET", `/api/projects/${pid}/prompts`)).body.prompts.find((q) => q.createdSuggestions > 0 && !q.undone);
if (anyRun) {
  r = await api("POST", `/api/projects/${pid}/suggestions/bulk`, { promptRunId: anyRun.id, status: "approved" });
  const approved = (await suggestions()).filter((s) => s.prompt_run_id === anyRun.id && s.status === "approved");
  check("'Setujui semua dari perintah ini' hanya menyentuh usulan perintah itu", r.status === 200 && approved.length === r.body.changed && approved.length > 0, `${r.body.changed} disetujui`);
  await api("POST", `/api/projects/${pid}/suggestions/bulk`, { promptRunId: anyRun.id, status: "pending" });
}
r = await api("POST", `/api/projects/${pid}/suggestions/bulk`, { status: "approved" });
check("persetujuan massal tanpa cakupan ditolak (400): tidak ada 'setujui SEMUA'", r.status === 400);

// ------------------------------------------------ 10. render dari prompt (9:16)
const rjBefore = (await api("GET", `/api/projects/${pid}/export`)).body.outputs.length;
({ sent, p } = await ask("render yang 9:16", "claude"));
if (p) show(p);
check("render dari perintah: pesan menyebut hanya yang SUDAH disetujui diterapkan", p?.status === "done" && p.messages.some((m) => /Render dimulai/.test(m) && /SUDAH Anda setujui/.test(m)), p?.messages?.join(" | "));
let ex;
for (let i = 0; i < 200; i++) { ex = (await api("GET", `/api/projects/${pid}/export`)).body; if (ex.renderJob && ["done", "failed"].includes(ex.renderJob.status) && ex.outputs.length > rjBefore) break; await sleep(2000); }
check("render dari perintah selesai dan menghasilkan file 1080x1920", ex.renderJob?.status === "done" && ex.outputs[0]?.width === 1080 && ex.outputs[0]?.height === 1920, ex.renderJob?.error ?? `${ex.outputs[0]?.width}x${ex.outputs[0]?.height}`);

// ------------------------------------------------ penutup: aturan dan integritas
const final = await suggestions();
const promptSugs = final.filter((s) => s.prompt_run_id);
check("ATURAN 2: tidak ada usulan dari perintah yang disetujui tanpa tindakan pengguna", promptSugs.filter((s) => s.status === "approved").every((s) => new Date(s.updated_at) - new Date(s.created_at) > 5));
const sha = (await detail()).asset.sha256;
check("file mentah tidak tersentuh (checksum ada)", sha?.length === 64);
console.log(`\nRingkas: ${results.filter(Boolean).length}/${results.length} lolos`);
process.exit(results.every(Boolean) ? 0 : 1);
