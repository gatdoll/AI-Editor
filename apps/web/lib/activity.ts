// Log aktivitas job AI (ditulis worker di job.payload.activity, apps/worker/src/activity.ts). Dipakai route API dan UI.
export type ActivityEntry = { t: number; text: string };

/** Ambil entri yang valid dari payload (data dari database, jangan percaya bentuknya). */
export function readActivity(raw: unknown): ActivityEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((e): e is ActivityEntry => !!e && typeof e === "object" && typeof (e as ActivityEntry).t === "number" && typeof (e as ActivityEntry).text === "string")
    .slice(-60);
}
