// lib/formats.mjs — document format detection, OKF v0.2 frontmatter validation + enrichment.
//
// OKF v0.2 required fields: type, title, description, tags, timestamp
// Optional fields: format_version, status, related
import path from "node:path";

const SYSTEM_FILENAMES = new Set([
  "CLAUDE.md", "AGENTS.md", "CODEBUDDY.md", "GEMINI.md",
]);
const SYSTEM_DIRS = new Set([".claude", ".opencode", ".cursor"]);
const SYSTEM_SUFFIX_RE = /\.(rules|skills)\.md$/i;

/** OKF v0.2 required fields */
export const OKF_REQUIRED = ["type", "title", "description", "tags", "timestamp"];
/** OKF v0.2 optional fields */
export const OKF_OPTIONAL = ["format_version", "status", "related"];
/** All valid OKF v0.2 types */
export const OKF_TYPES = [
  "note", "decision", "rule", "runbook", "service", "concept", "log",
];

const TYPE_PATTERNS = [
  { type: "decision", re: /\b(chose|decided|decision|option|trade-?off)\b/i },
  { type: "rule",     re: /\b(must|never|always|shall not|required)\b/i },
  { type: "runbook",  re: /\b(step\s+\d|prerequisite|procedure|instructions)\b/i },
  { type: "service",  re: /\b(endpoint|api|service|integration|webhook)\b/i },
];

const WIKILINK_RE = /\[\[([^\]]+?)\]\]/g;

/**
 * @param {string} relPath
 * @returns {boolean}
 */
export function isSystemContextFile(relPath) {
  const normalized = relPath.replace(/\\/g, "/");
  const basename = path.basename(normalized);
  if (SYSTEM_FILENAMES.has(basename)) return true;
  if (SYSTEM_SUFFIX_RE.test(basename)) return true;
  return normalized.split("/").some((p) => SYSTEM_DIRS.has(p));
}

function systemFormatName(relPath) {
  const upper = path.basename(relPath.replace(/\\/g, "/")).toUpperCase();
  if (upper === "AGENTS.MD") return "agents-md";
  return "claude-md";
}

/**
 * Detect the format of a doc and validate OKF compliance.
 * @param {{ rel: string, frontmatter: object, body: string }} doc
 * @returns {{
 *   format: string,
 *   version: string|null,
 *   isSystemContext: boolean,
 *   hasValidFrontmatter: boolean,
 *   missingFields: string[],
 *   invalidFields: string[],
 *   suggestions: object[]
 * }}
 */
export function detectFormat(doc) {
  const { rel, frontmatter, body } = doc;
  const fm = frontmatter ?? {};
  const hasFm = Object.keys(fm).length > 0;
  const isSys = isSystemContextFile(rel);

  if (isSys) {
    return {
      format: systemFormatName(rel), version: null,
      isSystemContext: true, hasValidFrontmatter: hasFm,
      missingFields: [], invalidFields: [], suggestions: [],
    };
  }

  if (!hasFm) {
    return {
      format: "plain", version: null,
      isSystemContext: false, hasValidFrontmatter: false,
      missingFields: OKF_REQUIRED.slice(), invalidFields: [],
      suggestions: suggestOkfFields(doc),
    };
  }

  if (fm.aliases !== undefined || fm.cssclass !== undefined || fm.cssclasses !== undefined) {
    return {
      format: "obsidian", version: null,
      isSystemContext: false, hasValidFrontmatter: true,
      missingFields: OKF_REQUIRED.filter((f) => fm[f] === undefined),
      invalidFields: validateOkfFields(fm),
      suggestions: suggestOkfFields(doc),
    };
  }

  if (fm.type !== undefined) {
    const missing = OKF_REQUIRED.filter((f) => fm[f] === undefined);
    return {
      format: "okf", version: fm.format_version ?? "v0.2",
      isSystemContext: false, hasValidFrontmatter: missing.length === 0,
      missingFields: missing, invalidFields: validateOkfFields(fm),
      suggestions: suggestOkfFields(doc),
    };
  }

  return {
    format: "plain", version: null,
    isSystemContext: false, hasValidFrontmatter: true,
    missingFields: OKF_REQUIRED.filter((f) => fm[f] === undefined),
    invalidFields: validateOkfFields(fm),
    suggestions: suggestOkfFields(doc),
  };
}

/**
 * Validate OKF field values. Returns list of field names with invalid values.
 * @param {object} fm
 * @returns {string[]}
 */
function validateOkfFields(fm) {
  const invalid = [];
  if (fm.type !== undefined && !OKF_TYPES.includes(fm.type)) {
    invalid.push(`type (got "${fm.type}", valid: ${OKF_TYPES.join(", ")})`);
  }
  if (fm.tags !== undefined && !Array.isArray(fm.tags)) {
    invalid.push("tags (must be array)");
  }
  if (fm.related !== undefined && !Array.isArray(fm.related)) {
    invalid.push("related (must be array)");
  }
  return invalid;
}

function inferType(body) {
  for (const { type, re } of TYPE_PATTERNS) {
    if (re.test(body)) return type;
  }
  return "note";
}

function extractTagsFromBody(body) {
  const tags = new Set();
  const headingRe = /^#{1,3}\s+(.+)$/gm;
  let m;
  while ((m = headingRe.exec(body)) !== null) {
    m[1].toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .split(/\s+/)
      .filter((w) => w.length > 2 && w.length < 30)
      .forEach((w) => tags.add(w));
  }
  const boldRe = /\*\*([^*]+)\*\*/g;
  while ((m = boldRe.exec(body)) !== null) {
    const word = m[1].trim().toLowerCase().replace(/[^a-z0-9-]/g, "");
    if (word.length > 2 && word.length < 30) tags.add(word);
  }
  return [...tags].slice(0, 10);
}

function titleFromDoc(doc) {
  const h1 = /^#\s+(.+)$/m.exec(doc.body);
  if (h1) return h1[1].trim();
  return path.basename(doc.rel.replace(/\\/g, "/"), ".md").replace(/[-_]/g, " ");
}

function descriptionFromBody(body) {
  const first = body.split(/\n/).find((l) => l.trim() && !l.startsWith("#"));
  return first ? first.trim().slice(0, 200) : null;
}

/**
 * Suggest missing OKF fields based on content analysis.
 * @param {{ rel: string, frontmatter: object, body: string }} doc
 * @returns {{ field: string, value: unknown, reason: string }[]}
 */
export function suggestOkfFields(doc) {
  const { frontmatter, body, rel } = doc;
  const fm = frontmatter ?? {};
  const suggestions = [];

  if (fm.type === undefined)
    suggestions.push({ field: "type", value: inferType(body ?? ""), reason: "inferred from content patterns" });

  if (fm.tags === undefined) {
    const tags = extractTagsFromBody(body ?? "");
    if (tags.length > 0)
      suggestions.push({ field: "tags", value: tags, reason: "detected in body" });
  }

  if (fm.title === undefined) {
    const title = titleFromDoc(doc);
    if (title) suggestions.push({ field: "title", value: title, reason: "derived from heading or filename" });
  }

  if (fm.description === undefined) {
    const desc = descriptionFromBody(body ?? "");
    if (desc) suggestions.push({ field: "description", value: desc, reason: "first paragraph of body" });
  }

  if (fm.timestamp === undefined) {
    const ts = fm.created ?? fm.date ?? null;
    if (ts) suggestions.push({ field: "timestamp", value: String(ts), reason: "from existing frontmatter date field" });
  }

  if (fm.format_version === undefined)
    suggestions.push({ field: "format_version", value: "v0.2", reason: "OKF standard version" });

  return suggestions;
}

/**
 * Merge suggestions into existing frontmatter (non-destructive).
 * @param {{ field: string, value: unknown }[]} suggestions
 * @param {object} existing
 * @returns {object}
 */
export function buildOkfFrontmatter(suggestions, existing = {}) {
  const result = { ...existing };
  for (const s of suggestions) {
    if (result[s.field] === undefined) result[s.field] = s.value;
  }
  return result;
}

/**
 * Apply OKF suggestions directly to a doc's frontmatter in-place
 * and return stringified YAML + body ready to write back.
 * @param {{ rel: string, frontmatter: object, body: string, raw: string }} doc
 * @returns {{ enriched: object, changed: boolean }}
 */
export function enrichOkfFrontmatter(doc) {
  const suggestions = suggestOkfFields(doc);
  const enriched = buildOkfFrontmatter(suggestions, doc.frontmatter ?? {});
  const changed = suggestions.some((s) => (doc.frontmatter ?? {})[s.field] === undefined);
  return { enriched, changed };
}

/**
 * Extract [[wikilinks]] from a markdown body.
 * @param {string} body
 * @returns {{ target: string, alias: string|null, section: string|null }[]}
 */
export function extractWikilinks(body) {
  const links = [];
  WIKILINK_RE.lastIndex = 0;
  let m;
  while ((m = WIKILINK_RE.exec(body)) !== null) {
    const inner = m[1];
    let target = inner;
    let alias = null;
    let section = null;

    const pipeIdx = inner.indexOf("|");
    if (pipeIdx !== -1) {
      target = inner.slice(0, pipeIdx);
      alias = inner.slice(pipeIdx + 1);
    }

    const hashIdx = target.indexOf("#");
    if (hashIdx !== -1) {
      section = target.slice(hashIdx + 1);
      target = target.slice(0, hashIdx);
    }

    links.push({ target, alias, section });
  }
  return links;
}

/**
 * Resolve a [[wikilink]] target to a vault-relative path.
 * @param {string} target
 * @param {string} fromPath
 * @param {string[]} allPaths
 * @returns {string|null}
 */
export function resolveWikilink(target, fromPath, allPaths) {
  const normalized = target.replace(/\\/g, "/");
  const withExt = normalized.endsWith(".md") ? normalized : normalized + ".md";

  for (const p of allPaths) if (p === withExt) return p;

  const lowerTarget = withExt.toLowerCase();
  for (const p of allPaths) if (p.toLowerCase() === lowerTarget) return p;

  const basename = path.basename(withExt).toLowerCase();
  for (const p of allPaths) if (path.basename(p).toLowerCase() === basename) return p;

  return null;
}
