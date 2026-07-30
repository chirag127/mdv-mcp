// lib/vault.mjs — markdown vault file I/O + parsing + utilities.
import fs from "node:fs/promises";
import fssync from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { config } from "../config.mjs";

/** Directories never indexed or traversed. */
const SKIP_DIRS = new Set([
  ".git", ".obsidian", "node_modules", ".mdv-cache", ".trash",
]);

/** @returns {string} */
export function getVaultRoot() { return config.VAULT_ROOT; }

/**
 * Convert an absolute path to vault-relative.
 * @param {string} absPath
 * @returns {string}
 */
export function toRelative(absPath) {
  const abs = absPath.replace(/\\/g, "/");
  const root = config.VAULT_ROOT;
  return abs.startsWith(root) ? abs.slice(root.length).replace(/^\//, "") : abs;
}

/**
 * Convert a vault-relative path to absolute; guards against traversal.
 * @param {string} relPath
 * @returns {string}
 */
export function toAbsolute(relPath) {
  const clean = relPath.replace(/\\/g, "/").replace(/^\//, "");
  const abs = path.resolve(config.VAULT_ROOT, clean).replace(/\\/g, "/");
  if (!abs.startsWith(config.VAULT_ROOT)) {
    throw new Error(`Path escapes vault root: ${relPath}`);
  }
  return abs;
}

/**
 * Walk the vault directory tree collecting files with the given extension.
 * @param {string} [root]
 * @param {string} [ext=".md"]
 * @returns {Promise<string[]>}
 */
export async function walkVault(root, ext = ".md") {
  const base = root ?? config.VAULT_ROOT;
  const results = [];
  async function recurse(dir) {
    let entries;
    try { entries = await fs.readdir(dir, { withFileTypes: true }); }
    catch { return; }
    for (const e of entries) {
      if (e.name.startsWith(".") || SKIP_DIRS.has(e.name)) continue;
      const full = path.join(dir, e.name).replace(/\\/g, "/");
      if (e.isDirectory()) await recurse(full);
      else if (!ext || e.name.endsWith(ext)) results.push(full);
    }
  }
  await recurse(base);
  return results;
}

/**
 * Read and parse a vault-relative markdown file.
 * @param {string} relPath
 * @returns {Promise<{ rel: string, abs: string, frontmatter: object, body: string, raw: string }>}
 */
export async function readDoc(relPath) {
  const abs = toAbsolute(relPath);
  const raw = await fs.readFile(abs, "utf8");
  const parsed = matter(raw);
  return { rel: toRelative(abs), abs, frontmatter: parsed.data ?? {}, body: parsed.content ?? "", raw };
}

/**
 * Write (create or overwrite) a vault-relative markdown file.
 * @param {string} relPath
 * @param {string} content
 * @param {{ overwrite?: boolean }} [opts]
 * @returns {Promise<{ rel: string, abs: string, bytes: number }>}
 */
export async function writeDoc(relPath, content, { overwrite = true } = {}) {
  const abs = toAbsolute(relPath);
  if (!overwrite && fssync.existsSync(abs)) {
    throw new Error(`File exists and overwrite=false: ${relPath}`);
  }
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content, "utf8");
  return { rel: toRelative(abs), abs, bytes: Buffer.byteLength(content) };
}

/**
 * Delete a vault-relative markdown file.
 * @param {string} relPath
 * @returns {Promise<{ rel: string, abs: string }>}
 */
export async function deleteDoc(relPath) {
  const abs = toAbsolute(relPath);
  await fs.unlink(abs);
  return { rel: toRelative(abs), abs };
}

/**
 * List markdown files under a subdirectory (or vault root).
 * @param {string} [subdir=""]
 * @param {string} [ext=".md"]
 * @returns {Promise<string[]>}
 */
export async function listDir(subdir = "", ext = ".md") {
  const base = subdir ? toAbsolute(subdir) : config.VAULT_ROOT;
  const files = await walkVault(base, ext);
  return files.map(toRelative).sort();
}

/**
 * Split a doc body into overlapping chunks for embedding.
 * nemotron max input = 2048 tokens; ~4 chars/token => ~6000 chars safe.
 * @param {string} text
 * @param {{ maxChars?: number, overlap?: number }} [opts]
 * @returns {string[]}
 */
export function chunkText(text, { maxChars = 4000, overlap = 400 } = {}) {
  const clean = text.replace(/\r\n/g, "\n");
  if (clean.length <= maxChars) return [clean];
  const chunks = [];
  let start = 0;
  while (start < clean.length) {
    let end = Math.min(start + maxChars, clean.length);
    if (end < clean.length) {
      const slice = clean.slice(start, end);
      const nl = slice.lastIndexOf("\n\n");
      const nl2 = slice.lastIndexOf("\n");
      const brk = nl > maxChars * 0.5 ? nl : nl2 > maxChars * 0.5 ? nl2 : -1;
      if (brk !== -1) end = start + brk;
    }
    chunks.push(clean.slice(start, end).trim());
    if (end >= clean.length) break;
    start = end - overlap;
  }
  return chunks.filter(Boolean);
}

/**
 * Aggregate tags from a doc's frontmatter and inline #tags.
 * @param {object} frontmatter
 * @param {string} body
 * @returns {string[]}
 */
export function extractTags(frontmatter, body) {
  const tags = new Set();
  const fmTags = frontmatter?.tags;
  if (Array.isArray(fmTags)) fmTags.forEach((t) => tags.add(String(t)));
  else if (typeof fmTags === "string") fmTags.split(/[,\s]+/).forEach((t) => t && tags.add(t));
  for (const m of body.matchAll(/(?:^|\s)#([\w/-]+)/g)) tags.add(m[1]);
  return [...tags].filter(Boolean);
}

/**
 * Find all docs that link (wikilink or md link) to targetRel.
 * @param {string} targetRel
 * @param {{ rel: string, raw: string }[]} docs
 * @returns {string[]}
 */
export function findBacklinks(targetRel, docs) {
  const targetName = path.basename(targetRel, ".md").toLowerCase();
  const results = [];
  for (const { rel, raw } of docs) {
    if (rel === targetRel) continue;
    const lower = raw.toLowerCase();
    if (
      lower.includes(`[[${targetName}`) ||
      lower.includes(`](${targetRel.toLowerCase()}`) ||
      lower.includes(`](${targetName}`)
    ) results.push(rel);
  }
  return results;
}
