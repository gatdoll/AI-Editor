// Fase 19: Chrome headless untuk screenshot artikel. Memakai chrome-headless-shell yang sudah diunduh Remotion
// (tidak memasang browser kedua) dan dikendalikan lewat Chrome DevTools Protocol dengan WebSocket bawaan Node.
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);

/** Lokasi chrome-headless-shell: env OPINION_CHROME > unduhan Remotion (node_modules/.remotion). */
export function findChrome(): string {
  const override = process.env.OPINION_CHROME;
  if (override) return override;
  const roots: string[] = [];
  try { roots.push(path.join(path.dirname(require.resolve("@remotion/renderer/package.json")), "..", "..", ".remotion", "chrome-headless-shell")); } catch { /* tidak terpasang */ }
  roots.push(path.resolve("node_modules/.remotion/chrome-headless-shell"), path.resolve("../../node_modules/.remotion/chrome-headless-shell"));
  const exe = process.platform === "win32" ? "chrome-headless-shell.exe" : "chrome-headless-shell";
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const plat of readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory())) {
      const dir = path.join(root, plat.name);
      const direct = path.join(dir, exe);
      if (existsSync(direct)) return direct;
      for (const sub of readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory())) {
        const p = path.join(dir, sub.name, exe);
        if (existsSync(p)) return p;
      }
    }
  }
  throw new Error("chrome-headless-shell tidak ditemukan. Jalankan satu render Remotion dulu (browser diunduh otomatis), atau isi OPINION_CHROME.");
}

type Pending = { resolve: (v: Record<string, unknown>) => void; reject: (e: Error) => void };
type Listener = (params: Record<string, unknown>, sessionId?: string) => void;

/** Klien CDP minimal: perintah dengan id, event per nama. Satu koneksi ke browser, halaman lewat sessionId (flatten). */
export class Cdp {
  private id = 0;
  private pending = new Map<number, Pending>();
  private listeners = new Map<string, Set<Listener>>();
  private ws: WebSocket;
  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(String(ev.data)) as { id?: number; result?: Record<string, unknown>; error?: { message: string }; method?: string; params?: Record<string, unknown>; sessionId?: string };
      if (msg.id !== undefined) {
        const p = this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id);
        if (msg.error) p.reject(new Error(msg.error.message)); else p.resolve(msg.result ?? {});
      } else if (msg.method) {
        for (const l of this.listeners.get(msg.method) ?? []) l(msg.params ?? {}, msg.sessionId);
      }
    });
    ws.addEventListener("close", () => {
      for (const p of this.pending.values()) p.reject(new Error("Koneksi browser terputus"));
      this.pending.clear();
    });
  }
  static connect(url: string): Promise<Cdp> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      ws.addEventListener("open", () => resolve(new Cdp(ws)), { once: true });
      ws.addEventListener("error", () => reject(new Error("Tidak bisa terhubung ke browser")), { once: true });
    });
  }
  send<T = Record<string, unknown>>(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<T> {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as Pending["resolve"], reject });
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
  /** Tunggu satu event (opsional untuk sesi tertentu). Lewat batas waktu = false, bukan error. */
  waitFor(method: string, sessionId: string | undefined, timeoutMs: number): Promise<boolean> {
    return new Promise((resolve) => {
      const set = this.listeners.get(method) ?? new Set<Listener>();
      this.listeners.set(method, set);
      const done = (ok: boolean) => { clearTimeout(timer); set.delete(l); resolve(ok); };
      const l: Listener = (_p, sid) => { if (!sessionId || sid === sessionId) done(true); };
      const timer = setTimeout(() => done(false), timeoutMs);
      set.add(l);
    });
  }
  close() { try { this.ws.close(); } catch { /* sudah tertutup */ } }
}

export type Browser = { cdp: Cdp; close: () => Promise<void> };

/** Jalankan chrome-headless-shell dengan profil sementara. Wajib ditutup (`close`). */
export async function launchBrowser(): Promise<Browser> {
  const exe = findChrome();
  const profile = await mkdtemp(path.join(os.tmpdir(), "opini-chrome-"));
  const args = [
    "--headless", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check",
    "--hide-scrollbars", "--mute-audio", "--disable-gpu", "--disable-extensions", "--disable-background-networking", "--disable-dev-shm-usage",
    // Di Docker worker berjalan sebagai root: sandbox Chrome tidak bisa dipakai
    ...(typeof process.getuid === "function" && process.getuid() === 0 ? ["--no-sandbox"] : []),
    "about:blank",
  ];
  const child: ChildProcess = spawn(exe, args, { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
  const wsUrl = await new Promise<string>((resolve, reject) => {
    let buf = "";
    const timer = setTimeout(() => reject(new Error("Browser tidak siap dalam 20 detik")), 20000);
    child.stderr!.on("data", (d) => {
      buf += d;
      const m = /DevTools listening on (ws:\/\/\S+)/.exec(buf);
      if (m) { clearTimeout(timer); resolve(m[1]); }
    });
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("exit", (code) => { clearTimeout(timer); reject(new Error(`Browser berhenti (kode ${code}): ${buf.slice(-300)}`)); });
  });
  const cdp = await Cdp.connect(wsUrl);
  return {
    cdp,
    close: async () => {
      cdp.close();
      child.kill();
      await new Promise((r) => setTimeout(r, 300));
      await rm(profile, { recursive: true, force: true }).catch(() => {});
    },
  };
}
