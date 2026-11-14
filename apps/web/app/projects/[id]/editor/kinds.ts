import type { SuggestionKind } from "@app/shared";

export const KIND_LABEL: Record<SuggestionKind, string> = {
  retake: "Retake",
  correction: "Koreksi",
  filler: "Filler",
  pause: "Jeda",
  unclear: "Tidak bisa dinilai",
  custom: "Permintaan Anda",
};

// Warna cukup terang untuk latar gelap
export const KIND_COLOR: Record<SuggestionKind, string> = {
  retake: "var(--ui-danger)",
  correction: "var(--ui-warning)",
  filler: "var(--ui-purple)",
  pause: "var(--ui-success)",
  unclear: "var(--ui-muted)",
  custom: "var(--ui-blue)",
};

export const PRESET_LABEL: Record<string, string> = {
  "push-in": "Mendekat",
  "pull-back": "Menjauh",
  pan: "Geser",
  tilt: "Miring",
  "zoom-point": "Zoom titik",
};

export function fmtTime(sec: number, tenths = true): string {
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${(tenths ? r.toFixed(1) : String(Math.floor(r))).padStart(tenths ? 4 : 2, "0")}`;
}
