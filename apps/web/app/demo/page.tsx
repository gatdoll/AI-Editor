"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { Player, type PlayerRef } from "@remotion/player";
import { ASPECTS, MOTION, VIDEO, type AspectId } from "@app/config";
import { MotionShowcase } from "@app/remotion/src/compositions/MotionShowcase.tsx";
import { Icon } from "../components/Icon";

export default function MotionDemo() {
  const [aspect, setAspect] = useState<AspectId>("16:9");
  const player = useRef<PlayerRef>(null);
  const out = ASPECTS[aspect];
  return <main className="app-shell project-page">
    <nav className="app-nav"><Link href="/" className="brand"><span className="brand-mark"><Icon name="film"/></span>Mantiq Editor</Link><Link href="/">Buka project <Icon name="arrow" size={15}/></Link></nav>
    <header className="page-heading"><div><span className="eyebrow">MOTION STUDY / 001</span><h1>Gerakan yang punya karakter.</h1><p>Mask reveal, spring, perpindahan komposisi, dan tipografi kinetik. Putar untuk melihatnya.</p></div><div style={{ display: "flex", gap: 8 }}>{(Object.keys(ASPECTS) as AspectId[]).map((a) => <button key={a} aria-pressed={a === aspect} className={a === aspect ? "primary-action" : ""} onClick={() => setAspect(a)}>{a}</button>)}</div></header>
    <div className="demo-card" style={{ padding: 0, overflow: "hidden", maxWidth: out.height > out.width ? Math.round(640 * out.width / out.height) : undefined, margin: "20px auto" }}>
      <Player key={aspect} ref={player} component={MotionShowcase} inputProps={{ aspect }} durationInFrames={MOTION.showcase.durationSec * VIDEO.fps} fps={VIDEO.fps} compositionWidth={out.width} compositionHeight={out.height} style={{ width: "100%" }} controls autoPlay loop initiallyMuted acknowledgeRemotionLicense />
    </div>
    <div style={{ display: "flex", flexWrap: "wrap", gap: 10, margin: "24px 0" }}>{["01 · Reveal", "02 · Ritme & framing", "03 · Kinetic type"].map((label, i) => <button key={label} onClick={() => { player.current?.seekTo(i * MOTION.showcase.sceneSec * VIDEO.fps); player.current?.play(); }}>{label} <Icon name="play" size={13}/></button>)}</div>
    <section className="demo-card"><h2>Pakai di videomu.</h2><p className="muted">Buka project, pilih preset <b>Motion</b>, lalu putar preview. Atau ketik <b>“pakai gaya motion, teks kinetik, gerakan lebih kuat”</b>. Kekuatan framing dan jeda antar aksen bisa diatur di Pengaturan lanjutan → Motion.</p><p className="muted">Demo ini adalah studi motion tanpa audio. Pada video yang diunggah, gerak kata mengikuti timestamp transkrip.</p></section>
  </main>;
}

