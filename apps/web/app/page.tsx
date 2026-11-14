"use client";
import Link from "next/link";
import { Icon } from "./components/Icon";
import s from "./home.module.css";
import { useCallback, useEffect, useState } from "react";

type Project = { id: string; name: string; status: string; error: string | null; created_at: string; kind?: "video" | "motion"; style?: { motion?: { animasi?: boolean; opini?: boolean } } | null };
/** Project Animasi = project motion dengan penanda motion.animasi. */
const isAnimasi = (p: Project) => p.kind === "motion" && p.style?.motion?.animasi === true;
/** Fase 19: project Opinion Motion = project motion dengan penanda motion.opini. */
const isOpini = (p: Project) => p.kind === "motion" && p.style?.motion?.opini === true;

const STATUS_LABEL: Record<string, string> = {
  created: "Baru",
  uploading: "Mengunggah",
  ingesting: "Memproses file",
  transcribing: "Transkrip",
  analyzing: "Auto cut",
  ready: "Siap",
  failed: "Gagal",
};

export default function Home() {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Hapus project: konfirmasi di dalam kartu (bukan dialog browser)
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [withFiles, setWithFiles] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/projects");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Gagal memuat project");
      setProjects(json.projects);
      setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : "Tidak dapat terhubung"); }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Fase 13: setelah nama, pilih jenis. Video -> unggah; Motion -> brief motion graphics; Animasi -> brief cerita/karakter;
  // Opinion Motion (Fase 19) -> brief + voice over wajib, lalu riset aset internet yang dipilih pengguna.
  async function create(e: React.FormEvent, kind: "video" | "motion" | "animasi" | "opini" = "video") {
    e.preventDefault();
    if (creating || !name.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/projects", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name.trim(), kind }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Gagal membuat project");
      window.location.href = kind !== "video" ? `/projects/${json.project.id}/motion` : `/projects/${json.project.id}`;
    } catch (e) { setError(e instanceof Error ? e.message : "Gagal membuat project"); setCreating(false); }
  }
  async function remove(id: string) {
    setDeleting(true); setError(null);
    try {
      const res = await fetch(`/api/projects/${id}${withFiles ? "?files=1" : ""}`, { method: "DELETE" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Gagal menghapus project");
      setConfirmId(null); setWithFiles(false);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Gagal menghapus project"); }
    finally { setDeleting(false); }
  }
  const shown = projects?.filter((p) => p.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()));

  return (
    <main className="app-shell">
      <nav className="app-nav" aria-label="Navigasi utama">
        <Link href="/" className="brand"><span className="brand-mark"><Icon name="film" /></span>Mantiq Editor</Link>
        <Link href="/demo" className={s.demoLink}><Icon name="play" size={15} /> Lihat demo</Link>
      </nav>
      <header className="page-heading">
        <div><span className="eyebrow">WORKSPACE / PROJECTS</span><h1>Ruang untuk cerita berikutnya.</h1><p>Dari rekaman mentah menjadi video yang siap ditonton.</p></div>
        <span className={s.projectTotal}><Icon name="folder" /> {projects?.length ?? '—'} project</span>
      </header>
      <section className={s.createPanel} aria-labelledby="new-project-title">
        <div className={s.createIntro}><span className={s.largeMark}><Icon name="plus" size={26}/></span><div><h2 id="new-project-title">Mulai sesuatu yang baru.</h2><p>Beri nama, lalu pilih: <b>Video</b> (unggah rekaman bicara) , <b>Motion</b> (motion graphics dari brief), <b>Animasi</b> (cerita bergambar dengan karakter), atau <b>Opinion Motion</b> (opini dengan foto tokoh dan screenshot berita dari internet).</p></div></div>
        <form onSubmit={create} className={s.createForm}>
          <input aria-label="Nama project baru" value={name} onChange={(e) => setName(e.target.value)} placeholder="Beri nama project kamu…" maxLength={120} required />
          <button className="primary-action" disabled={!name.trim() || creating} title="Unggah video bicara, lalu potong, subtitle, dan edit dengan AI"><Icon name="film" size={16}/>{creating ? 'Membuat…' : 'Video'}</button>
          <button type="button" className="primary-action" disabled={!name.trim() || creating} onClick={(e) => void create(e, "motion")} title="Motion graphics dari brief: logo, teks, grafik, musik"><Icon name="sparkle" size={16}/>Motion</button>
          <button type="button" className="primary-action" disabled={!name.trim() || creating} onClick={(e) => void create(e, "animasi")} title="Animasi bercerita: karakter, storytelling, explainer bergambar (cut paper, sketsa, tinta, pixel…)"><Icon name="face" size={16}/>Animasi</button>
          <button type="button" className="primary-action" disabled={!name.trim() || creating} onClick={(e) => void create(e, "opini")} title="Opinion Motion: narasi opini + aset nyata dari internet (foto tokoh saat disebut, screenshot artikel berita), dipilih dulu sebelum dipakai"><Icon name="news" size={16}/>Opinion Motion</button>
        </form>
      </section>
      <div className={s.libraryHeader}><div><h2>Project kamu <span>{projects?.length ?? 0}</span></h2><p>Lanjutkan dari ide terakhir.</p></div><label className={s.search}><Icon name="search" size={17}/><input aria-label="Cari project" placeholder="Cari project…" value={query} onChange={(e) => setQuery(e.target.value)}/></label></div>
      {error && <div className="error-message" role="alert">{error} <button onClick={() => void load()}>Coba lagi</button></div>}
      {projects === null ? <div className={s.empty} role="status">{error ? 'Project belum dapat dimuat.' : 'Menyiapkan workspace…'}</div> : shown?.length === 0 ? <div className={s.empty}><Icon name="folder" size={32}/><h3>{query ? 'Project tidak ditemukan' : 'Cerita pertamamu dimulai di sini'}</h3><p>{query ? 'Coba nama atau kata kunci lain.' : 'Beri nama project di atas untuk mulai mengunggah video.'}</p></div> :
        <div className={s.grid}>{shown?.map((p, i) => <div className={s.cardWrap} key={p.id}>
          <button className={s.deleteBtn} aria-label={`Hapus project ${p.name}`} title="Hapus project" onClick={() => { setConfirmId(p.id); setWithFiles(false); }}>✕</button>
          {confirmId === p.id && (
            <div className={s.confirm} role="alertdialog" aria-label={`Konfirmasi hapus ${p.name}`}>
              <strong>Hapus “{p.name}”?</strong>
              <p>Project, transkrip, usulan cut, dan editnya dihapus dari daftar.</p>
              <label><input type="checkbox" checked={withFiles} onChange={(e) => setWithFiles(e.target.checked)} /> Hapus juga file video dari disk (video asli, pratinjau, hasil render). Tidak bisa dikembalikan.</label>
              {!withFiles && <p className={s.confirmNote}>Tanpa centang ini, file video tetap tersimpan di folder data/media/projects.</p>}
              <div className={s.confirmActions}>
                <button className={s.confirmDelete} disabled={deleting} onClick={() => void remove(p.id)}>{deleting ? "Menghapus…" : "Hapus"}</button>
                <button disabled={deleting} onClick={() => setConfirmId(null)}>Batal</button>
              </div>
            </div>
          )}
          <Link href={p.kind === 'motion' ? `/projects/${p.id}/motion` : `/projects/${p.id}${p.status === 'ready' ? '/editor' : ''}`} className={s.projectCard}>
          <div className={s.cover} data-variant={i % 3}><div className={s.coverGrid}/><span className={s.coverIndex}>{String(i + 1).padStart(2, '0')}</span><Icon name={isAnimasi(p) ? "face" : isOpini(p) ? "news" : "film"} size={38}/><span className={s.openProject}><Icon name="arrow" size={19}/></span><span className="eyebrow">{isAnimasi(p) ? 'ANIMASI' : isOpini(p) ? 'OPINION MOTION' : p.kind === 'motion' ? 'MOTION GRAPHICS' : 'VIDEO PROJECT'}</span></div>
          <div className={s.cardContent}><div className={s.cardTitle}><h3>{p.name}</h3><span className="status-pill" data-status={p.status}>{STATUS_LABEL[p.status] ?? p.status}</span></div><div className={s.cardMeta}><span>{new Date(p.created_at).toLocaleDateString('id-ID', {day:'numeric',month:'short',year:'numeric'})}</span><span>{isAnimasi(p) ? 'Buka animasi' : isOpini(p) ? 'Buka opinion motion' : p.kind === 'motion' ? 'Buka motion' : p.status === 'ready' ? 'Buka editor' : 'Siapkan video'} <Icon name="arrow" size={13}/></span></div></div>
        </Link></div>)}</div>}
      <footer className={s.footer}><span>Mantiq Editor</span><span>Rekaman asli tetap utuh. Setiap keputusan ada di tanganmu.</span></footer>
    </main>
  );
}
