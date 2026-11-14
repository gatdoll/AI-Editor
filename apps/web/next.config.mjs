import path from "node:path";
import { fileURLToPath } from "node:url";
import nextEnv from "@next/env";

// Muat .env di root monorepo (Next hanya membaca .env di apps/web secara bawaan).
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
// forceReload=true: tanpa ini @next/env mengembalikan cache dari pemuatan awal (apps/web).
nextEnv.loadEnvConfig(root, process.env.NODE_ENV !== "production", console, true);

/** @type {import('next').NextConfig} */
export default {
  // Paket workspace berupa TS mentah
  transpilePackages: ["@app/config", "@app/remotion", "@app/shared"],
};
