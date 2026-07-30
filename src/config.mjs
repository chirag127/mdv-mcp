// config.mjs — all configuration resolution: arg/roots/env/precedence + validation.
//
// Vault root precedence (highest → lowest):
//   1. --vault <path>  CLI arg
//   2. MCP roots capability (first root sent by the client at initialize)
//   3. VAULT_ROOT env var (from .env or shell)
//   4. cwd

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// ── .env loader ─────────────────────────────────────────────────────────────
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

// ── CLI arg parsing ──────────────────────────────────────────────────────────
/**
 * Parse --vault <path> from process.argv.
 * @returns {string|null}
 */
export function parseVaultArg() {
  const args = process.argv.slice(2);
  const idx = args.findIndex((a) => a === "--vault" || a === "-v");
  if (idx !== -1 && args[idx + 1]) {
    return path.resolve(args[idx + 1]).replace(/\\/g, "/");
  }
  return null;
}

// ── Vault root resolution ────────────────────────────────────────────────────
// cliVault: populated at startup by main via parseVaultArg().
// rootsVault: populated when MCP client sends roots capability at initialize.
let _cliVault = parseVaultArg();
let _rootsVault = null;

/**
 * Override vault root from MCP roots capability (call at initialize).
 * @param {string} p
 */
export function setRootsVault(p) {
  _rootsVault = p ? path.resolve(p).replace(/\\/g, "/") : null;
}

/**
 * Resolve vault root by precedence:
 *   --vault arg > MCP roots > VAULT_ROOT env > cwd
 * @returns {string}
 */
export function resolveVaultRoot() {
  if (_cliVault) return _cliVault;
  if (_rootsVault) return _rootsVault;
  if (process.env.VAULT_ROOT) return process.env.VAULT_ROOT.replace(/\\/g, "/");
  return process.cwd().replace(/\\/g, "/");
}

/**
 * Validate that the resolved vault root exists and is a directory.
 * @param {string} vaultRoot
 * @throws {Error} if not valid
 */
export function validateVaultRoot(vaultRoot) {
  if (!fs.existsSync(vaultRoot)) {
    throw new Error(
      `Vault root does not exist: ${vaultRoot}\n` +
      `Set via --vault <path>, MCP roots, or VAULT_ROOT env var.`
    );
  }
  if (!fs.statSync(vaultRoot).isDirectory()) {
    throw new Error(`Vault root is not a directory: ${vaultRoot}`);
  }
}

// ── Build config object ──────────────────────────────────────────────────────
// VAULT_ROOT is resolved lazily so that setRootsVault() called during
// MCP initialize can win before any vault operation happens.
// Callers should use getVaultRoot() rather than config.VAULT_ROOT directly
// for paths that depend on the vault.

export const config = {
  ROOT,
  get VAULT_ROOT() { return resolveVaultRoot(); },
  NVIDIA_API_KEY: process.env.NVIDIA_API_KEY ?? "",
  EMBED_MODEL: process.env.NVIDIA_EMBED_MODEL ?? "nvidia/nemotron-3-embed-1b",
  BASE_URL: (
    process.env.NVIDIA_BASE_URL ?? "https://integrate.api.nvidia.com/v1"
  ).replace(/\/$/, ""),
  get CACHE_DIR() {
    return (
      process.env.MDV_CACHE_DIR ?? path.join(resolveVaultRoot(), ".mdv-cache")
    ).replace(/\\/g, "/");
  },
  // nemotron-3-embed-1b native output dims.
  EMBED_DIMS: 2048,
  MAX_INPUT_TOKENS: 2048,
};

/** @returns {boolean} */
export function hasApiKey() {
  return (
    typeof config.NVIDIA_API_KEY === "string" &&
    config.NVIDIA_API_KEY.startsWith("nvapi-")
  );
}
