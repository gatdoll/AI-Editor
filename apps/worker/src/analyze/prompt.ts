import type { Word } from "@app/shared";

// Skema "strict": semua properti wajib dan additionalProperties=false
// (diterima oleh --json-schema Claude Code maupun --output-schema Codex).
export const LLM_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["suggestions", "unclear"],
  properties: {
    suggestions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "startWord", "endWord", "reason"],
        properties: {
          kind: { type: "string", enum: ["retake", "correction"] },
          startWord: { type: "integer" },
          endWord: { type: "integer" },
          reason: { type: "string" },
        },
      },
    },
    unclear: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["startWord", "endWord", "reason"],
        properties: {
          startWord: { type: "integer" },
          endWord: { type: "integer" },
          reason: { type: "string" },
        },
      },
    },
  },
} as const;

/** Transkrip bernomor. Jeda > 0,5 dtk ditandai agar pola "diam lalu ulang" terlihat. */
function numbered(words: Word[], from: number, to: number): string {
  const lines: string[] = [];
  let line: string[] = [];
  for (let i = from; i < to; i++) {
    const gap = i > 0 ? words[i].start - words[i - 1].end : 0;
    if (gap > 0.5) line.push(`(jeda ${gap.toFixed(1)}s)`);
    line.push(`[${i}] ${words[i].text}`);
    if (line.length >= 14) {
      lines.push(line.join(" "));
      line = [];
    }
  }
  if (line.length) lines.push(line.join(" "));
  return lines.join("\n");
}

/** `from` inklusif, `to` eksklusif. */
export function buildPrompt(words: Word[], from: number, to: number): string {
  return `Kamu editor video berpengalaman. Di bawah ini transkrip video bicara (Indonesia dengan istilah Inggris). Setiap kata diberi nomor. Tanda (jeda X.Xs) menunjukkan diam antar kata.

TUGAS: tandai bagian yang sebaiknya DIPOTONG. Ada dua jenis:
- retake: pembicara mengulang kalimat/frasa yang sama karena take sebelumnya kurang baik. Potong take AWAL, pertahankan take TERAKHIR. Pilih rentang sesempit mungkin: jangan memotong sapaan atau kata yang tidak ikut diulang.
- correction: salah ucap yang langsung dikoreksi. Potong bagian yang salah (termasuk kata penyela seperti "eh" atau "maksudnya") dan pertahankan versi yang benar.

KETEPATAN BATAS (penting, hasil potongan harus tetap menjadi kalimat yang utuh dan benar):
- Untuk correction, potong HANYA kata yang salah beserta penyelanya. Kata di depannya yang benar dan kata sesudahnya yang benar harus tetap utuh. Contoh: "lalu kita hitung di Excel eh maksud saya Google Sheets" -> potong "Excel eh maksud saya" saja; "lalu kita hitung di" dan "Google Sheets" tetap, sehingga hasilnya "lalu kita hitung di Google Sheets".
- Untuk retake, potong take awal saja, dari kata pertama yang diulang sampai tepat sebelum take terakhir mulai.
- Sebelum menjawab, bayangkan kalimat setelah dipotong dan pastikan tidak ada kata menggantung di awal atau akhir.

JANGAN potong:
- pengulangan yang disengaja untuk penekanan atau gaya bicara (mis. "sangat, sangat penting"), daftar, atau penjelasan ulang yang menambah informasi.
- filler (eh, em, anu) dan jeda diam: sudah ditangani sistem lain.
- apa pun yang tidak kamu yakini. Lebih baik melewatkan daripada salah memotong.

Kalau ada bagian yang tidak bisa kamu nilai (transkrip kacau atau tidak masuk akal), JANGAN menebak: masukkan ke "unclear" dengan alasan singkat.

ATURAN FORMAT:
- startWord dan endWord adalah nomor kata, inklusif, dan HARUS berada di kisaran ${from} sampai ${to - 1}.
- Rentang tidak boleh saling tumpang tindih.
- reason: satu kalimat Indonesia yang menyebut apa yang diulang atau salah, dan take mana yang dipertahankan. Kutip kata-katanya, JANGAN menyebut nomor kata (pengguna tidak melihat nomor).
- Jika tidak ada yang perlu dipotong, kembalikan array kosong.

TRANSKRIP (kata ${from} sampai ${to - 1}):
${numbered(words, from, to)}
`;
}
