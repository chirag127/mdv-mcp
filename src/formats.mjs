import path from "node:path";

const SYSTEM_FILENAMES = new Set([
  "CLAUDE.md", "AGENTS.md", "CODEBUDDY.md", "GEMINI.md",
]);

const SYSTEM_DIRS = new Set([".claude", ".opencode", ".cursor"]);

const SYSTEM_SUFFIX_RE = /\.(rules|skills)\.md$/i;

const OKF_REQUIRED = ["type", "title", "description", "tags", "timestamp"];

const TYPE_PATTERNS = [
  { type: "decision", re: /\b(chose|decided|decision|option|trade-?off)\b/i },
  { type: "rule", re: /\b(must|never|always|shall not|required)\b/i },
  { type: "runbook", re: /\b(step\s+\d|prerequisite|procedure|instructions)\b/i },
  { type: "service", re: /\b(endpoint|api|service|integration|webhook)\b/i },
];

const WIKILINK_RE = /\[\[([^\]]+?)\]\]/g;

export function isSystemContextFile(relPath) {
  const normalized = relPath.replace(/\\/g, "/");
  const basename = path.basename(normalized);
  if (SYSTEM_FILENAMES.has(basename)) return true;
  if (SYSTEM_SUFFIX_RE.test(basename)) return true;
  const parts = normalized.split("/");
  return parts.some((p) => SYSTEM_DIRS.has(p));
}

function systemFormatName(relPath) {
  const basename = path.basename(relPath.replace(/\\/g, "/"));
  const upper = basename.toUpperCase();
  if (upper === "AGENTS.MD") return "agents-md";
  if (upper === "CLAUDE.MD") return "claude-md";
  return "claude-md";
}

export function detectFormat(doc) {
  const { rel, frontmatter, body } = doc;
  const fm = frontmatter ?? {};
  const hasFm = Object.keys(fm).length > 0;
  const isSys = isSystemContextFile(rel);

  if (isSys) {
    return {
      format: systemFormatName(rel),
      version: null,
      isSystemContext: true,
      hasValidFrontmatter: hasFm,
      missingFields: [],
      suggestions: [],
    };
  }

  if (!hasFm) {
    const suggestions = suggestOkfFields(doc);
    return {
      format: "plain",
      version: null,
      isSystemContext: false,
      hasValidFrontmatter: false,
      missingFields: OKF_REQUIRED.slice(),
      suggestions,
    };
  }

  if (fm.aliases !== undefined || fm.cssclass !== undefined || fm.cssclasses !== undefined) {
    return {
      format: "obsidian",
      version: null,
      isSystemContext: false,
      hasValidFrontmatter: true,
      missingFields: OKF_REQUIRED.filter((f) => fm[f] === undefined),
      suggestions: suggestOkfFields(doc),
    };
  }

  if (fm.type !== undefined) {
    const missing = OKF_REQUIRED.filter((f) => fm[f] === undefined);
    return {
      format: "okf",
      version: "v0.2",
      isSystemContext: false,
      hasValidFrontmatter: true,
      missingFields: missing,
      suggestions: suggestOkfFields(doc),
    };
  }

  return {
    format: "plain",
    version: null,
    isSystemContext: false,
    hasValidFrontmatter: true,
    missingFields: OKF_REQUIRED.filter((f) => fm[f] === undefined),
    suggestions: suggestOkfFields(doc),
  };
}

function inferType(body) {
  for (const { type, re } of TYPE_PATTERNS) {
    if (re.test(body)) return type;
  }
  return "note";
}

function extractTags(body) {
  const tags = new Set();
  const headingRe = /^#{1,3}\s+(.+)$/gm;
  let m;
  while ((m = headingRe.exec(body)) !== null) {
    const words = m[1]
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .split(/\s+/)
      .filter((w) => w.length > 2 && w.length < 30);
    for (const w of words) tags.add(w);
  }

  const boldRe = /\*\*([^*]+)\*\*/g;
  while ((m = boldRe.exec(body)) !== null) {
    const word = m[1].trim().toLowerCase().replace(/[^a-z0-9-]/g, "");
    if (word.length > 2 && word.length < 30) tags.add(word);
  }

  return [...tags].slice(0, 10);
}

function titleFromDoc(doc) {
  const { body, rel } = doc;
  const h1 = /^#\s+(.+)$/m.exec(body);
  if (h1) return h1[1].trim();
  const basename = path.basename(rel.replace(/\\/g, "/"), ".md");
  return basename.replace(/[-_]/g, " ");
}

function descriptionFromBody(body) {
  const lines = body.split(/\n/).filter((l) => l.trim() && !l.startsWith("#"));
  const first = lines[0];
  if (!first) return null;
  return first.trim().slice(0, 200);
}

export function suggestOkfFields(doc) {
  const { frontmatter, body, rel } = doc;
  const fm = frontmatter ?? {};
  const suggestions = [];

  if (fm.type === undefined) {
    suggestions.push({
      field: "type",
      value: inferType(body ?? ""),
      reason: "inferred from content patterns",
    });
  }

  if (fm.tags === undefined) {
    const tags = extractTags(body ?? "");
    if (tags.length > 0) {
      suggestions.push({
        field: "tags",
        value: tags,
        reason: "detected in body",
      });
    }
  }

  if (fm.title === undefined) {
    const title = titleFromDoc(doc);
    if (title) {
      suggestions.push({
        field: "title",
        value: title,
        reason: "derived from heading or filename",
      });
    }
  }

  if (fm.description === undefined) {
    const desc = descriptionFromBody(body ?? "");
    if (desc) {
      suggestions.push({
        field: "description",
        value: desc,
        reason: "first paragraph of body",
      });
    }
  }

  if (fm.timestamp === undefined) {
    const ts = fm.created ?? fm.date ?? null;
    if (ts) {
      suggestions.push({
        field: "timestamp",
        value: String(ts),
        reason: "from existing frontmatter date field",
      });
    }
  }

  return suggestions;
}

export function buildOkfFrontmatter(suggestions, existing = {}) {
  const result = { ...existing };
  for (const s of suggestions) {
    if (result[s.field] === undefined) {
      result[s.field] = s.value;
    }
  }
  return result;
}

export function extractWikilinks(body) {
  const links = [];
  let m;
  WIKILINK_RE.lastIndex = 0;
  while ((m = WIKILINK_RE.exec(body)) !== null) {
    const inner = m[1];
    let target;
    let alias = null;
    let section = null;

    const pipeIdx = inner.indexOf("|");
    const hashIdx = inner.indexOf("#");

    if (pipeIdx !== -1) {
      target = inner.slice(0, pipeIdx);
      alias = inner.slice(pipeIdx + 1);
    } else {
      target = inner;
    }

    const targetHash = target.indexOf("#");
    if (targetHash !== -1) {
      section = target.slice(targetHash + 1);
      target = target.slice(0, targetHash);
    }

    links.push({ target, alias, section });
  }
  return links;
}

export function resolveWikilink(target, fromPath, allPaths) {
  const normalized = target.replace(/\\/g, "/");
  const withExt = normalized.endsWith(".md") ? normalized : normalized + ".md";

  for (const p of allPaths) {
    if (p === withExt) return p;
  }

  const lowerTarget = withExt.toLowerCase();
  for (const p of allPaths) {
    if (p.toLowerCase() === lowerTarget) return p;
  }

  const basename = path.basename(withExt).toLowerCase();
  for (const p of allPaths) {
    if (path.basename(p).toLowerCase() === basename) return p;
  }

  return null;
}
