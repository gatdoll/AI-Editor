// Fase 13: ambil halaman web sebagai knowledge motion graphics. Dijalankan server kita, bukan agen AI (agen tanpa jaringan).
// Aman dari SSRF: hanya http(s), semua alamat hasil DNS diperiksa (tolak jaringan lokal/internal), redirect diperiksa ulang
// satu per satu, ukuran dan waktu dibatasi.
import { MOTION_GFX } from "@app/config";
import { checkUrl } from "@app/shared/safe-url";

// Dipindah ke paket shared (Fase 19: worker memakai pemeriksaan yang sama); diekspor ulang untuk pemakai lama
export { checkUrl, privateIp } from "@app/shared/safe-url";

const L = MOTION_GFX.knowledge.link;

const decode = (s: string) => s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));

/** HTML -> judul + teks bacaan (paragraf/judul dipertahankan sebagai baris, skrip/gaya/navigasi dibuang). */
export function htmlToText(html: string): { title: string; text: string } {
  const title = decode(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim() ?? "").replace(/\s+/g, " ");
  const body = html
    .replace(/<(script|style|noscript|svg|nav|footer|header|form|iframe)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(h[1-6])[^>]*>/gi, "\n\n## ").replace(/<\/(p|div|li|h[1-6]|tr|section|article|br)\s*>/gi, "\n").replace(/<br\s*\/?>/gi, "\n").replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<[^>]+>/g, " ");
  const text = decode(body).split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter((l) => !/^[-#\s]*$/.test(l)).join("\n").replace(/\n{3,}/g, "\n\n");
  return { title, text };
}

export type Fetched = { kind: "text"; title: string; text: string; url: string } | { kind: "pdf"; title: string; bytes: Buffer; url: string };

export async function fetchKnowledge(raw: string): Promise<Fetched> {
  let url = await checkUrl(raw.trim());
  for (let hop = 0; ; hop++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), L.timeoutMs);
    try {
      const res = await fetch(url, { redirect: "manual", signal: ctrl.signal, headers: { "user-agent": "EditingStudio/1.0 (knowledge motion graphics)", accept: "text/html,text/plain,text/markdown,application/pdf;q=0.9,*/*;q=0.1" } });
      if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
        if (hop >= L.maxRedirects) throw new Error("Terlalu banyak pengalihan.");
        url = await checkUrl(new URL(res.headers.get("location")!, url).href);
        continue;
      }
      if (!res.ok || !res.body) throw new Error(`Halaman tidak bisa diambil (HTTP ${res.status}).`);
      const type = (res.headers.get("content-type") ?? "").toLowerCase();
      const chunks: Uint8Array[] = [];
      let size = 0;
      const reader = res.body.getReader();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > (type.includes("pdf") ? MOTION_GFX.knowledge.maxPdfBytes : L.maxBytes)) { await reader.cancel(); throw new Error("Halaman terlalu besar."); }
        chunks.push(value);
      }
      const buf = Buffer.concat(chunks);
      const name = decodeURIComponent(url.pathname.split("/").pop() || url.hostname);
      if (type.includes("application/pdf")) return { kind: "pdf", title: name.endsWith(".pdf") ? name : `${name}.pdf`, bytes: buf, url: url.href };
      const body = buf.toString("utf8");
      if (type.includes("text/html") || /<html[\s>]/i.test(body.slice(0, 2000))) {
        const { title, text } = htmlToText(body);
        if (text.length < 80) throw new Error("Halaman hampir tidak berisi teks (mungkin butuh JavaScript atau login). Salin isinya ke file TXT, atau unggah PDF-nya.");
        return { kind: "text", title: title || url.hostname, text, url: url.href };
      }
      if (type.startsWith("text/")) return { kind: "text", title: name, text: body, url: url.href };
      throw new Error(`Jenis konten ${type || "tidak dikenal"} belum didukung. Pakai halaman web, teks, atau PDF.`);
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") throw new Error("Waktu mengambil halaman habis.");
      throw e;
    } finally { clearTimeout(timer); }
  }
}
