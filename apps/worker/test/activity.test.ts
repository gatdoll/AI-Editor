// Log aktivitas AI langsung: baris stream Claude Code / Codex -> kalimat untuk pengguna, dan penulisan payload yang tidak
// saling menimpa dengan tahap. Jalankan: node apps/worker/test/activity.test.ts
import assert from "node:assert/strict";
import { activityLog, claudeStreamActivity, codexStreamActivity } from "../src/activity.ts";
import { agentArgs } from "../src/analyze/providers.ts";

// ---- Claude Code stream-json (bentuk diambil dari keluaran nyata CLI 2.1.310, 10 Nov 2026)
assert.deepEqual(claudeStreamActivity({ type: "assistant", message: { content: [{ type: "tool_use", name: "WebSearch", input: { query: "Nvidia CEO saat ini" } }] } }), ["Mencari di web: “Nvidia CEO saat ini”"]);
assert.deepEqual(claudeStreamActivity({ type: "assistant", message: { content: [{ type: "tool_use", name: "WebFetch", input: { url: "https://www.kompas.com/a/b" } }] } }), ["Membuka halaman kompas.com"]);
assert.deepEqual(claudeStreamActivity({ type: "assistant", message: { content: [{ type: "tool_use", name: "Write", input: { file_path: "C:\\tmp\\job\\overlay.tsx" } }] } }), ["Menulis overlay.tsx"]);
assert.deepEqual(claudeStreamActivity({ type: "assistant", message: { content: [{ type: "text", text: "Saya mulai dari judul." }, { type: "thinking", thinking: "" }] } }), ["AI: Saya mulai dari judul.", "AI sedang berpikir…"]);
assert.deepEqual(claudeStreamActivity({ type: "user", message: { content: [{ type: "tool_result" }] } }), []);
assert.deepEqual(claudeStreamActivity({ type: "result", structured_output: {} }), []);

// ---- Codex exec --json (codex-cli 0.163.0)
assert.deepEqual(codexStreamActivity({ type: "item.started", item: { type: "web_search", query: "", action: { type: "other" } } }), ["Mencari di web…"]);
assert.deepEqual(codexStreamActivity({ type: "item.completed", item: { type: "web_search", query: "x", action: { type: "search", query: "Jensen Huang CEO" } } }), ["Mencari di web: “Jensen Huang CEO”"]);
assert.deepEqual(codexStreamActivity({ type: "item.completed", item: { type: "web_search", action: { type: "open_page", url: "https://www.cnbc.com/x" } } }), ["Membuka halaman cnbc.com"]);
assert.deepEqual(codexStreamActivity({ type: "item.completed", item: { type: "agent_message", text: "Saya cari sumber terbaru." } }), ["AI: Saya cari sumber terbaru."]);
assert.deepEqual(codexStreamActivity({ type: "item.completed", item: { type: "agent_message", text: "{\"name\":\"x\"}" } }), ["Menyusun hasil akhir"]);
assert.deepEqual(codexStreamActivity({ type: "turn.completed", usage: {} }), []);

// ---- mode agen: stream hanya bila diminta (keluaran json lama tetap bawaan)
assert.ok(agentArgs({ maxTurns: 5, systemPrompt: "x" }).join(" ").includes("--output-format json"));
const streamArgs = agentArgs({ maxTurns: 5, systemPrompt: "x", stream: true }).join(" ");
assert.ok(streamArgs.includes("--output-format stream-json") && streamArgs.includes("--verbose"));

// ---- payload: tahap dan aktivitas ditulis bersama, tidak saling menimpa; baris kembar digabung; dibatasi
const writes: Array<Record<string, unknown>> = [];
const db = { from: () => ({ update: (row: { payload: Record<string, unknown> }) => ({ eq: async () => { writes.push(structuredClone(row.payload)); return {}; } }) }) };
const job = { id: "j1", payload: { prompt: "p" } as Record<string, unknown> };
const act = activityLog(db as never, job);
act.add("Mencari di web: “a”");
act.add("Mencari di web: “a”");
await act.patch({ stageLabel: "Tahap 1" });
act.add("Membuka halaman b.com");
await act.flush();
const last = writes.at(-1)!;
assert.equal(last.prompt, "p");
assert.equal(last.stageLabel, "Tahap 1");
assert.deepEqual((last.activity as Array<{ text: string }>).map((e) => e.text), ["Mencari di web: “a”", "Membuka halaman b.com"]);
for (let i = 0; i < 100; i++) act.add(`baris ${i}`);
await act.flush();
assert.equal((writes.at(-1)!.activity as unknown[]).length, 60);
assert.equal(writes.at(-1)!.stageLabel, "Tahap 1");

console.log("activity.test: stream Claude/Codex jadi kalimat, mode agen stream opsional, payload tahap+aktivitas tidak saling menimpa, dibatasi 60 passed");
