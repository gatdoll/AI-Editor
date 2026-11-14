// Penjelas error: mengubah pesan teknis (untuk log) menjadi judul + saran yang ramah pengguna.
// Murni (tanpa Node), aman dipakai di browser. Detail teknis tetap ditampilkan terpisah dan ada di log worker.

export type ErrorKind =
  | "no_audio"
  | "bad_media"
  | "disk_full"
  | "whisper"
  | "no_speech"
  | "quota"
  | "cli_login"
  | "timeout"
  | "bad_ai_output"
  | "file_missing"
  | "render_temp"
  | "render_check"
  | "camera_plan"
  | "unknown";

export type ExplainedError = { kind: ErrorKind; title: string; hint: string };

/** Awalan yang diberikan kode kita sendiri agar jenis error tidak bergantung pada teks CLI pihak ketiga. */
export const QUOTA_PREFIX = "[BATAS_PEMAKAIAN]";

const RULES: Array<{ kind: ErrorKind; test: RegExp; title: string; hint: string }> = [
  {
    kind: "quota",
    test: /\[BATAS_PEMAKAIAN\]|usage limit|rate.?limit|quota|too many requests|\b429\b|overloaded|credit balance|limit reached/i,
    title: "Batas pemakaian langganan tercapai",
    hint: "Tunggu sampai jatah di-reset, atau jalankan ulang dengan provider lain (Claude Code CLI atau Codex CLI).",
  },
  {
    kind: "cli_login",
    test: /belum login|not logged in|please (run|log ?in)|authentication|unauthorized|invalid api key|\b401\b/i,
    title: "CLI belum login",
    hint: "Buka terminal, jalankan `claude` (atau `codex login`), selesaikan login, lalu coba lagi.",
  },
  {
    kind: "timeout",
    test: /melewati batas waktu|timed? ?out|timeout/i,
    title: "Proses terlalu lama",
    hint: "Coba lagi. Jika berulang, coba provider lain atau video yang lebih pendek.",
  },
  {
    kind: "bad_ai_output",
    test: /bukan JSON|tidak sesuai skema|ZodError|invalid_type|Unexpected token/i,
    title: "AI memberi jawaban yang tidak sesuai format",
    hint: "Coba analisis ulang, atau pakai provider lain. Tidak ada yang berubah pada video Anda.",
  },
  {
    kind: "no_audio",
    test: /tidak punya audio|no audio stream|tidak punya suara/i,
    title: "Video tidak punya suara",
    hint: "Aplikasi ini untuk video bicara. Gunakan video yang ada suaranya.",
  },
  {
    kind: "no_speech",
    test: /tidak menemukan ucapan|no speech/i,
    title: "Tidak ada ucapan yang terdeteksi",
    hint: "Pastikan suara bicara terdengar jelas di video. Coba model Whisper yang lebih besar (WHISPER_MODEL) bila suara pelan.",
  },
  {
    kind: "disk_full",
    test: /ENOSPC|no space left|disk penuh|ruang disk/i,
    title: "Ruang disk tidak cukup",
    hint: "Kosongkan ruang di drive tempat folder data/media berada, lalu coba lagi.",
  },
  {
    kind: "whisper",
    test: /whisper|3221225781|0xC0000135|main\.exe|whisper-cli/i,
    title: "Program transkrip (Whisper) tidak bisa berjalan",
    hint: "Di Windows, pasang Microsoft Visual C++ Redistributable x64. Atau hapus folder apps/worker/.cache/whisper lalu coba lagi.",
  },
  {
    kind: "render_temp",
    test: /remotion-audio-mixing|Error opening output|Failed to launch the browser|Target closed|browser (has )?closed/i,
    title: "Gangguan sementara saat merender",
    hint: "Biasanya hilang sendiri. Klik render lagi. Jika berulang, tutup program lain yang berat lalu coba lagi.",
  },
  {
    kind: "bad_media",
    test: /ffprobe|Invalid data found|moov atom|could not find codec|aliran video|durasi video tidak terbaca/i,
    title: "File video rusak atau formatnya tidak didukung",
    hint: "Coba ekspor ulang video ke MP4 (H.264 + AAC), lalu unggah lagi di project baru.",
  },
  {
    kind: "file_missing",
    test: /tidak ada di disk|tidak ditemukan di disk|ENOENT/i,
    title: "File video tidak ditemukan di disk",
    hint: "File di folder data/media mungkin dipindah atau dihapus. Unggah ulang di project baru.",
  },
  {
    kind: "camera_plan",
    test: /rencana kamera tidak valid/i,
    title: "Rencana kamera tidak lolos pemeriksaan",
    hint: "Matikan gerakan kamera untuk render ini, atau simpan EDL ulang. Mohon laporkan ini: seharusnya tidak terjadi.",
  },
  {
    kind: "render_check",
    test: /tidak sesuai (EDL|harapan)|Hasil render tidak/i,
    title: "Hasil render tidak lolos pemeriksaan otomatis",
    hint: "File hasil tidak disimpan. Coba render ulang; jika berulang, matikan efek film dan coba lagi.",
  },
];

export function explainError(raw: string | null | undefined): ExplainedError {
  const text = raw ?? "";
  for (const r of RULES) if (r.test.test(text)) return { kind: r.kind, title: r.title, hint: r.hint };
  return {
    kind: "unknown",
    title: "Terjadi kesalahan",
    hint: "Coba lagi. Jika terus berulang, salin detail teknis di bawah ini untuk dilaporkan.",
  };
}

/** Apakah error ini TIDAK layak dicoba ulang otomatis (percuma atau memperburuk)? */
export function isFatalForRetry(raw: string): boolean {
  const k = explainError(raw).kind;
  return k === "quota" || k === "cli_login" || k === "no_audio" || k === "bad_media" || k === "disk_full";
}
