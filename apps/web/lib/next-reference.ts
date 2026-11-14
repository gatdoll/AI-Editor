// Fase 22: brief pertama motion (`next` di job voice over) boleh membawa video referensi gaya. Masukan browser diganti
// lampiran yang sah (unggahan milik project / link yang dikanonikkan) sebelum job dibuat. Hanya server.
import { NextResponse } from "next/server";
import type { ReferenceInput } from "@app/shared/reference";
import { attachReference } from "@app/shared/reference-store";

export async function nextWithReference<T extends { reference?: ReferenceInput }>(projectId: string, next: T | undefined) {
  if (!next?.reference) return next;
  try {
    return { ...next, reference: await attachReference(projectId, next.reference) };
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Referensi tidak ditemukan; unggah ulang." }, { status: 400 });
  }
}
