import { Inter, Michroma } from "next/font/google";
import "../../../config/ui.css";
import "./globals.css";

// Fase 20: huruf design system Mantiq. Inter untuk UI, Michroma untuk judul display. Di-host sendiri oleh next/font.
const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-inter", display: "swap" });
const michroma = Michroma({ subsets: ["latin"], weight: "400", variable: "--font-michroma", display: "swap" });

export const metadata = { title: "Mantiq Editor", description: "Editor video berbasis AI: file asli tetap utuh, setiap keputusan di tanganmu." };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id" className={`${inter.variable} ${michroma.variable}`}>
      <body>{children}</body>
    </html>
  );
}
