"use client";
import type { ReferenceInput } from "@app/shared/reference";
// Fase 17: rekaman suara + naskah voice over. Codex CLI mengarahkan naskah baca dan intonasi, VoxCPM2 meniru suara rekaman, motion mengikuti waktu katanya.
// Atau file voice over yang sudah jadi: hanya waktu katanya yang dicatat, suaranya dipakai apa adanya.
import { useEffect, useState } from "react";
import { MOTION_GFX } from "@app/config";
import { estimateMinutes, type VoiceoverInfo, type VoiceoverSegment, type VoiceProfile } from "@app/shared/voiceover";
import { VoiceRecorder } from "./VoiceRecorder";
import s from "./motion.module.css";

const VO = MOTION_GFX.voiceover;

export type VoiceoverJob = { id: string; status: string; progress: number; error: string | null; stageLabel: string | null; script: string | null; next: { prompt: string; model?: string; assets?: { provider: "claude" | "codex"; model?: string }; reference?: ReferenceInput } | null; upload: boolean };
export type VoiceoverMode = "naskah" | "unggah";

const DIR = VO.direction;
const DIRECTION_LABEL = { codex: "naskah baca dari Codex CLI", pengguna: "naskah baca dari editan Anda", naskah: "naskah dibaca apa adanya", unggahan: "file unggahan" } as const;

/** `brief` = halaman brief: tombolnya "Buat motion" di halaman itu, panel ini hanya mengisi rekaman dan naskah. */
export function VoiceoverPanel({ projectId, info, job, profile, script, onScript, onProfile, onGenerate, onCancel, onRemove, brief, mode, onMode, file, onFile, onUpload, uploading }: {
  projectId: string; info: VoiceoverInfo | null; job: VoiceoverJob | null; profile: VoiceProfile | null; script: string;
  onScript: (v: string) => void; onProfile: (p: VoiceProfile | null) => void;
  onGenerate: (o?: { readingText?: string; segments?: VoiceoverSegment[]; next?: VoiceoverJob["next"] }) => void; onCancel: () => void; onRemove: () => void; brief?: boolean;
  mode: VoiceoverMode; onMode: (m: VoiceoverMode) => void; file: { file: File; durationS?: number } | null; onFile: (f: File | null) => void; onUpload: () => void; uploading: boolean;
}) {
  const busy = job?.status === "queued" || job?.status === "running";
  const failed = job?.status === "failed" || job?.status === "cancelled";
  const [reading, setReading] = useState(info?.readingText ?? "");
  useEffect(() => setReading(info?.readingText ?? ""), [info?.jobId, info?.readingText]);
  const [segments, setSegments] = useState<VoiceoverSegment[]>(info?.segments ?? []);
  useEffect(() => setSegments(info?.segments ?? []), [info?.jobId, info?.segments]);
  const patchSegment = (i: number, patch: Partial<VoiceoverSegment>) => setSegments((all) => all.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const segmentsChanged = JSON.stringify(segments) !== JSON.stringify(info?.segments ?? []);
  const uploaded = info?.direction === "unggahan";
  const scriptChanged = !!info && !uploaded && info.script !== script.trim();
  const voiceChanged = !!info && !uploaded && !!profile && info.profileId !== profile.id;
  const estimate = estimateMinutes(script);

  return (
    <div className={s.settings}>
      <div className={s.field}><span>Voice over</span>
        <div className={s.seg}>
          <button type="button" aria-pressed={mode === "naskah"} disabled={busy} onClick={() => onMode("naskah")}>Buat dari naskah</button>
          <button type="button" aria-pressed={mode === "unggah"} disabled={busy} onClick={() => onMode("unggah")}>Upload voice over</button>
        </div>
      </div>
      {mode === "unggah" ? (
        <>
          <div className={s.field}>
            <label className={s.uploadBtn}>{file ? `${file.file.name}${file.durationS ? ` · ${Math.round(file.durationS)} dtk` : ""} · ganti file` : "＋ Pilih file voice over (MP3, M4A, WAV, AAC, OGG)"}
              <input type="file" accept={[...VO.upload.exts, ...MOTION_GFX.materials.audio].join(",")} disabled={busy || uploading} onChange={(e) => { onFile(e.target.files?.[0] ?? null); e.target.value = ""; }} hidden />
            </label>
            <span className={s.matMeta}>Maks. {Math.round(VO.maxDurationS / 60)} menit. Suara dipakai apa adanya, durasi video mengikuti file, dan animasi mengikuti waktu tiap kata.</span>
            {file && <button type="button" className={s.link} disabled={uploading} onClick={() => onFile(null)}>Batal pilih file</button>}
          </div>
          <div className={s.field}><span>Naskah <small>(opsional, agar ejaan teks di layar tepat)</small></span>
            <textarea rows={brief ? 4 : 6} value={script} onChange={(e) => onScript(e.target.value)} maxLength={VO.maxScriptChars} disabled={busy || uploading}
              placeholder="Kosongkan bila tidak ada. Teks di layar lalu mengikuti transkrip otomatis, yang ejaannya bisa meleset untuk nama dan istilah." />
          </div>
          {!brief && <div className={s.field}>
            <button className="primary-action" disabled={!file || busy || uploading} onClick={onUpload}>{uploading ? "Mengunggah…" : busy ? "Sedang diproses…" : info ? "Ganti dengan file ini" : "Pakai file ini"}</button>
          </div>}
        </>
      ) : <>
      <VoiceRecorder profile={profile} onChanged={onProfile} disabled={busy} />
      <div className={s.field}><span>Naskah voice over <small>(opsional)</small></span>
        <textarea rows={brief ? 5 : 8} value={script} onChange={(e) => onScript(e.target.value)} maxLength={VO.maxScriptChars} disabled={busy}
          placeholder="Tulis narasi persis seperti yang ingin dibacakan. Durasi video mengikuti panjang suaranya." />
        <span className={s.matMeta}>{script.length}/{VO.maxScriptChars} · maks. {Math.round(VO.maxDurationS / 60)} menit suara{script.trim() ? ` · perkiraan suara ±${Math.max(1, Math.round(estimate.audioS))} dtk, dibuat ±${estimate.minutes} menit di komputer ini` : ""}</span>
        {!profile && script.trim() && <span className={s.warn}>Rekam suara Anda dulu agar naskah ini bisa dibacakan.</span>}
      </div>
      {!brief && <div className={s.field}>
        <button className="primary-action" disabled={!script.trim() || !profile || busy} onClick={() => onGenerate()}>{busy ? "Sedang dibuat…" : info ? "Buat ulang voice over" : "Buat voice over"}</button>
      </div>}
      </>}
      {busy && (
        <div className={s.info}>{job?.status === "queued" ? "Menunggu worker…" : job?.stageLabel ?? "Memulai…"} · {Math.round((job?.progress ?? 0) * 100)}%{" "}
          <button className={s.link} onClick={onCancel}>Batalkan</button>
          <div>Boleh ditinggal. Proses tetap berjalan selama aplikasi menyala.</div>
        </div>
      )}
      {failed && (
        <div className={s.warn}><b>{job?.status === "cancelled" ? "Voice over dibatalkan." : "Voice over gagal."}</b> {job?.status === "cancelled" ? "" : job?.error ?? ""}{" "}
          {job?.upload
            ? <div>Pilih file voice over lagi untuk mencoba ulang.</div>
            : <button className={s.link} disabled={!script.trim() || !profile} onClick={() => onGenerate({ next: job?.next ?? undefined })}>Coba lagi</button>}
          {job?.next && <div>{job.next.assets ? "Aset internet akan dicari otomatis setelah suaranya jadi." : "Motion akan dibuat otomatis setelah suaranya jadi."}</div>}
        </div>
      )}
      {info && !brief && (
        <div className={s.field}><span>Hasil · {Math.round(info.durationS)} dtk · {DIRECTION_LABEL[info.direction]}</span>
          <audio controls preload="none" src={`/api/projects/${projectId}/voiceover/file?v=${info.jobId}`} style={{ width: "100%" }} />
          {(scriptChanged || voiceChanged) && <span className={s.warn}>{scriptChanged ? "Naskah" : "Rekaman suara"} sudah berubah. Klik Buat ulang agar hasilnya mengikuti.</span>}
          {info.note && <span className={s.muted}>{info.note}</span>}
          {uploaded ? (
            <>
              <span>Teks acuan <small>(untuk teks di layar; waktunya dari suara di file)</small></span>
              <textarea rows={5} value={info.script} readOnly />
            </>
          ) : info.segments ? (
            <>
              <span>Arahan suara <small>(teks yang dibacakan mesin, emosi, intonasi, tempo, dan jeda tiap bagian; boleh diedit)</small></span>
              {segments.map((x, i) => (
                <div key={i} className={s.field}>
                  <textarea rows={2} value={x.text} onChange={(e) => patchSegment(i, { text: e.target.value })} disabled={busy} />
                  <div className={s.linkRow}>
                    <select aria-label="Emosi" value={x.emotion} disabled={busy} onChange={(e) => patchSegment(i, { emotion: e.target.value as VoiceoverSegment["emotion"] })}>
                      {Object.entries(DIR.emotions).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                    </select>
                    <select aria-label="Intonasi" value={x.intonation} disabled={busy} onChange={(e) => patchSegment(i, { intonation: e.target.value as VoiceoverSegment["intonation"] })}>
                      {Object.entries(DIR.intonations).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                    </select>
                    <select aria-label="Tempo" value={x.pace} disabled={busy} onChange={(e) => patchSegment(i, { pace: e.target.value as VoiceoverSegment["pace"] })}>
                      {Object.entries(DIR.paces).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                    </select>
                    <label>Jeda <input aria-label="Jeda setelah bagian ini, detik" type="number" min={DIR.minPauseS} max={DIR.maxPauseS} step={0.1} value={x.pauseAfterS} disabled={busy} onChange={(e) => patchSegment(i, { pauseAfterS: Number(e.target.value) || DIR.defaultPauseS })} style={{ width: "4.5em" }} /> dtk</label>
                  </div>
                </div>
              ))}
            </>
          ) : (
            <>
              <span>Naskah baca <small>(yang dibacakan mesin; boleh diedit bila ada kata yang salah ucap)</small></span>
              <textarea rows={5} value={reading} onChange={(e) => setReading(e.target.value)} disabled={busy} />
            </>
          )}
          <div className={s.linkRow}>
            {uploaded ? null : info.segments
              ? <button disabled={busy || !profile || !segmentsChanged || segments.some((x) => !x.text.trim())} onClick={() => onGenerate({ segments })}>Pakai arahan ini</button>
              : <button disabled={busy || !profile || !reading.trim() || reading.trim() === info.readingText} onClick={() => onGenerate({ readingText: reading.trim() })}>Pakai naskah baca ini</button>}
            <button disabled={busy} onClick={onRemove}>Hapus voice over</button>
          </div>
          <span className={s.muted}>Versi motion yang sudah ada tidak otomatis menyesuaikan suara baru. Minta revisi agar animasinya mengikuti waktu kata yang baru.</span>
        </div>
      )}
    </div>
  );
}
