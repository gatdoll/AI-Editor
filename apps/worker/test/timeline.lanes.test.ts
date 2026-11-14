import { assignLanes } from "../../../packages/remotion/src/timeline.ts";
let ok = 0, bad = 0;
const t = (n: string, c: boolean, i = "") => { c ? ok++ : bad++; console.log(c ? "LOLOS " : "GAGAL ", n, i); };
let r = assignLanes([{ id: "a", start: 0, end: 5 }, { id: "b", start: 6, end: 8 }]);
t("tidak tumpang tindih -> satu jalur", r.laneCount === 1 && r.lanes.get("a") === 0 && r.lanes.get("b") === 0);
r = assignLanes([{ id: "a", start: 0, end: 5 }, { id: "b", start: 3, end: 8 }, { id: "c", start: 4, end: 6 }]);
t("tiga blok saling tumpang tindih -> tiga jalur", r.laneCount === 3, JSON.stringify([...r.lanes]));
r = assignLanes([{ id: "a", start: 0, end: 5 }, { id: "b", start: 3, end: 8 }, { id: "c", start: 6, end: 9 }]);
t("blok memakai kembali jalur yang sudah bebas (c di jalur 0)", r.laneCount === 2 && r.lanes.get("c") === 0, JSON.stringify([...r.lanes]));
r = assignLanes([{ id: "a", start: 0, end: 5 }, { id: "b", start: 5, end: 8 }], 0.5);
t("jarak minimum: blok yang menempel dipisah ke jalur lain", r.laneCount === 2);
r = assignLanes([]);
t("kosong -> 1 jalur (tinggi baris minimum)", r.laneCount === 1 && r.lanes.size === 0);
// properti: tak ada dua blok pada satu jalur yang tumpang tindih
function rnd(seed: number) { let a = seed; return () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; }; }
let good = true;
for (let s = 1; s <= 300; s++) {
  const q = rnd(s);
  const items = Array.from({ length: 1 + Math.floor(q() * 60) }, (_, i) => { const st = q() * 100; return { id: `i${i}`, start: st, end: st + 0.1 + q() * 12 }; });
  const { lanes, laneCount } = assignLanes(items);
  for (const a of items) for (const b of items) if (a.id < b.id && lanes.get(a.id) === lanes.get(b.id) && a.start < b.end - 1e-9 && b.start < a.end - 1e-9) good = false;
  if ([...lanes.values()].some((l) => l >= laneCount)) good = false;
}
t("300 skenario acak: tidak ada tumpang tindih dalam satu jalur", good);
console.log(`\n${ok} lolos, ${bad} gagal`);
process.exit(bad ? 1 : 0);
