// Potret halaman aplikasi untuk memeriksa tampilan (Fase 20). Memakai chrome-headless-shell Remotion; Chrome sistem bisa
// menggantung saat headless bila jendela Chrome pengguna terbuka.
// npm run ui-shot -w @app/worker -- <url> <out.png> [lebar] [tinggi] [tunggu-ms]
import { writeFile } from "node:fs/promises";
import { launchBrowser } from "./opinion/browser.ts";

const [url, out, w = "1440", h = "900", wait = "6000"] = process.argv.slice(2);
if (!url || !out) { console.error("Pakai: ui-shot <url> <out.png> [lebar] [tinggi] [tunggu-ms]"); process.exit(1); }
const b = await launchBrowser();
try {
  const { targetId } = await b.cdp.send<{ targetId: string }>("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await b.cdp.send<{ sessionId: string }>("Target.attachToTarget", { targetId, flatten: true });
  await b.cdp.send("Page.enable", {}, sessionId);
  await b.cdp.send("Emulation.setDeviceMetricsOverride", { width: Number(w), height: Number(h), deviceScaleFactor: 1, mobile: false }, sessionId);
  const loaded = b.cdp.waitFor("Page.loadEventFired", sessionId, 90000);
  await b.cdp.send("Page.navigate", { url }, sessionId);
  await loaded;
  await new Promise((r) => setTimeout(r, Number(wait)));
  const s = await b.cdp.send<{ data: string }>("Page.captureScreenshot", { format: "png" }, sessionId);
  await writeFile(out, Buffer.from(s.data, "base64"));
  console.log(out);
} finally {
  await b.close();
}
