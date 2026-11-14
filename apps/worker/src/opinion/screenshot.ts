// Fase 19: screenshot artikel berita sesuai instruksi (judul, kutipan yang disorot, atau bagian atas halaman).
// Aturan 7: kutipan yang tidak ada di halaman TIDAK disorot di tempat lain; hasilnya ditandai "kutipan tidak ditemukan".
// Halaman terblokir (captcha, paywall, hampir kosong) = gagal dengan alasan, bukan diganti halaman lain.
import { writeFile } from "node:fs/promises";
import { OPINION } from "@app/config";
import { checkUrl } from "@app/shared/safe-url";
import type { ArticleFocus } from "@app/shared/opinion";
import type { Browser } from "./browser.ts";

const S = OPINION.screenshot;
const UA = {
  portrait: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
  landscape: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
};

export type ShotRequest = { url: string; fokus: ArticleFocus; kutipan?: string; sorot: boolean; title?: string; layout: "portrait" | "landscape" };
export type ShotResult = { width: number; height: number; finalUrl: string; pageTitle: string; publisher: string | null; date: string | null; kutipanDitemukan: boolean | null; catatan: string[] };

/**
 * Skrip yang dijalankan DI HALAMAN (string, bukan fungsi TS, agar tidak bergantung pada hasil transpile).
 * Mengembalikan area potong dalam koordinat dokumen, atau { error }.
 */
const PAGE_SCRIPT = String.raw`async (o) => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const norm = (s) => (s || "").normalize("NFKC").replace(/[‘’‚]/g, "'").replace(/[“”„]/g, '"').replace(/\s+/g, " ").trim().toLowerCase();
  const visible = (e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none"; };
  const text = (document.body && document.body.innerText) || "";
  if (/just a moment|captcha|access denied|attention required|verify you are human|are you a robot|akses ditolak/i.test(document.title + " " + text.slice(0, 600))) return { error: "Halaman meminta verifikasi (captcha/anti-bot)." };
  if (text.length < o.minText) return { error: "Halaman hampir tidak berisi teks (terblokir, paywall, atau butuh login)." };
  // Banner cookie/consent: klik tombol setuju di dalam kotak consent saja
  const btnRe = /^(setuju|saya setuju|terima|terima semua|accept|accept all|agree|i agree|ok|oke|mengerti|got it|allow all|izinkan|izinkan semua|lanjutkan)$/i;
  for (const b of document.querySelectorAll("button, a[role=button], [role=button]")) {
    const t = (b.innerText || "").trim();
    if (t.length < 30 && btnRe.test(t) && b.closest("[class*=cookie i],[id*=cookie i],[class*=consent i],[id*=consent i],[class*=gdpr i],[id*=gdpr i],[class*=cmp i],[id*=cmp i],[class*=privacy i]")) { try { b.click(); } catch (e) {} }
  }
  await sleep(500);
  // Lapisan tetap (header lengket, iklan melayang, modal) disembunyikan agar tidak menutupi isi
  for (const el of document.querySelectorAll("body *")) {
    const cs = getComputedStyle(el);
    if (cs.position === "fixed" || cs.position === "sticky") el.style.setProperty("display", "none", "important");
  }
  // Slot iklan yang umum (Google Ads, label "Advertisement"/"Iklan") disembunyikan
  for (const el of document.querySelectorAll("ins.adsbygoogle, iframe[src*='ads' i], iframe[id*='google_ads' i], [id^='div-gpt-ad'], [class*='advert' i], [id*='advert' i], [class~='ads'], [class*='ads-' i], [class*='-ads' i]")) el.style.setProperty("display", "none", "important");
  for (const el of document.querySelectorAll("div, span, p")) {
    if (el.children.length === 0 && /^(advertisement|iklan|ads|scroll to continue with content|scroll untuk melanjutkan)$/i.test((el.innerText || "").trim())) (el.parentElement || el).style.setProperty("display", "none", "important");
  }
  for (const el of [document.documentElement, document.body]) { el.style.setProperty("overflow", "visible", "important"); el.style.setProperty("height", "auto", "important"); }
  window.scrollTo(0, 0);
  await sleep(300);

  const meta = (sel) => { const m = document.querySelector(sel); return m ? m.getAttribute("content") : null; };
  const publisher = meta("meta[property='og:site_name']") || location.hostname.replace(/^www\./, "");
  const date = meta("meta[property='article:published_time']") || meta("meta[name='pubdate']") || meta("meta[name='publishdate']") || meta("meta[itemprop='datePublished']") || null;
  const h1s = [...document.querySelectorAll("h1")].filter(visible);
  const want = norm(o.title).slice(0, 40);
  const head = (want && h1s.find((h) => norm(h.innerText).includes(want))) || h1s[0] || null;
  const pageTitle = (head && head.innerText.trim()) || meta("meta[property='og:title']") || document.title;
  const notes = [];
  let found = null;
  let target = null;

  if (o.fokus === "kutipan" && o.kutipan) {
    const q = norm(o.kutipan);
    const cands = [...document.querySelectorAll("p, blockquote, li, h2, h3, td, figcaption, div, span")].filter((e) => visible(e) && norm(e.innerText).includes(q));
    cands.sort((a, b) => a.innerText.length - b.innerText.length);
    const el = cands[0] || null;
    found = !!el;
    if (el) {
      target = el;
      if (o.sorot) {
        // Petakan teks yang dinormalisasi kembali ke node teks asli, lalu sorot dengan CSS Custom Highlight
        const nodes = [];
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) nodes.push(walker.currentNode);
        let flat = "", map = [], prevSpace = true;
        nodes.forEach((n, ni) => {
          const v = n.nodeValue.normalize("NFKC");
          for (let i = 0; i < v.length; i++) {
            let c = v[i].replace(/[‘’‚]/, "'").replace(/[“”„]/, '"').toLowerCase();
            if (/\s/.test(c)) { if (prevSpace) continue; c = " "; prevSpace = true; } else prevSpace = false;
            flat += c; map.push([ni, i]);
          }
        });
        const at = flat.indexOf(q);
        if (at >= 0 && "highlights" in CSS) {
          const r = document.createRange();
          const [sn, so] = map[at], [en, eo] = map[at + q.length - 1];
          r.setStart(nodes[sn], so); r.setEnd(nodes[en], eo + 1);
          CSS.highlights.set("opini-kutipan", new Highlight(r));
          const st = document.createElement("style");
          st.textContent = "::highlight(opini-kutipan){background-color:" + o.hl.background + ";color:" + o.hl.color + ";}";
          document.head.appendChild(st);
        } else notes.push("Kutipan ditemukan, tetapi tidak bisa disorot.");
      }
    } else notes.push("Kutipan tidak ditemukan di halaman; screenshot memakai judul dan tidak ada yang disorot.");
  }
  await sleep(200);
  const W = document.documentElement.clientWidth;
  const docH = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
  let top, height;
  if (target) {
    const r = target.getBoundingClientRect();
    top = r.top + window.scrollY - o.pad - 140;
    height = r.height + 2 * o.pad + 280;
  } else if (o.fokus !== "atas" && head) {
    const r = head.getBoundingClientRect();
    top = r.top + window.scrollY - o.pad - 60;
    height = r.height + o.pad + 60 + o.extra;
  } else {
    if (o.fokus !== "atas") notes.push("Judul artikel (h1) tidak ditemukan; memakai bagian atas halaman.");
    top = 0; height = o.vh;
  }
  top = Math.max(0, Math.round(top));
  height = Math.round(Math.max(300, Math.min(o.maxH, height, docH - top)));
  // Lebar: kolom artikel (tanpa sidebar) bila jelas lebih sempit dari halaman
  let x = 0, width = W;
  const anchor = target || head;
  if (anchor) {
    let col = anchor.closest("article");
    for (let e = anchor.parentElement; !col && e && e !== document.body; e = e.parentElement) {
      const w = e.getBoundingClientRect().width;
      if (w >= W * 0.45 && w <= W * 0.85) col = e;
    }
    if (col) {
      const r = col.getBoundingClientRect();
      if (r.width < W * 0.9) { x = Math.max(0, Math.round(r.left - o.pad)); width = Math.round(Math.min(W - x, r.width + 2 * o.pad)); }
    }
  }
  return { clip: { x, y: top, width, height }, pageTitle, publisher, date, found, notes, finalUrl: location.href };
}`;

type PageOut = { error?: string; clip: { x: number; y: number; width: number; height: number }; pageTitle: string; publisher: string | null; date: string | null; found: boolean | null; notes: string[]; finalUrl: string };

/** Buka artikel di tab baru, siapkan sesuai instruksi, simpan PNG ke `outFile`. Gagal = Error dengan alasan yang bisa ditampilkan. */
export async function screenshotArticle(browser: Browser, req: ShotRequest, outFile: string, check: (u: string) => Promise<URL> = checkUrl): Promise<ShotResult> {
  await check(req.url);
  const vp = S.viewport[req.layout];
  const { cdp } = browser;
  const { targetId } = await cdp.send<{ targetId: string }>("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await cdp.send<{ sessionId: string }>("Target.attachToTarget", { targetId, flatten: true });
  try {
    await cdp.send("Page.enable", {}, sessionId);
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: vp.width, height: vp.height, deviceScaleFactor: vp.scale, mobile: req.layout === "portrait" }, sessionId);
    await cdp.send("Network.enable", {}, sessionId);
    await cdp.send("Network.setUserAgentOverride", { userAgent: UA[req.layout], acceptLanguage: "id-ID,id;q=0.9,en;q=0.8" }, sessionId);
    const loaded = cdp.waitFor("Page.loadEventFired", sessionId, S.navTimeoutMs);
    const nav = await cdp.send<{ errorText?: string }>("Page.navigate", { url: req.url }, sessionId);
    if (nav.errorText) throw new Error(`Halaman tidak bisa dibuka (${nav.errorText}).`);
    await loaded; // lewat batas waktu tetap dilanjutkan: banyak situs berita tidak pernah "selesai" memuat iklan
    await new Promise((r) => setTimeout(r, S.settleMs));
    const ev = await cdp.send<{ result: { value?: PageOut }; exceptionDetails?: { text?: string } }>("Runtime.evaluate", {
      expression: `(${PAGE_SCRIPT})(${JSON.stringify({ fokus: req.fokus, kutipan: req.kutipan ?? "", sorot: req.sorot, title: req.title ?? "", hl: S.highlight, pad: S.padding, extra: S.headlineExtra, maxH: S.maxClipHeight, minText: S.minTextChars, vh: vp.height })})`,
      awaitPromise: true, returnByValue: true,
    }, sessionId);
    const out = ev.result?.value;
    if (!out) throw new Error(`Halaman tidak bisa diproses${ev.exceptionDetails?.text ? ` (${ev.exceptionDetails.text})` : ""}.`);
    if (out.error) throw new Error(out.error);
    // Halaman bisa berpindah (redirect) ke alamat lain: alamat akhir diperiksa lagi
    await check(out.finalUrl);
    const shot = await cdp.send<{ data: string }>("Page.captureScreenshot", { format: "png", clip: { ...out.clip, scale: 1 }, captureBeyondViewport: true, fromSurface: true }, sessionId);
    await writeFile(outFile, Buffer.from(shot.data, "base64"));
    return {
      width: Math.round(out.clip.width * vp.scale), height: Math.round(out.clip.height * vp.scale), finalUrl: out.finalUrl,
      pageTitle: String(out.pageTitle ?? "").replace(/\s+/g, " ").trim().slice(0, 300), publisher: out.publisher, date: out.date,
      kutipanDitemukan: req.fokus === "kutipan" && req.kutipan ? out.found === true : null, catatan: out.notes ?? [],
    };
  } finally {
    await cdp.send("Target.closeTarget", { targetId }).catch(() => {});
  }
}
