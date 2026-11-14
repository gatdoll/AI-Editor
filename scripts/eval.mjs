// Ukur kualitas deteksi cut terhadap label buatan manusia.
//   node scripts/eval.mjs <projectId> <labels.json> [--json]
//
// Format labels.json (waktu dalam DETIK pada video MENTAH, boleh dibaca dari transkrip di layar project):
// {
//   "cuts":  [ { "start": 12.3, "end": 15.0, "kind": "retake", "note": "take pertama kalimat pembuka" } ],
//   "keep":  [ { "start": 40.1, "end": 42.0, "note": "pengulangan sengaja untuk penekanan" } ]
// }
// "kind" opsional: retake | correction | filler | pause. "cuts" = bagian yang SEHARUSNYA dipotong.
// "keep"  = bagian yang TIDAK boleh diusulkan dipotong (mis. pengulangan sengaja).
//
// Tiap analisis (run) dinilai sendiri, sehingga Claude Code CLI dan Codex CLI bisa dibandingkan pada video yang sama.
// Kecocokan: usulan dan label saling tumpang tindih >= 50% dari panjang yang LEBIH PENDEK dari keduanya, dan usulan
// tidak lebih dari 3x panjang label (usulan raksasa yang kebetulan menutup label tidak dihitung benar).
// CATATAN: angka dari sedikit label tidak berarti apa-apa secara statistik. Lihat jumlahnya (n) di setiap baris.
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const [projectId, labelsFile] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const asJson = process.argv.includes("--json");
if (!projectId || !labelsFile) {
  console.error("Pemakaian: node scripts/eval.mjs <projectId> <labels.json> [--json]");
  process.exit(2);
}
const env = Object.fromEntries(fs.readFileSync(path.join(process.cwd(), ".env"), "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).trim()]; }));
const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// ---------------------------------------------------------------- label
const labels = JSON.parse(fs.readFileSync(labelsFile, "utf8"));
const cuts = labels.cuts ?? [];
const keep = labels.keep ?? [];
for (const l of [...cuts, ...keep]) if (!(l.end > l.start)) throw new Error(`Label tidak valid (akhir <= awal): ${JSON.stringify(l)}`);

const overlap = (a, b) => Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
const len = (x) => x.end - x.start;
/** Cocok bila tumpang tindih >= 50% dari yang lebih pendek DAN usulan tidak > 3x label. */
function matches(sug, label) {
  const ov = overlap({ start: Number(sug.start_s), end: Number(sug.end_s) }, label);
  const s = { start: Number(sug.start_s), end: Number(sug.end_s) };
  return ov >= 0.5 * Math.min(len(s), len(label)) && len(s) <= 3 * len(label);
}
const pct = (n, d) => (d === 0 ? "n/a" : `${((n / d) * 100).toFixed(0)}%`);

// ---------------------------------------------------------------- data
const { data: runs } = await db.from("analysis_runs").select("*").eq("project_id", projectId).eq("status", "done").order("created_at");
if (!runs?.length) { console.error("Project ini belum punya analisis yang selesai."); process.exit(1); }

const report = [];
for (const run of runs) {
  const { data: sugs } = await db.from("cut_suggestions").select("*").eq("run_id", run.id);
  // Jeda dan "tidak bisa dinilai" dinilai terpisah: jeda bukan retake, dan unclear memang bukan usulan potong
  const cand = (sugs ?? []).filter((s) => s.kind !== "unclear");
  const llmOrRule = cand.filter((s) => s.kind !== "pause");
  const pauses = cand.filter((s) => s.kind === "pause");

  const perLabel = cuts.map((l) => {
    const pool = l.kind === "pause" ? pauses : l.kind ? cand.filter((s) => s.kind === l.kind) : cand;
    const hit = pool.filter((s) => matches(s, l)).sort((a, b) => overlap({ start: +b.start_s, end: +b.end_s }, l) - overlap({ start: +a.start_s, end: +a.end_s }, l))[0];
    return { label: l, hit };
  });
  const found = perLabel.filter((x) => x.hit);
  const errs = found.flatMap((x) => [Math.abs(+x.hit.start_s - x.label.start), Math.abs(+x.hit.end_s - x.label.end)]);

  // Presisi: usulan non-jeda yang menutupi label (jenis apa pun) dibanding semua usulan non-jeda
  const goodSug = llmOrRule.filter((s) => cuts.some((l) => matches(s, l)));
  const falseSug = llmOrRule.filter((s) => !cuts.some((l) => matches(s, l)));
  const keepViolations = keep.map((k) => ({ keep: k, bad: cand.filter((s) => s.kind !== "pause" && overlap({ start: +s.start_s, end: +s.end_s }, k) > 0.2 * len(k)) })).filter((x) => x.bad.length);

  const byKind = {};
  for (const k of ["retake", "correction", "filler", "pause"]) {
    const ls = cuts.filter((l) => l.kind === k);
    if (ls.length) byKind[k] = { n: ls.length, found: perLabel.filter((x) => x.label.kind === k && x.hit).length };
  }

  report.push({
    runId: run.id, provider: run.provider, model: run.model, durationMs: run.duration_ms, suggestions: sugs?.length ?? 0,
    recall: { found: found.length, n: cuts.length }, byKind,
    precision: { good: goodSug.length, n: llmOrRule.length },
    meanBoundaryErrorSec: errs.length ? errs.reduce((a, b) => a + b, 0) / errs.length : null,
    keepViolations: keepViolations.length, keepN: keep.length,
    missed: perLabel.filter((x) => !x.hit).map((x) => x.label),
    falsePositives: falseSug.map((s) => ({ kind: s.kind, start: +s.start_s, end: +s.end_s, quote: s.quote })),
    keepViolationsDetail: keepViolations.map((x) => ({ keep: x.keep, suggestions: x.bad.map((s) => ({ kind: s.kind, start: +s.start_s, end: +s.end_s, quote: s.quote })) })),
  });
}

if (asJson) { console.log(JSON.stringify(report, null, 2)); process.exit(0); }

console.log(`Project ${projectId}: ${cuts.length} label potong, ${keep.length} label "jangan potong", ${runs.length} analisis\n`);
for (const r of report) {
  console.log(`=== ${r.provider} (${r.model ?? "?"}) · ${((r.durationMs ?? 0) / 1000).toFixed(1)} dtk · ${r.suggestions} usulan · run ${r.runId.slice(0, 8)}`);
  console.log(`  Recall   : ${r.recall.found}/${r.recall.n} = ${pct(r.recall.found, r.recall.n)}   (label potong yang ditemukan)`);
  for (const [k, v] of Object.entries(r.byKind)) console.log(`     - ${k}: ${v.found}/${v.n}`);
  console.log(`  Presisi  : ${r.precision.good}/${r.precision.n} = ${pct(r.precision.good, r.precision.n)}   (usulan non-jeda yang cocok label)`);
  console.log(`  Salah potong pada bagian "keep": ${r.keepViolations}/${r.keepN}`);
  console.log(`  Galat batas rata-rata: ${r.meanBoundaryErrorSec == null ? "n/a" : r.meanBoundaryErrorSec.toFixed(2) + " dtk"}`);
  if (r.missed.length) { console.log("  Terlewat:"); for (const m of r.missed) console.log(`     - ${m.start}-${m.end} ${m.kind ?? ""} ${m.note ?? ""}`); }
  if (r.falsePositives.length) { console.log("  Usulan yang tidak ada di label (bisa salah, bisa label yang kurang):"); for (const f of r.falsePositives) console.log(`     - ${f.kind} ${f.start.toFixed(2)}-${f.end.toFixed(2)} "${(f.quote ?? "").slice(0, 60)}"`); }
  if (r.keepViolationsDetail.length) { console.log("  PELANGGARAN bagian yang harus dipertahankan:"); for (const v of r.keepViolationsDetail) console.log(`     - ${v.keep.start}-${v.keep.end} ${v.keep.note ?? ""} <- ${v.suggestions.map((s) => `${s.kind} ${s.start.toFixed(2)}-${s.end.toFixed(2)}`).join(", ")}`); }
  console.log();
}
console.log(`Catatan: n kecil = angka tidak bermakna secara statistik. Jangan menetapkan target akurasi sebelum ada >= 5 video berlabel.`);
