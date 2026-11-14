import { z } from "zod";
import { REFERENCE } from "@app/config";

const startS = z.number().finite().min(0).max(REFERENCE.maxStartS).default(0);
export const ReferenceInput = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("upload"), id: z.string().uuid(), startS }),
  z.object({ kind: z.literal("link"), url: z.string().trim().min(1).max(2048), startS }),
]);
export type ReferenceInput = z.input<typeof ReferenceInput>;
export type ReferenceAttachment = { id: string; label: string; url?: string; startS: number };
export type ReferenceReport = { summary: string; limitations: string[]; sampledSeconds: number; frameCount: number; model: string | null };

/** Canonical video URLs only; strip tracking, playlist and redirect query parameters. */
export function referenceUrl(value: string): { url: string; platform: "YouTube" | "Instagram" | "TikTok" } {
  let u: URL;
  try { u = new URL(value.trim()); } catch { throw new Error("Tempel URL video lengkap dengan https://."); }
  if (u.protocol !== "https:" || u.username || u.password || u.port) throw new Error("Referensi harus berupa link HTTPS publik YouTube, Instagram, atau TikTok.");
  const host = u.hostname.toLowerCase();
  if (["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be", "www.youtu.be"].includes(host)) {
    const id = host.endsWith("youtu.be") ? u.pathname.slice(1) : u.pathname === "/watch" ? u.searchParams.get("v") : /^\/(?:shorts|live|embed)\/([^/]+)\/?$/.exec(u.pathname)?.[1];
    if (id && /^[\w-]{11}$/.test(id)) return { url: `https://www.youtube.com/watch?v=${id}`, platform: "YouTube" };
  }
  if (["instagram.com", "www.instagram.com"].includes(host)) {
    const match = /^\/(reel|reels|p)\/([\w-]{3,80})\/?$/.exec(u.pathname);
    if (match) return { url: `https://www.instagram.com/${match[1] === "p" ? "p" : "reel"}/${match[2]}/`, platform: "Instagram" };
  }
  if (["tiktok.com", "www.tiktok.com", "m.tiktok.com"].includes(host)) {
    const match = /^\/@([\w.-]{1,64})\/video\/(\d{5,25})\/?$/.exec(u.pathname);
    if (match) return { url: `https://www.tiktok.com/@${match[1]}/video/${match[2]}`, platform: "TikTok" };
    if (/^\/t\/[\w-]{5,80}\/?$/.test(u.pathname)) return { url: `https://www.tiktok.com${u.pathname}`, platform: "TikTok" };
  }
  if (["vm.tiktok.com", "vt.tiktok.com"].includes(host) && /^\/[\w-]{5,80}\/?$/.test(u.pathname)) return { url: `https://${host}${u.pathname}`, platform: "TikTok" };
  throw new Error("Gunakan link satu video YouTube/Shorts, Instagram Reel, atau TikTok; bukan profil, playlist, atau situs lain.");
}

/** Four short bursts reveal changes between adjacent frames as well as overall style. */
export function referenceSampleTimes(duration: number, start: number, tailMargin = 0.1): number[] {
  if (!Number.isFinite(duration) || !Number.isFinite(start) || duration <= 0 || start < 0 || start >= duration) throw new Error("Waktu awal referensi berada di luar durasi video.");
  const span = Math.min(REFERENCE.sampleSeconds, duration - start);
  const last = Math.max(0, span - Math.min(tailMargin, span / 2));
  const times = Array.from({ length: REFERENCE.frameCount }, (_, i) => {
    const burst = Math.floor(i / 4), step = i % 4;
    return start + Math.min(last, burst / 3 * Math.max(0, last - 0.6) + step * Math.min(0.2, last / 3));
  });
  return [...new Set(times.map((n) => Math.max(start, Math.min(start + last, Math.round(n * 1000) / 1000))))].sort((a, b) => a - b);
}
