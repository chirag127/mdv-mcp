// vault.mjs — markdown vault file operations + parsing.
import fs from "node:fs/promises";
import fssync from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { config } from "./config.mjs";

const VAULT_ROOT = config.VAULT_ROOT;

// Directories we never index/traverse.
const SKIP_DIRS = new Set([
  ".git", ".obsidian", "node_modules", ".mdv-cache", ".trash",
]);

export function toRelative(absPath) {
  const abs = absPath.replace(/\\/g, "/");
  return abs.startsWith(VAULT_ROOT)
    ? abs.slice(VAULT_ROOT.length).replace(/^\//, "")
    : abs;
}

export function toAbsolute(relPath) {
  const clean = relPath.replace(/\\/g, "/").replace(/^\//, "");
  const abs = path.resolve(VAULT_ROOT, clean).replace(/\\/g, "/");
  // Guard against path traversal outside the vault.
  if (!abs.startsWith(VAULT_ROOT)) {
    throw new Error(`Path escapes vault root: ${relPath}`);
  }
  return abs;
}

export async function walkVault(root = VAULT_ROOT, ext = ".md") {
  const results = [];
  async function recurse(dir) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith(".") || SKIP_DIRS.has(e.name)) continue;
      const full = path.join(dir, e.name).replace(/\\/g, "/");
      if (e.isDirectory()) {
        await recurse(full);
      } else if (!ext || e.name.endsWith(ext)) {
        results.push(full);
      }
    }
  }
  await recurse(root);
  return results;
}

export async function readDoc(relPath) {
  const abs = toAbsolute(relPath);
  const raw = await fs.readFile(abs, "utf8");
  const parsed = matter(raw);
  return {
    rel: toRelative(abs),
    abs,
    frontmatter: parsed.data ?? {},
    body: parsed.content ?? "",
    raw,
  };
}

export async function writeDoc(relPath, content, { overwrite = true } = {}) {
  const abs = toAbsolute(relPath);
  if (!overwrite && fssync.existsSync(abs)) {
    throw new Error(`File exists and overwrite=false: ${relPath}`);
  }
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content, "utf8");
  return { rel: toRelative(abs), abs, bytes: Buffer.byteLength(content) };
}

export async function deleteDoc(relPath) {
  const abs = toAbsolute(relPath);
  await fs.unlink(abs);
  return { rel: toRelative(abs), abs };
}

export async function listDir(subdir = "", ext = ".md") {
  const base = subdir ? toAbsolute(subdir) : VAULT_ROOT;
  const files = await walkVault(base, ext);
  return files.map(toRelative).sort();
}

// Split a doc body into overlapping chunks (~token budget) for embedding.
// nemotron max input = 2048 tokens; ~4 chars/token => ~6000 chars safe.
export function chunkText(text, { maxChars = 4000, overlap = 400 } = {}) {
  const clean = text.replace(/\r\n/g, "\n");
  if (clean.length <= maxChars) return [clean];
  const chunks = [];
  let start = 0;
  while (start < clean.length) {
    let end = Math.min(start + maxChars, clean.length);
    // Prefer to break on a paragraph or newline boundary.
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

export function extractTags(frontmatter, body) {
  const tags = new Set();
  const fmTags = frontmatter?.tags;
  if (Array.isArray(fmTags)) fmTags.forEach((t) => tags.add(String(t)));
  else if (typeof fmTags === "string") {
    fmTags.split(/[,\s]+/).forEach((t) => t && tags.add(t));
  }
  for (const m of body.matchAll(/(?:^|\s)#([\w/-]+)/g)) tags.add(m[1]);
  return [...tags].filter(Boolean);
}

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
    ) {
      results.push(rel);
    }
  }
  return results;
}

export { VAULT_ROOT };
