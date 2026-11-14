// Pemeriksaan alamat sebelum server kita mengambil apa pun dari internet (link knowledge Fase 13, aset Opinion Motion Fase 19).
// Aman dari SSRF: hanya http(s) di port standar, semua alamat hasil DNS diperiksa (tolak jaringan lokal/internal). Hanya Node.
import { lookup } from "node:dns/promises";
import net from "node:net";

export function privateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v === "::" || v === "::1") return true;
  if (v.startsWith("::ffff:")) return privateIp(v.slice(7));
  return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(v);
}

export async function checkUrl(raw: string): Promise<URL> {
  let u: URL;
  try { u = new URL(raw); } catch { throw new Error("Link tidak valid."); }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("Hanya link http/https.");
  if (u.username || u.password) throw new Error("Link dengan nama pengguna/kata sandi tidak didukung.");
  if (u.port && !["80", "443"].includes(u.port)) throw new Error("Port tidak didukung.");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  const addrs = net.isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => { throw new Error("Alamat link tidak ditemukan."); });
  if (!addrs.length || addrs.some((a) => privateIp(a.address))) throw new Error("Link ke jaringan lokal/internal tidak diizinkan.");
  return u;
}
