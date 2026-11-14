"use client";
import { explainError } from "@app/shared/errors";

/** Pesan error ramah (judul + saran) dengan detail teknis yang bisa dibuka dan disalin. */
export function ErrorBox({ raw, children }: { raw: string | null | undefined; children?: React.ReactNode }) {
  if (!raw) return null;
  const e = explainError(raw);
  return (
    <div style={{ border: "1px solid var(--ui-danger-soft)", background: "var(--ui-danger-soft)", padding: "8px 12px", margin: "6px 0", borderRadius: 4 }}>
      <b style={{ color: "var(--ui-danger)" }}>{e.title}</b>
      <div style={{ margin: "4px 0" }}>{e.hint}</div>
      {children}
      <details style={{ marginTop: 4 }}>
        <summary style={{ cursor: "pointer", color: "var(--ui-muted)" }}>Detail teknis</summary>
        <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 12, margin: "6px 0 0", userSelect: "all" }}>{raw}</pre>
      </details>
    </div>
  );
}
