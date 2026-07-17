// config.mjs — load .env (no external dep) and expose typed config.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function loadDotEnv() {
  const envPath = path.join(ROOT, ".env");
  if (!fs.existsSync(envPath)) return;
  const text = fs.readFileSync(envPath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const k = trimmed.slice(0, eq).trim();
    let v = trimmed.slice(eq + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (!(k in process.env)) process.env[k] = v;
  }
}

loadDotEnv();

function req(name, fallback) {
  const v = process.env[name] ?? fallback;
  if (v == null || v === "") {
    throw new Error(`Missing required env var: ${name}`);
  }
  return v;
}

const VAULT_ROOT = req("VAULT_ROOT", "C:/g/md").replace(/\\/g, "/");

export const config = {
  ROOT,
  VAULT_ROOT,
  NVIDIA_API_KEY: process.env.NVIDIA_API_KEY ?? "",
  EMBED_MODEL: process.env.NVIDIA_EMBED_MODEL ?? "nvidia/nemotron-3-embed-1b",
  BASE_URL: (
    process.env.NVIDIA_BASE_URL ?? "https://integrate.api.nvidia.com/v1"
  ).replace(/\/$/, ""),
  CACHE_DIR: (
    process.env.MDV_CACHE_DIR ?? path.join(VAULT_ROOT, ".mdv-cache")
  ).replace(/\\/g, "/"),
  // nemotron-3-embed-1b native output.
  EMBED_DIMS: 2048,
  MAX_INPUT_TOKENS: 2048,
};

export function hasApiKey() {
  return typeof config.NVIDIA_API_KEY === "string" &&
    config.NVIDIA_API_KEY.startsWith("nvapi-");
}
