// Fase 20: ikon Lucide (design system Mantiq), garis 1,75. Nama lama dipertahankan agar pemanggil tidak berubah.
import type { CSSProperties } from "react";
import {
  ArrowLeft, ArrowRight, Check, Clock, Download, Film, Folder, Maximize2, Newspaper, PanelRight, Pause, Play, Plus,
  Scissors, Search, SlidersHorizontal, Smile, Sparkles, Type, Upload, type LucideIcon,
} from "lucide-react";

const icons = {
  film: Film,
  plus: Plus,
  arrow: ArrowRight,
  back: ArrowLeft,
  search: Search,
  sparkle: Sparkles,
  play: Play,
  pause: Pause,
  export: Download,
  sliders: SlidersHorizontal,
  expand: Maximize2,
  panel: PanelRight,
  cut: Scissors,
  text: Type,
  check: Check,
  clock: Clock,
  folder: Folder,
  face: Smile,
  upload: Upload,
  news: Newspaper,
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof icons;

export function Icon({ name, size = 18, style }: { name: IconName; size?: number; style?: CSSProperties }) {
  const C = icons[name];
  return <C size={size} strokeWidth={1.75} style={style} aria-hidden="true" focusable="false" />;
}
