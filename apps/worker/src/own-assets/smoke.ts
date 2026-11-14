// Uji cepat pencocokan aset sendiri dengan CLI sungguhan (tanpa database): npm run own-assets-smoke -w @app/worker -- [claude|codex]
import { OWN_ASSETS } from "@app/config";
import { checkPlacements, OWN_JSON_SCHEMA } from "@app/shared/own-assets";
import { runProvider } from "../analyze/providers.ts";
import { ownAssetsPrompt } from "./prompt.ts";

const provider = process.argv[2] === "codex" ? "codex" : "claude";
const text = "Halo teman-teman, hari ini aku mau bahas kenapa toko kecil susah naik kelas. Pertama soal harga. Botol tumbler hijau kami dulu dijual tiga puluh ribu dan tidak laku. Setelah kemasan diganti dan harganya dinaikkan jadi empat puluh lima ribu, omzet bulan lalu malah naik dua kali lipat. Kedua soal tempat. Kami pindah dari pasar ke ruko dekat kampus. Terakhir, follow akun ini untuk tips berikutnya.";
const words = text.split(/\s+/).map((t, i) => ({ text: t, start: i * 0.42, end: i * 0.42 + 0.36 }));
const assets = [
  { key: "a1", name: "IMG_2041.jpg", note: "foto produk tumbler hijau dengan kemasan baru", role: "gambar" as const },
  { key: "a2", name: "grafik.png", note: "grafik omzet naik dua kali lipat", role: "gambar" as const },
  { key: "a3", name: "ruko.jpg", note: "foto ruko baru di dekat kampus", role: "gambar" as const },
  { key: "a4", name: "IMG_9999.jpg", note: "", role: "gambar" as const },
];
const t0 = Date.now();
const res = await runProvider(provider, ownAssetsPrompt({ words, assets, occupied: [] }), OWN_JSON_SCHEMA, OWN_ASSETS.timeoutMs, [], OWN_ASSETS.defaultModel[provider] || undefined);
console.log(`${provider} ${Math.round((Date.now() - t0) / 1000)} dtk, model ${res.model}`);
const r = checkPlacements(res.json, words, new Map(assets.map((a) => [a.key, a.key])));
for (const a of assets) {
  const x = r.byAsset.get(a.key)!;
  console.log(`\n${a.key} ${a.note || "(tanpa keterangan)"}`);
  if (x.error) console.log(`  ✕ ${x.error}`);
  for (const o of x.options) console.log(`  ${o.startS.toFixed(1)}s "${words.slice(o.wordStart, o.wordEnd + 1).map((w) => w.text).join(" ")}" — ${o.alasan}`);
}
console.log("\ndibuang:", r.dropped, "\ncatatan:", r.catatan);
