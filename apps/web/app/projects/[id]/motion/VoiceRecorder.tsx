"use client";
// Fase 17: rekam suara pengguna dari teks yang disediakan. Audio diolah di browser menjadi WAV mono, lalu diunggah sebagai acuan kloning.
import { useCallback, useEffect, useRef, useState } from "react";
import { MOTION_GFX } from "@app/config";
import { encodeWav, type VoiceProfile } from "@app/shared/voiceover";
import s from "./motion.module.css";

const REC = MOTION_GFX.voiceover.recording;
const MIC_KEY = "voiceover.mic";

function savedMic(): string {
  try { return localStorage.getItem(MIC_KEY) ?? ""; } catch { return ""; }
}

async function listMics(): Promise<MediaDeviceInfo[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const all = await navigator.mediaDevices.enumerateDevices();
  // "communications" di Chrome hanya alias perangkat lain; sebelum ada izin, id kosong sehingga belum bisa dipilih
  return all.filter((d) => d.kind === "audioinput" && d.deviceId && d.deviceId !== "communications");
}

type Take ={ url: string; wav: Uint8Array; durationS: number; quiet: boolean };

async function toTake(blob: Blob): Promise<Take> {
  const ctx = new AudioContext();
  try {
    const audio = await ctx.decodeAudioData(await blob.arrayBuffer());
    const mono = new Float32Array(audio.length);
    for (let c = 0; c < audio.numberOfChannels; c++) audio.getChannelData(c).forEach((x, i) => { mono[i] += x / audio.numberOfChannels; });
    let energy = 0;
    mono.forEach((x) => { energy += x * x; });
    const wav = encodeWav(mono, audio.sampleRate);
    return { wav, durationS: audio.duration, quiet: Math.sqrt(energy / Math.max(1, mono.length)) < REC.minRms, url: URL.createObjectURL(new Blob([wav as BlobPart], { type: "audio/wav" })) };
  } finally { void ctx.close(); }
}

export function VoiceRecorder({ profile, onChanged, disabled }: { profile: VoiceProfile | null; onChanged: (p: VoiceProfile | null) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(!profile);
  const [state, setState] = useState<"idle" | "recording" | "processing" | "saving">("idle");
  const [seconds, setSeconds] = useState(0);
  const [take, setTake] = useState<Take | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [micId, setMicId] = useState("");
  const recorder = useRef<MediaRecorder | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => { if (!profile) setOpen(true); }, [profile]);
  const refreshMics = useCallback(async () => {
    const found = await listMics().catch(() => []);
    setMics(found);
    // Mikrofon tersimpan yang sudah dicabut kembali ke bawaan sistem
    if (found.length) setMicId((id) => (found.some((d) => d.deviceId === id) ? id : ""));
  }, []);
  useEffect(() => {
    setMicId(savedMic());
    void refreshMics();
    const media = navigator.mediaDevices;
    media?.addEventListener?.("devicechange", refreshMics);
    return () => media?.removeEventListener?.("devicechange", refreshMics);
  }, [refreshMics]);
  const chooseMic = (id: string) => {
    setMicId(id);
    try { localStorage.setItem(MIC_KEY, id); } catch { /* pilihan hanya berlaku sampai halaman ditutup */ }
  };
  // Browser baru memberi daftar dan nama mikrofon setelah izin diberikan
  async function allowMics() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      await refreshMics();
    } catch { setError("Mikrofon tidak bisa diakses. Izinkan mikrofon di browser, lalu coba lagi."); }
  }
  const discard = () => { setTake((t) => { if (t) URL.revokeObjectURL(t.url); return null; }); };
  const stop = () => { if (recorder.current?.state === "recording") recorder.current.stop(); };
  useEffect(() => () => {
    if (timer.current) clearInterval(timer.current);
    if (recorder.current?.state === "recording") recorder.current.stop();
  }, []);

  async function start() {
    setError(null); discard();
    let stream: MediaStream;
    try {
      // Tanpa pengolahan browser: peredam noise dan AGC mengubah warna suara yang akan ditiru
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1, ...(micId ? { deviceId: { exact: micId } } : {}) } });
    } catch { return setError(micId ? "Mikrofon yang dipilih tidak bisa dipakai. Pilih mikrofon lain, lalu coba lagi." : "Mikrofon tidak bisa diakses. Izinkan mikrofon di browser, lalu coba lagi."); }
    void refreshMics();
    const parts: Blob[] = [];
    const rec = new MediaRecorder(stream);
    recorder.current = rec;
    rec.ondataavailable = (e) => { if (e.data.size) parts.push(e.data); };
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      if (timer.current) clearInterval(timer.current);
      setState("processing");
      void toTake(new Blob(parts, { type: rec.mimeType })).then(setTake).catch(() => setError("Rekaman tidak bisa diproses. Coba lagi.")).finally(() => setState("idle"));
    };
    const t0 = Date.now();
    setSeconds(0); setState("recording");
    rec.start();
    timer.current = setInterval(() => {
      const sec = (Date.now() - t0) / 1000;
      setSeconds(sec);
      if (sec >= REC.maxS) stop();
    }, 250);
  }

  async function save() {
    if (!take) return;
    setState("saving"); setError(null);
    try {
      const form = new FormData();
      form.append("file", new Blob([take.wav as BlobPart], { type: "audio/wav" }), "suara.wav");
      const r = await fetch("/api/voiceover/profile", { method: "POST", body: form });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) return setError(b.error ?? `HTTP ${r.status}`);
      discard(); setOpen(false); onChanged(b.profile);
    } finally { setState("idle"); }
  }

  const recording = state === "recording";
  const tooShort = !!take && take.durationS < REC.minS;
  const micsNamed = mics.some((d) => d.label);
  return (
    <div className={s.field}><span>Suara Anda</span>
      {profile && !open && (
        <>
          <audio controls preload="none" src={`/api/voiceover/profile/file?v=${profile.id}`} style={{ width: "100%" }} />
          <div className={s.linkRow}><button disabled={disabled} onClick={() => setOpen(true)}>Rekam ulang</button></div>
        </>
      )}
      {open && (
        <>
          <span className={s.muted}>Bacakan teks ini dengan gaya bicara yang Anda inginkan untuk voice over. Baca persis, di tempat yang tenang. Hanya rekam suara Anda sendiri.</span>
          <blockquote style={{ margin: 0, padding: "10px 12px", borderLeft: "3px solid var(--ui-accent)", background: "var(--ui-raised)", borderRadius: 6, fontSize: 14, lineHeight: 1.55 }}>{REC.text}</blockquote>
          {micsNamed
            ? (
              <label className={s.field}><span>Mikrofon</span>
                <select value={micId} disabled={state !== "idle" || disabled} onChange={(e) => chooseMic(e.target.value)}>
                  <option value="">Bawaan sistem</option>
                  {mics.map((d, i) => <option key={d.deviceId} value={d.deviceId}>{d.label || `Mikrofon ${i + 1}`}</option>)}
                </select>
              </label>
            )
            : <div className={s.linkRow}><button disabled={state !== "idle" || disabled} onClick={() => void allowMics()}>Pilih mikrofon</button></div>}
          <div className={s.linkRow}>
            {recording
              ? <button aria-pressed onClick={stop}>■ Selesai ({Math.floor(seconds)} dtk)</button>
              : <button disabled={state !== "idle" || disabled} onClick={() => void start()}>● {take ? "Rekam lagi" : "Mulai rekam"}</button>}
            {profile && !recording && <button disabled={state !== "idle"} onClick={() => { discard(); setOpen(false); }}>Batal</button>}
          </div>
          {recording && <span className={s.matMeta}>Disarankan {REC.minS}–{REC.maxS} detik. Berhenti otomatis di {REC.maxS} detik.</span>}
          {state === "processing" && <span className={s.matMeta}>Memproses rekaman…</span>}
          {take && (
            <>
              <audio controls src={take.url} style={{ width: "100%" }} />
              {tooShort && <span className={s.warn}>Rekaman {Math.round(take.durationS)} detik, minimal {REC.minS} detik. Baca seluruh teks.</span>}
              {take.quiet && <span className={s.warn}>Suara terlalu pelan. Dekatkan mikrofon, lalu rekam lagi.</span>}
              <div className={s.linkRow}><button disabled={tooShort || state !== "idle"} onClick={() => void save()}>{state === "saving" ? "Menyimpan…" : "Pakai rekaman ini"}</button></div>
            </>
          )}
        </>
      )}
      {error && <span className={s.warn}>{error}</span>}
    </div>
  );
}
