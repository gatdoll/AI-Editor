// Mengubah operasi hasil terjemahan prompt (yang sudah divalidasi) menjadi perubahan nyata.
// Murni/deterministik: tidak memanggil AI dan tidak menyentuh database; handler yang menyimpan hasilnya.
// Aturan 2: perintah yang memotong hanya menghasilkan USULAN (status pending). Aturan 7: yang tidak ditemukan dilaporkan.
import { ANALYSIS, CAMERA, FX, MOTION, SFX, type AspectId } from "@app/config";
import { findSfx, normalizeCues, type SfxItem } from "@app/shared/sfx";
import type { Word } from "@app/shared";
import type { Op } from "@app/shared/ops";
import { expandToSentence, findPhrase } from "@app/shared/phrase";
import { coerceParam, PARAM_BY_ID } from "@app/shared/params";
import { pickKeywords } from "@app/shared/keywords";
import { applyWordFixes } from "@app/shared/subtitles";
import { normalizeStyle, type StyleChoice } from "../../../../packages/remotion/src/build-props.ts";
import { quoteOf, spanTimes } from "../analyze/detect.ts";
import type { Silence } from "../media.ts";

export type NewSuggestion = {
  kind: "custom" | "pause";
  source: "prompt" | "silence";
  start_s: number;
  end_s: number;
  orig_start_s: number;
  orig_end_s: number;
  start_word: number | null;
  end_word: number | null;
  reason: string;
  quote: string | null;
};

export type WordFix = { index: number; before: string; after: string };

export type Effects = {
  suggestions: NewSuggestion[];
  /** Gaya baru lengkap bila berubah, selain itu null. */
  style: StyleChoice | null;
  wordFixes: WordFix[];
  render: { aspect?: AspectId } | null;
  undo: boolean;
  /** Hasil nyata tiap operasi, ditulis oleh kode ini (bukan oleh AI). */
  messages: string[];
};

export type PromptCtx = {
  words: Word[];
  durationS: number;
  style: StyleChoice;
  /** Usulan yang sudah ada (apa pun statusnya) untuk menghindari duplikat. */
  existing: Array<{ start: number; end: number }>;
  getSilences: (minSec: number) => Promise<Silence[]>;
  /** Fase 14: pustaka SFX (bawaan + unggahan). */
  sfxLibrary?: SfxItem[];
};

const MAX_PROPOSALS_PER_OP = 200;

const overlapFrac = (a: { start: number; end: number }, b: { start: number; end: number }) => {
  const ov = Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
  return ov / Math.max(1e-9, Math.min(a.end - a.start, b.end - b.start));
};
const plural = (n: number, one: string) => `${n} ${one}`;

export async function planEffects(ops: Op[], ctx: PromptCtx): Promise<Effects> {
  const fx: Effects = { suggestions: [], style: null, wordFixes: [], render: null, undo: false, messages: [] };
  // Usulan baru juga tidak boleh duplikat satu sama lain (mis. dua operasi yang menyasar tempat yang sama)
  const taken: Array<{ start: number; end: number }> = [...ctx.existing];
  let style = ctx.style;
  // Salinan kata untuk perbaikan: pencarian frasa berikutnya melihat ejaan terbaru
  const words = ctx.words.map((w) => ({ ...w }));

  const addSuggestion = (s: NewSuggestion): "added" | "duplicate" => {
    const r = { start: s.start_s, end: s.end_s };
    if (taken.some((t) => overlapFrac(r, t) >= 0.5)) return "duplicate";
    taken.push(r);
    fx.suggestions.push(s);
    return "added";
  };

  for (const op of ops) {
    switch (op.type) {
      case "propose_cut_phrase": {
        const matches = findPhrase(words, op.phrase, { maxResults: MAX_PROPOSALS_PER_OP });
        if (matches.length === 0) {
          fx.messages.push(`Tidak menemukan "${op.phrase}" di transkrip, jadi tidak ada yang diusulkan. Cek ejaannya, atau koreksi transkrip dulu.`);
          break;
        }
        let added = 0, dup = 0, fuzzy = 0;
        const seen = new Set<string>();
        for (const m of matches) {
          const range = op.scope === "sentence" ? expandToSentence(words, m.startWord, m.endWord) : { startWord: m.startWord, endWord: m.endWord };
          const key = `${range.startWord}-${range.endWord}`;
          if (seen.has(key)) continue; // beberapa kemunculan dalam satu kalimat = satu usulan
          seen.add(key);
          const t = spanTimes(words, range.startWord, range.endWord);
          const res = addSuggestion({
            kind: "custom",
            source: "prompt",
            start_s: t.start,
            end_s: Math.min(t.end, ctx.durationS),
            orig_start_s: t.start,
            orig_end_s: Math.min(t.end, ctx.durationS),
            start_word: range.startWord,
            end_word: range.endWord,
            reason: op.reason ?? (op.scope === "sentence" ? `Permintaan Anda: hapus kalimat yang memuat "${op.phrase}"` : `Permintaan Anda: potong "${op.phrase}"`),
            quote: quoteOf(words, range.startWord, range.endWord),
          });
          if (res === "added") {
            added++;
            if (!m.exact) fuzzy++;
          } else dup++;
        }
        fx.messages.push(
          `"${op.phrase}": ${plural(added, "usulan potong baru")}${dup ? `, ${dup} sudah ada usulan di tempat itu` : ""}${fuzzy ? `, ${fuzzy} cocok dengan ejaan yang mirip (periksa)` : ""}${matches.length >= MAX_PROPOSALS_PER_OP ? ` (dibatasi ${MAX_PROPOSALS_PER_OP} tempat)` : ""}.`,
        );
        break;
      }

      case "propose_cut_time": {
        const start = Math.max(0, op.startS);
        const end = Math.min(op.endS, ctx.durationS);
        if (!(end > start)) {
          fx.messages.push(`Rentang ${op.startS}-${op.endS} dtk tidak valid untuk video ${ctx.durationS.toFixed(1)} dtk, tidak ada yang diusulkan.`);
          break;
        }
        const res = addSuggestion({
          kind: "custom", source: "prompt", start_s: start, end_s: end, orig_start_s: start, orig_end_s: end,
          start_word: null, end_word: null, reason: op.reason ?? `Permintaan Anda: potong ${start.toFixed(1)}-${end.toFixed(1)} dtk`, quote: null,
        });
        fx.messages.push(res === "added" ? `Mengusulkan potong ${start.toFixed(1)}-${end.toFixed(1)} dtk.` : `Sudah ada usulan di ${start.toFixed(1)}-${end.toFixed(1)} dtk, tidak ditambah.`);
        break;
      }

      case "propose_pauses": {
        const silences = await ctx.getSilences(op.minSec);
        const keep = (op.keepSec ?? ANALYSIS.keepPauseSec) / 2;
        let added = 0, dup = 0;
        for (const s of silences) {
          // pertahanan: hanya yang benar-benar lebih panjang dari ambang, dan tidak melewati durasi video
          if (s.end - s.start < op.minSec) continue;
          const start = s.start + keep;
          const end = Math.min(s.end - keep, ctx.durationS);
          if (end - start < 0.1) continue;
          const res = addSuggestion({
            kind: "pause", source: "silence", start_s: start, end_s: end, orig_start_s: start, orig_end_s: end,
            start_word: null, end_word: null,
            reason: `Jeda diam ${(s.end - s.start).toFixed(1)} dtk (permintaan Anda: jeda > ${op.minSec} dtk, disisakan ${((op.keepSec ?? ANALYSIS.keepPauseSec)).toFixed(1)} dtk)`,
            quote: null,
          });
          if (res === "added") added++; else dup++;
        }
        fx.messages.push(
          silences.length === 0
            ? `Tidak ada jeda diam lebih panjang dari ${op.minSec} dtk.`
            : `Jeda > ${op.minSec} dtk: ${plural(added, "usulan potong baru")}${dup ? `, ${dup} sudah ada usulan` : ""}.`,
        );
        break;
      }

      case "set_style": {
        const next = normalizeStyle({
          ...style,
          ...(op.styleId !== undefined ? { styleId: op.styleId } : {}),
          ...(op.aspect !== undefined ? { aspect: op.aspect } : {}),
          ...(op.camera !== undefined ? { camera: op.camera } : {}),
          ...(op.captions !== undefined ? { captions: op.captions } : {}),
          ...(op.effects !== undefined ? { effects: op.effects } : {}),
        });
        const changes: string[] = [];
        if (next.styleId !== style.styleId) changes.push(`gaya ${style.styleId} -> ${next.styleId}`);
        if (next.aspect !== style.aspect) changes.push(`rasio ${style.aspect} -> ${next.aspect}`);
        if (next.camera !== style.camera) changes.push(`kamera ${next.camera ? "dinyalakan" : "dimatikan"}`);
        if (next.captions !== style.captions) changes.push(`subtitle ${next.captions ? "dinyalakan" : "dimatikan"}`);
        if (next.effects !== style.effects) changes.push(`efek film ${next.effects ? "dinyalakan" : "dimatikan"}`);
        if (changes.length === 0) fx.messages.push("Pengaturan gaya sudah seperti itu, tidak ada yang berubah.");
        else {
          fx.messages.push(`Gaya diubah: ${changes.join(", ")}.`);
          style = next;
          fx.style = next;
        }
        break;
      }

      case "set_param": {
        const def = PARAM_BY_ID[op.paramId];
        if (!def) {
          fx.messages.push(`Pengaturan "${op.paramId}" tidak ada, tidak ada yang diubah.`);
          break;
        }
        const c = coerceParam(def, op.value);
        if (!c.ok) {
          fx.messages.push(`${def.label}: ${c.reason}. Tidak diubah.`);
          break;
        }
        if (style.params[op.paramId] === c.value) {
          fx.messages.push(`${def.label} sudah ${String(c.value)}, tidak ada yang berubah.`);
          break;
        }
        style = normalizeStyle({ ...style, params: { ...style.params, [op.paramId]: c.value } });
        fx.style = style;
        fx.messages.push(`${def.label} diatur ke ${String(c.value)}${def.unit ? " " + def.unit : ""}.${c.warning ? " Catatan: " + c.warning : ""}`);
        break;
      }

      case "reset_param": {
        const ids = op.paramId === "semua" ? Object.keys(style.params) : style.params[op.paramId] !== undefined ? [op.paramId] : [];
        if (op.paramId !== "semua" && !PARAM_BY_ID[op.paramId]) {
          fx.messages.push(`Pengaturan "${op.paramId}" tidak ada, tidak ada yang direset.`);
          break;
        }
        if (ids.length === 0) {
          fx.messages.push("Tidak ada pengaturan khusus yang perlu dikembalikan ke bawaan.");
          break;
        }
        const rest = { ...style.params };
        for (const id of ids) delete rest[id];
        style = normalizeStyle({ ...style, params: rest });
        fx.style = style;
        fx.messages.push(`${plural(ids.length, "pengaturan")} dikembalikan ke bawaan gaya.`);
        break;
      }

      case "camera_at": {
        const endS = Math.min(ctx.durationS, op.endS);
        if (endS <= op.startS) { fx.messages.push("Gerakan kamera di luar durasi video, tidak ditambahkan."); break; }
        const current = style.cameraOverrides;
        if (current.some((m) => m.startS === op.startS && m.endS === endS && m.preset === op.preset)) { fx.messages.push("Gerakan kamera pada rentang itu sudah ada."); break; }
        if (current.length >= CAMERA.overrideMax) { fx.messages.push(`Kamera tidak ditambahkan: maksimum ${CAMERA.overrideMax} arahan per video.`); break; }
        style = normalizeStyle({ ...style, camera: true, cameraOverrides: [...current, { startS: op.startS, endS, preset: op.preset }] });
        fx.style = style;
        fx.messages.push(`Arahan kamera ${op.preset} ditambahkan pada sumber ${op.startS}–${endS} dtk. Sambungan cut dan batas zoom tetap diikuti.`);
        break;
      }

      case "add_title": {
        const endS = Math.min(ctx.durationS, op.endS);
        if (endS <= op.startS) { fx.messages.push("Judul di luar durasi video, tidak ditambahkan."); break; }
        const current = style.titles ?? [];
        // Hook tanpa teks: ambil kata yang benar-benar diucapkan pada rentang itu (bukan karangan AI)
        let text = op.text;
        if (!text) {
          text = words.filter((w) => w.start >= op.startS - 0.05 && w.end <= endS + 0.05).slice(0, FX.hook.maxWords).map((w) => w.text.trim()).join(" ").slice(0, MOTION.title.maxChars).trim();
          if (!text) { fx.messages.push(`Tidak ada kata yang diucapkan pada ${op.startS}–${endS} dtk untuk judul hook, tidak ditambahkan.`); break; }
        }
        const title = { text, ...(op.subtext ? { subtext: op.subtext } : {}), startS: op.startS, endS, animation: op.animation, position: op.position };
        if (current.some((t) => t.text === title.text && t.startS === title.startS && t.endS === title.endS && t.animation === title.animation && t.position === title.position)) { fx.messages.push(`Judul "${text}" sudah ada pada rentang itu.`); break; }
        if (current.length >= MOTION.title.maxCount) { fx.messages.push(`Judul tidak ditambahkan: maksimum ${MOTION.title.maxCount} judul per video.`); break; }
        style = normalizeStyle({ ...style, titles: [...current, title] });
        fx.style = style;
        const kind = op.animation === "lower-third" ? "Lower third" : op.animation === "hook" ? "Judul hook" : "Judul";
        fx.messages.push(`${kind} "${text}"${op.subtext ? ` / "${op.subtext}"` : ""} ditambahkan pada sumber ${op.startS}–${endS} dtk${op.animation === "lower-third" ? "" : `, posisi ${op.position}`}, animasi ${op.animation}.`);
        break;
      }

      case "clear_titles": {
        const count = style.titles?.length ?? 0;
        if (count) { style = normalizeStyle({ ...style, titles: [] }); fx.style = style; }
        fx.messages.push(count ? `${count} judul motion dihapus.` : "Tidak ada judul motion untuk dihapus.");
        break;
      }

      case "add_sfx": {
        // Isyarat SFX gaya memakai waktu SUMBER (ikut bergeser bila cut berubah; isyarat di bagian yang dipotong tidak bunyi)
        const item = findSfx(ctx.sfxLibrary ?? [], op.sound);
        if (!item) {
          fx.messages.push(`Suara "${op.sound}" tidak ada di pustaka SFX, jadi tidak ditambahkan. Pilih dari daftar SFX atau unggah suaranya dulu.`);
          break;
        }
        let at: number[] = [];
        if (op.phrase) {
          const matches = findPhrase(words, op.phrase, { maxResults: SFX.maxPerPhrase });
          if (!matches.length) { fx.messages.push(`Tidak menemukan "${op.phrase}" di transkrip, jadi SFX ${item.name} tidak ditambahkan.`); break; }
          at = matches.map((m) => words[m.startWord].start);
        } else if (op.startS !== undefined) {
          if (op.startS > ctx.durationS) { fx.messages.push(`Waktu ${op.startS} dtk di luar video (${ctx.durationS.toFixed(1)} dtk), SFX ${item.name} tidak ditambahkan.`); break; }
          at = [op.startS];
        }
        const before = style.sfx?.cues ?? [];
        const merged = normalizeCues([...before, ...at.map((t) => ({ id: item.id, at: t, volume: op.volume ?? 1 }))], ctx.durationS);
        const added = merged.cues.length - before.length;
        style = normalizeStyle({ ...style, sfx: { cues: merged.cues, useCreative: style.sfx?.useCreative !== false } });
        fx.style = style;
        fx.messages.push(added > 0
          ? `SFX ${item.name}: ${plural(added, "isyarat")} ditambahkan${op.phrase ? ` di "${op.phrase}"` : ` di ${at[0].toFixed(2)} dtk`}${added < at.length ? ` (${at.length - added} dilewati: terlalu rapat dengan SFX lain atau batas ${SFX.maxCues})` : ""}.`
          : `SFX ${item.name} tidak ditambahkan: terlalu rapat dengan SFX lain atau sudah ${SFX.maxCues} isyarat.`);
        break;
      }

      case "clear_sfx": {
        const count = style.sfx?.cues.length ?? 0;
        style = normalizeStyle({ ...style, sfx: { cues: [], useCreative: false } });
        fx.style = style;
        fx.messages.push(`${count ? `${count} SFX dihapus` : "Tidak ada SFX edit untuk dihapus"}; SFX dari versi Mode Kreatif juga dimatikan (bisa dinyalakan lagi di panel SFX).`);
        break;
      }

      case "emphasize_phrase": {
        const matches = findPhrase(words, op.phrase, { maxResults: 12 });
        if (matches.length === 0) {
          fx.messages.push(`Tidak menemukan "${op.phrase}" di transkrip, jadi tidak ada zoom yang ditambahkan.`);
          break;
        }
        const current = [...style.cameraOverrides];
        let added = 0;
        for (const m of matches) {
          const req = {
            startS: Math.max(0, m.start - CAMERA.overrideLeadSec),
            endS: Math.min(ctx.durationS, m.end + CAMERA.overrideTailSec),
            preset: op.preset,
          };
          if (current.some((c) => c.preset === req.preset && overlapFrac({ start: c.startS, end: c.endS }, { start: req.startS, end: req.endS }) >= 0.5)) continue;
          current.push(req);
          added++;
        }
        if (added === 0) fx.messages.push(`Zoom untuk "${op.phrase}" sudah ada di semua tempatnya.`);
        else {
          style = normalizeStyle({ ...style, cameraOverrides: current });
          fx.style = style;
          const capped = style.cameraOverrides.length < current.length ? ` (dibatasi ${CAMERA.overrideMax} permintaan zoom per video)` : "";
          fx.messages.push(`Kamera ${op.preset} saat "${op.phrase}" diucapkan: ${plural(added, "tempat")}${capped}. Bila bagian itu terpotong, gerakannya ikut hilang.`);
        }
        break;
      }

      case "highlight_phrase": {
        const matches = findPhrase(words, op.phrase, { maxResults: FX.highlightMax });
        if (matches.length === 0) {
          fx.messages.push(`Tidak menemukan "${op.phrase}" di transkrip, jadi tidak ada kata kunci yang ditandai.`);
          break;
        }
        const current = [...(style.highlights ?? [])];
        let added = 0;
        for (const m of matches) {
          const req = { startS: m.start, endS: m.end, effect: op.effect };
          const same = current.findIndex((c) => overlapFrac({ start: c.startS, end: c.endS }, { start: req.startS, end: req.endS }) >= 0.5);
          if (same >= 0) { if (current[same].effect !== req.effect) { current[same] = req; added++; } continue; }
          if (current.length >= FX.highlightMax) break;
          current.push(req);
          added++;
        }
        if (added === 0) { fx.messages.push(`"${op.phrase}" sudah ditandai ${op.effect}.`); break; }
        style = normalizeStyle({ ...style, highlights: current });
        fx.style = style;
        const note = op.effect === "slam" ? " (masuk dibanting dengan guncangan kecil)" : " (1.3x, warna aksen, kotak menyapu)";
        fx.messages.push(`Kata kunci "${op.phrase}" ditandai ${op.effect}${note}: ${plural(added, "tempat")}.${style.captions ? "" : " Catatan: subtitle sedang mati, jadi belum terlihat."}`);
        break;
      }

      case "auto_highlight": {
        // Bagian yang tertutup judul hook tidak punya subtitle, jadi tidak dipilih
        const skip = (style.titles ?? []).filter((t) => t.animation === "hook").map((t) => ({ start: t.startS, end: t.endS }));
        const manual = (style.highlights ?? []).filter((h) => !h.auto);
        const picks = pickKeywords(words, { density: op.density, slamCount: op.slamCount, max: FX.highlightMax - manual.length, skip: [...skip, ...manual.map((h) => ({ start: h.startS, end: h.endS }))] });
        if (picks.length === 0) { fx.messages.push("Tidak ada kata kunci yang cukup jelas di transkrip (kata fungsi dan kata yang mungkin salah dengar dilewati). Sebut kata kuncinya langsung."); break; }
        const highlights = [...manual, ...picks.map((p) => ({ startS: p.start, endS: p.end, effect: p.effect, auto: true as const }))];
        let overrides = style.cameraOverrides;
        let punched = 0;
        if (op.punch) {
          const targets = picks.filter((p, i) => p.effect === "slam" || i % 2 === 1);
          const extra = targets
            .map((p) => ({ startS: Math.max(0, p.start - CAMERA.overrideLeadSec), endS: Math.min(ctx.durationS, p.end + CAMERA.overrideTailSec), preset: "zoom-point" as const }))
            .filter((q) => !overrides.some((c) => overlapFrac({ start: c.startS, end: c.endS }, { start: q.startS, end: q.endS }) >= 0.5));
          overrides = [...overrides, ...extra].slice(0, CAMERA.overrideMax);
          punched = Math.max(0, overrides.length - style.cameraOverrides.length);
        }
        style = normalizeStyle({ ...style, highlights, cameraOverrides: overrides, ...(punched ? { camera: true } : {}) });
        fx.style = style;
        const list = (e: "aksen" | "slam") => picks.filter((p) => p.effect === e).map((p) => `"${p.text.replace(/[^\p{L}\p{N}]+$/u, "")}" (${p.start.toFixed(1)} dtk)`).join(", ");
        fx.messages.push(`Kata kunci otomatis dari transkrip (${op.density}): ${picks.length} kata. Aksen: ${list("aksen") || "-"}.${op.slamCount ? ` Slam: ${list("slam") || "-"}.` : ""}${punched ? ` Punch-in kamera di ${punched} kata.` : ""} Ganti dengan menyebut kata sendiri bila kurang pas.`);
        break;
      }

      case "fix_word": {
        if (/\s/.test(op.from)) {
          fx.messages.push(`Perbaikan ejaan hanya untuk SATU kata. "${op.from}" terdiri dari beberapa kata, tidak diubah.`);
          break;
        }
        const matches = findPhrase(words, op.from, { fuzzy: false });
        if (matches.length === 0) {
          fx.messages.push(`Tidak menemukan kata "${op.from}" di transkrip, tidak ada yang diubah.`);
          break;
        }
        for (const m of matches) {
          const i = m.startWord;
          const before = words[i].text;
          // pertahankan tanda baca di ujung kata ("premier," -> "Premiere,")
          const trail = before.match(/[^\p{L}\p{N}]+$/u)?.[0] ?? "";
          const after = /[^\p{L}\p{N}]$/u.test(op.to) ? op.to : op.to + trail;
          words[i] = { ...words[i], text: after };
          fx.wordFixes.push({ index: i, before, after });
        }
        // Subtitle yang sudah dibekukan menjadi klip (diedit di timeline) tidak membaca transkrip lagi: koreksi dibawa ke sana
        const subtitles = applyWordFixes(style.subtitles, matches.map((m) => ({ start: words[m.startWord].start, end: words[m.startWord].end, before: fx.wordFixes.find((f) => f.index === m.startWord)!.before, after: words[m.startWord].text })));
        if (subtitles !== style.subtitles) { style = normalizeStyle({ ...style, subtitles }); fx.style = style; }
        fx.messages.push(`Mengganti "${op.from}" menjadi "${op.to}": ${plural(matches.length, "tempat")} di transkrip (subtitle ikut berubah).`);
        break;
      }

      case "render":
        fx.render = { aspect: op.aspect };
        break;

      case "undo_last":
        fx.undo = true;
        break;

      case "answer":
        break;
    }
  }
  return fx;
}
