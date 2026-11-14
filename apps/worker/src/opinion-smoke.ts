// Fase 19: uji nyata tanpa database.
//   Screenshot saja:  npm run opinion-smoke -w @app/worker -- <url> [judul|kutipan|atas] ["kutipan"] [portrait|landscape]
//   Riset penuh:      npm run opinion-smoke -w @app/worker -- --riset "<naskah opini>" [claude|codex] [model]
// Riset memakai CLI sungguhan (kuota) dan internet; waktu kata dibuat rata dari naskah (bukan Whisper). Hasil di
// .cache/opinion-smoke dan folder media projects/_smoke-opini (dihapus otomatis bila OPINION_SMOKE_KEEP tidak diisi).
import path from "node:path";
import { mkdir, rm } from "node:fs/promises";
import { OPINION } from "@app/config";
import { resolveMediaPath, type Provider } from "@app/shared";
import { checkResearch, RESEARCH_JSON_SCHEMA, type ArticleFocus } from "@app/shared/opinion";
import { opinionRel } from "@app/shared/opinion-store";
import { runResearch } from "./analyze/providers.ts";
import { launchBrowser, type Browser } from "./opinion/browser.ts";
import { gather } from "./opinion/handler.ts";
import { fullResearchPrompt, RESEARCH_SYSTEM } from "./opinion/research.ts";
import { screenshotArticle } from "./opinion/screenshot.ts";

const args = process.argv.slice(2);
const outDir = path.resolve(".cache/opinion-smoke");
await mkdir(outDir, { recursive: true });

if (args[0] === "--riset") {
  const script = args[1] ?? "";
  const provider = (args[2] === "codex" ? "codex" : "claude") as Provider;
  const model = args[3] ?? (OPINION.defaultModel[provider] || undefined);
  if (!script.trim()) { console.error("Pakai: opinion-smoke --riset \"<naskah>\" [claude|codex] [model]"); process.exit(1); }
  const words = script.split(/\s+/).filter(Boolean).map((t, i) => ({ text: t, start: i * 0.4, end: i * 0.4 + 0.35 }));
  const t0 = Date.now();
  const res = await runResearch(provider, { system: RESEARCH_SYSTEM, prompt: fullResearchPrompt({ script, words }), schema: RESEARCH_JSON_SCHEMA, timeoutMs: OPINION.researchTimeoutMs, model });
  const checked = checkResearch(res.json, words);
  console.log(`riset ${provider} (${res.model ?? "?"}) ${Math.round((Date.now() - t0) / 1000)} dtk: ${checked.mentions.length} sebutan, dibuang ${checked.dropped.length}`);
  for (const d of checked.dropped) console.log("  dibuang:", d);
  if (checked.catatan) console.log("  catatan AI:", checked.catatan);
  const projectId = "_smoke-opini";
  let browser: Browser | null = null;
  const ctrl = new AbortController();
  try {
    for (const [i, m] of checked.mentions.entries()) {
      const cands = await gather({ projectId, mentionId: `m${i + 1}`, r: m, layout: "portrait", getBrowser: async () => (browser ??= await launchBrowser()), signal: ctrl.signal });
      console.log(`\n[${m.type}] ${m.label} @ kata ${m.wordStart}-${m.wordEnd} "${m.context}"`);
      if (m.article) console.log(`  artikel: ${m.article.url} (fokus ${m.article.fokus}${m.article.kutipan ? `, kutipan "${m.article.kutipan}"` : ""})`);
      for (const c of cands) console.log(c.error ? `  ✗ ${c.source}: ${c.error}` : `  ✓ ${c.kind} ${c.width}×${c.height} ${c.source} -> ${resolveMediaPath(c.file!)}${c.article ? ` | judul halaman: "${c.article.title}" | kutipan ditemukan: ${c.article.kutipanDitemukan}` : ""}`);
    }
  } finally {
    if (browser) await (browser as Browser).close();
    if (!process.env.OPINION_SMOKE_KEEP) await rm(resolveMediaPath(opinionRel(projectId)), { recursive: true, force: true });
  }
} else {
  const [url, fokus = "judul", kutipan, layout = "portrait"] = args;
  if (!url) { console.error("Pakai: opinion-smoke <url> [judul|kutipan|atas] [kutipan] [portrait|landscape]"); process.exit(1); }
  const out = path.join(outDir, `shot-${fokus}-${layout}-${Date.now()}.png`);
  const browser = await launchBrowser();
  try {
    const t0 = Date.now();
    const r = await screenshotArticle(browser, { url, fokus: fokus as ArticleFocus, kutipan, sorot: !!kutipan, layout: layout as "portrait" | "landscape" }, out);
    console.log(JSON.stringify({ ...r, file: out, ms: Date.now() - t0 }, null, 1));
  } catch (e) {
    console.error("GAGAL:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}
