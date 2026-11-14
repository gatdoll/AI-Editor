import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AnalyzerStatus, Provider } from "@app/shared";
import { isAllowedModel } from "@app/config";
import { QUOTA_PREFIX } from "@app/shared/errors";
import { CACHE_DIR } from "../storage.ts";
import { claudeStreamActivity, codexStreamActivity } from "../activity.ts";

/**
 * Pemanggilan CLI TANPA API key: memakai sesi login Claude Code / Codex yang sudah ada.
 * CLI dijalankan tanpa izin tool apa pun, di folder kosong; hanya teks masuk, JSON keluar.
 */

type Command = { cmd: string; prefixArgs: string[] };

/** Cari executable asli. Di Windows `claude`/`codex` hanya pembungkus .cmd yang tidak bisa di-spawn langsung. */
function resolveCli(name: "claude" | "codex"): Command {
  const override = process.env[`${name.toUpperCase()}_BIN`];
  if (override) return { cmd: override, prefixArgs: [] };
  if (process.platform !== "win32") return { cmd: name, prefixArgs: [] };

  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    const shim = path.join(dir, `${name}.cmd`);
    if (!existsSync(shim)) continue;
    const text = readFileSync(shim, "utf8");
    // Pembungkus bisa memuat beberapa "%dp0%\...": ambil yang terakhir yang ada di disk dan bukan node.exe.
    const targets = text
      .split("%dp0%\\")
      .slice(1)
      .map((part) => part.split('"')[0].trim())
      .filter((rel) => /\.(exe|js)$/i.test(rel))
      .map((rel) => path.join(dir, rel.replaceAll("\\", path.sep)))
      .filter((t) => existsSync(t) && path.basename(t).toLowerCase() !== "node.exe");
    const target = targets[targets.length - 1];
    if (!target) continue;
    return target.toLowerCase().endsWith(".js")
      ? { cmd: process.execPath, prefixArgs: [target] }
      : { cmd: target, prefixArgs: [] };
  }
  return { cmd: name, prefixArgs: [] };
}

const QUOTA_RE = /usage limit|rate.?limit|quota|too many requests|\b429\b|overloaded|credit balance|limit reached/i;

/** Beri awalan khusus bila teks error CLI menandakan batas pemakaian, agar UI dan logika coba-ulang tahu. */
function tagQuota(message: string): string {
  return QUOTA_RE.test(message) ? `${QUOTA_PREFIX} ${message}` : message;
}

type RunResult = { code: number | null; stdout: string; stderr: string; timedOut: boolean };

function run(
  command: Command,
  args: string[],
  opts: { stdin?: string; cwd?: string; timeoutMs: number; env?: NodeJS.ProcessEnv; signal?: AbortSignal; onLine?: (line: string) => void },
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    if (opts.signal?.aborted) return reject(opts.signal.reason instanceof Error ? opts.signal.reason : new Error("Dibatalkan"));
    const child = spawn(command.cmd, [...command.prefixArgs, ...args], {
      cwd: opts.cwd,
      env: opts.env,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, opts.timeoutMs);
    const onAbort = () => child.kill();
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    let pending = "";
    child.stdout.on("data", (d) => {
      stdout += d;
      if (!opts.onLine) return;
      pending += d;
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const l of lines) if (l.trim()) { try { opts.onLine(l); } catch { /* aktivitas hanya tampilan */ } }
    });
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (e) => {
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
      if (opts.signal?.aborted) return reject(opts.signal.reason instanceof Error ? opts.signal.reason : new Error("Dibatalkan"));
      resolve({ code, stdout, stderr, timedOut });
    });
    child.stdin.on("error", () => {}); // CLI bisa menutup stdin lebih dulu
    child.stdin.end(opts.stdin ?? "");
  });
}

async function emptyCwd(): Promise<string> {
  const dir = path.join(CACHE_DIR, "analyze-cwd");
  await mkdir(dir, { recursive: true });
  return dir;
}

export type ProviderResult = { json: unknown; model: string | null; usage: Record<string, unknown> };

/** Fase 19: riset aset boleh mencari web (hanya WebSearch/WebFetch; tanpa berkas, shell, atau MCP). */
type RunOpts = { web?: boolean; system?: string; signal?: AbortSignal; onActivity?: (text: string) => void };

/** Baris JSON stream -> aktivitas. Baris yang bukan JSON diabaikan. */
function lineHandler(onActivity: ((text: string) => void) | undefined, parse: (j: Record<string, unknown>) => string[]) {
  if (!onActivity) return undefined;
  return (l: string) => { let j: Record<string, unknown>; try { j = JSON.parse(l); } catch { return; } for (const a of parse(j)) onActivity(a); };
}

/** Keluaran Claude Code: satu JSON (--output-format json) atau baris stream-json yang diakhiri baris type=result. */
function claudeResult(stdout: string): Record<string, unknown> {
  const t = stdout.trim();
  try { return JSON.parse(t); } catch { /* stream */ }
  const lines = t.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    try { const j = JSON.parse(lines[i]); if (j?.type === "result") return j; } catch { /* lewati */ }
  }
  throw new Error("no result");
}
const STREAM_ARGS = ["--output-format", "stream-json", "--verbose"];
const WEB_TOOLS = ["WebSearch", "WebFetch"];

async function runClaude(prompt: string, schema: object, timeoutMs: number, images: string[] = [], model?: string, o: RunOpts = {}): Promise<ProviderResult> {
  const withImages = images.length > 0;
  const tools = o.web ? WEB_TOOLS : withImages ? ["Read"] : [];
  const args = [
    "-p",
    ...(o.onActivity ? STREAM_ARGS : ["--output-format", "json"]),
    "--json-schema", JSON.stringify(schema),
    // Gambar dibaca lewat tool Read (hanya baca) dari folder frame; tanpa gambar tidak ada tool sama sekali.
    "--tools", tools.join(","),
    ...(tools.length ? ["--allowedTools", ...tools, "--permission-mode", "dontAsk"] : []),
    "--no-session-persistence",
    "--strict-mcp-config",
    "--disable-slash-commands",
    "--no-chrome",
    "--setting-sources", "",
    "--system-prompt", o.system ?? "Kamu analis transkrip video. Jawab hanya sesuai skema JSON yang diminta.",
  ];
  const chosen = model || process.env.ANALYZER_CLAUDE_MODEL;
  if (chosen) args.push("--model", chosen);

  const fullPrompt = withImages
    ? `${prompt}\n\nGambar ada sebagai file di folder kerja. Baca SEMUA dengan tool Read, berurutan, sebelum menjawab:\n${images.map((f) => path.basename(f)).join("\n")}`
    : prompt;
  const r = await run(resolveCli("claude"), args, { stdin: fullPrompt, cwd: withImages ? path.dirname(images[0]) : await emptyCwd(), timeoutMs, signal: o.signal, onLine: lineHandler(o.onActivity, claudeStreamActivity), ...(o.web ? { env: agentEnv() } : {}) });
  if (r.timedOut) throw new Error("Claude Code CLI melewati batas waktu");
  let out: {
    is_error?: boolean;
    result?: string;
    structured_output?: unknown;
    usage?: Record<string, unknown>;
    modelUsage?: Record<string, unknown>;
  };
  try {
    out = claudeResult(r.stdout);
  } catch {
    throw new Error(tagQuota(`Claude Code CLI keluaran bukan JSON (kode ${r.code}): ${(r.stderr || r.stdout).slice(-400)}`));
  }
  if (out.is_error || out.structured_output == null) {
    throw new Error(tagQuota(`Claude Code CLI gagal: ${String(out.result ?? r.stderr).slice(0, 400)}`));
  }
  // Model utama = yang memproses paling banyak token masukan (model lain = panggilan sampingan kecil)
  type MU = { inputTokens?: number; cacheCreationInputTokens?: number; cacheReadInputTokens?: number };
  const load = (u: MU) => (u.inputTokens ?? 0) + (u.cacheCreationInputTokens ?? 0) + (u.cacheReadInputTokens ?? 0);
  const models = Object.entries(out.modelUsage ?? {}) as [string, MU][];
  models.sort((a, b) => load(b[1]) - load(a[1]));
  return { json: out.structured_output, model: models[0]?.[0] ?? null, usage: out.usage ?? {} };
}

async function runCodex(prompt: string, schema: object, timeoutMs: number, images: string[] = [], model?: string, o: RunOpts = {}): Promise<ProviderResult> {
  const dir = await emptyCwd();
  const id = Math.random().toString(36).slice(2);
  const schemaFile = path.join(dir, `schema-${id}.json`);
  const outFile = path.join(dir, `out-${id}.json`);
  await writeFile(schemaFile, JSON.stringify(schema));
  try {
    const args = [
      "exec",
      "--output-schema", schemaFile,
      "-o", outFile,
      "--skip-git-repo-check",
      "--ephemeral",
      "--ignore-user-config",
      "--ignore-rules",
      "-s", "read-only",
      "--color", "never",
      ...(o.onActivity ? ["--json"] : []),
    ];
    const chosen = model || process.env.ANALYZER_CODEX_MODEL;
    if (chosen) args.push("-m", chosen);
    if (o.web) {
      // Riset aset: pencarian web langsung, tanpa shell (uji 10 Nov 2026, codex-cli 0.163.0)
      args.push("--disable", "shell_tool", "--disable", "unified_exec", "-c", 'web_search="live"');
    } else if (images.length) {
      args.push("--disable", "shell_tool", "--disable", "unified_exec", "-c", 'web_search="disabled"');
      for (const image of images) args.push("--image", image);
    }
    args.push("-");

    const r = await run(resolveCli("codex"), args, { stdin: o.system ? `${o.system}\n\n${prompt}` : prompt, cwd: dir, timeoutMs, signal: o.signal, onLine: lineHandler(o.onActivity, codexStreamActivity), ...(o.web ? { env: agentEnv() } : {}) });
    if (r.timedOut) throw new Error("Codex CLI melewati batas waktu");
    if (r.code !== 0 || !existsSync(outFile)) {
      throw new Error(tagQuota(`Codex CLI gagal (kode ${r.code}): ${(r.stderr || r.stdout).slice(-400)}`));
    }
    const text = await readFile(outFile, "utf8");
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`Codex CLI keluaran bukan JSON: ${text.slice(0, 300)}`);
    }
    const tokens = /tokens used\s*\n?\s*([\d,]+)/i.exec(r.stdout + r.stderr)?.[1];
    // Mode --json: pemakaian token ada di baris turn.completed
    const turn = /"type":"turn\.completed","usage":\{"input_tokens":(\d+)[^}]*"output_tokens":(\d+)/.exec(r.stdout);
    return {
      json,
      model: chosen ?? "codex (bawaan akun)",
      usage: tokens ? { totalTokens: Number(tokens.replace(/,/g, "")) } : turn ? { totalTokens: Number(turn[1]) + Number(turn[2]) } : {},
    };
  } finally {
    await rm(schemaFile, { force: true });
    await rm(outFile, { force: true });
  }
}

export function runProvider(
  provider: Provider,
  prompt: string,
  schema: object,
  timeoutMs: number,
  images: string[] = [],
  model?: string,
): Promise<ProviderResult> {
  if (model && !isAllowedModel(provider, model)) throw new Error(`Model ${model} tidak ada di daftar yang diizinkan.`);
  return provider === "claude" ? runClaude(prompt, schema, timeoutMs, images, model) : runCodex(prompt, schema, timeoutMs, images, model);
}

/**
 * Fase 19: panggilan dengan pencarian web (riset aset Opinion Motion). Keluaran tetap JSON sesuai skema dan divalidasi
 * kode kita; CLI tidak bisa menulis berkas atau menjalankan perintah. Env tanpa rahasia project (`agentEnv`).
 */
export function runResearch(provider: Provider, a: { prompt: string; system: string; schema: object; timeoutMs: number; model?: string; signal?: AbortSignal; onActivity?: (text: string) => void }): Promise<ProviderResult> {
  if (a.model && !isAllowedModel(provider, a.model)) throw new Error(`Model ${a.model} tidak ada di daftar yang diizinkan.`);
  const o: RunOpts = { web: true, system: a.system, signal: a.signal, onActivity: a.onActivity };
  return provider === "claude" ? runClaude(a.prompt, a.schema, a.timeoutMs, [], a.model, o) : runCodex(a.prompt, a.schema, a.timeoutMs, [], a.model, o);
}

// ------------------------------------------------------------------ mode agen (Fase 9.2)

/** Tool agen: hanya baca/tulis berkas di folder kerja + skill. Tanpa Bash, tanpa jaringan, tanpa MCP. */
export const AGENT_TOOLS = ["Read", "Write", "Edit", "Glob", "Grep", "Skill"] as const;

/**
 * Argumen CLI mode agen. Setiap tool berkas dibatasi ke `./**` (folder kerja): tanpa batas ini Grep
 * terbukti bisa membaca berkas di luar folder kerja (uji 28 Okt 2026). Tool lain ditolak (`dontAsk`).
 */
export function agentArgs(opts: { model?: string; maxTurns: number; systemPrompt: string; stream?: boolean }): string[] {
  const scoped = AGENT_TOOLS.map((t) => (t === "Skill" ? t : `${t}(./**)`));
  return [
    "-p",
    ...(opts.stream ? STREAM_ARGS : ["--output-format", "json"]),
    "--tools", AGENT_TOOLS.join(","),
    "--allowedTools", ...scoped,
    "--permission-mode", "dontAsk",
    // Skill dibaca dari .claude/skills folder kerja; pengaturan pengguna/global tidak dimuat
    "--setting-sources", "project",
    "--no-session-persistence",
    "--strict-mcp-config",
    "--no-chrome",
    "--max-turns", String(opts.maxTurns),
    "--append-system-prompt", opts.systemPrompt,
    ...(opts.model ? ["--model", opts.model] : []),
  ];
}

/** Env untuk CLI agen: tanpa kunci Supabase/rahasia lain (agen tidak punya shell, ini lapisan tambahan). */
export function agentEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(env)) {
    // CLAUDE_* (mis. CLAUDE_CODE_OAUTH_TOKEN untuk worker Docker) adalah sesi login CLI itu sendiri: tetap diteruskan.
    // ANTHROPIC_API_KEY dibuang: CLI wajib memakai sesi login, bukan API key (aturan proyek)
    if (!/^CLAUDE_/i.test(k) && /SUPABASE|SERVICE_ROLE|SECRET|PASSWORD|TOKEN|DATABASE_URL|API_KEY/i.test(k)) continue;
    out[k] = v;
  }
  return out;
}

export type AgentResult = { text: string; model: string | null; usage: Record<string, unknown>; turns: number; denied: string[] };

/**
 * Jalankan Claude Code CLI sebagai agen di `cwd` (folder kerja sementara). Hanya Claude untuk saat ini:
 * skill berformat Claude Code (keputusan Fase 9 nomor 3).
 */
export async function runAgent(
  provider: Provider,
  a: { prompt: string; cwd: string; systemPrompt: string; timeoutMs: number; maxTurns: number; model?: string; signal?: AbortSignal; onActivity?: (text: string) => void },
): Promise<AgentResult> {
  if (provider !== "claude") throw new Error("Mode Kreatif saat ini hanya mendukung Claude Code CLI.");
  if (a.model && !isAllowedModel(provider, a.model)) throw new Error(`Model ${a.model} tidak ada di daftar yang diizinkan.`);
  const r = await run(resolveCli("claude"), agentArgs({ model: a.model, maxTurns: a.maxTurns, systemPrompt: a.systemPrompt, stream: !!a.onActivity }), {
    stdin: a.prompt,
    cwd: a.cwd,
    timeoutMs: a.timeoutMs,
    env: agentEnv(),
    signal: a.signal,
    onLine: lineHandler(a.onActivity, claudeStreamActivity),
  });
  if (r.timedOut) throw new Error("Claude Code CLI melewati batas waktu");
  let out: { is_error?: boolean; subtype?: string; result?: string; num_turns?: number; usage?: Record<string, unknown>; modelUsage?: Record<string, { inputTokens?: number; cacheReadInputTokens?: number; cacheCreationInputTokens?: number }>; permission_denials?: Array<{ tool_name?: string }> };
  try {
    out = claudeResult(r.stdout) as typeof out;
  } catch {
    throw new Error(tagQuota(`Claude Code CLI keluaran bukan JSON (kode ${r.code}): ${(r.stderr || r.stdout).slice(-400)}`));
  }
  // error_max_turns tetap dilanjutkan: berkas yang sudah ditulis divalidasi kode kita, bukan dipercaya dari teks
  if (out.is_error && out.subtype !== "error_max_turns") throw new Error(tagQuota(`Claude Code CLI gagal: ${String(out.result ?? r.stderr).slice(0, 400)}`));
  const load = (u: { inputTokens?: number; cacheReadInputTokens?: number; cacheCreationInputTokens?: number }) => (u.inputTokens ?? 0) + (u.cacheCreationInputTokens ?? 0) + (u.cacheReadInputTokens ?? 0);
  const models = Object.entries(out.modelUsage ?? {}).sort((x, y) => load(y[1]) - load(x[1]));
  return {
    text: String(out.result ?? ""),
    model: models[0]?.[0] ?? null,
    usage: out.usage ?? {},
    turns: Number(out.num_turns ?? 0),
    denied: (out.permission_denials ?? []).map((d) => String(d.tool_name ?? "?")),
  };
}

/** Periksa apakah CLI terpasang dan sudah login. Tidak memanggil model, jadi tidak memakai kuota. */
export async function checkProvider(provider: Provider): Promise<AnalyzerStatus> {
  try {
    const cli = resolveCli(provider);
    const v = await run(cli, ["--version"], { timeoutMs: 15000 });
    if (v.code !== 0) return { installed: false, loggedIn: false, detail: "CLI tidak terpasang atau tidak bisa dijalankan" };
    const version = v.stdout.trim().split("\n")[0];

    if (provider === "claude") {
      const a = await run(cli, ["auth", "status"], { timeoutMs: 15000 });
      try {
        const j = JSON.parse(a.stdout) as { loggedIn?: boolean; authMethod?: string };
        return j.loggedIn
          ? { installed: true, loggedIn: true, version, detail: `login: ${j.authMethod ?? "ok"}` }
          : { installed: true, loggedIn: false, version, detail: "Belum login. Jalankan `claude` lalu login." };
      } catch {
        return { installed: true, loggedIn: false, version, detail: "Status login tidak terbaca" };
      }
    }
    const a = await run(cli, ["login", "status"], { timeoutMs: 15000 });
    const text = (a.stdout + a.stderr).trim();
    return a.code === 0
      ? { installed: true, loggedIn: true, version, detail: text.split("\n")[0] }
      : { installed: true, loggedIn: false, version, detail: "Belum login. Jalankan `codex login`." };
  } catch (e) {
    return { installed: false, loggedIn: false, detail: e instanceof Error ? e.message : String(e) };
  }
}
