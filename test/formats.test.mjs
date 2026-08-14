// test/formats.test.mjs — OKF format detection, frontmatter enrichment, wikilinks.
import { describe, it, expect } from "vitest";
import {
  OKF_REQUIRED,
  OKF_TYPES,
  isSystemContextFile,
  detectFormat,
  suggestOkfFields,
  buildOkfFrontmatter,
  enrichOkfFrontmatter,
  extractWikilinks,
  resolveWikilink,
} from "../src/lib/formats.mjs";

describe("isSystemContextFile", () => {
  it("flags known system filenames regardless of directory", () => {
    expect(isSystemContextFile("CLAUDE.md")).toBe(true);
    expect(isSystemContextFile("sub/dir/AGENTS.md")).toBe(true);
    expect(isSystemContextFile("GEMINI.md")).toBe(true);
  });

  it("flags .rules.md / .skills.md suffixes case-insensitively", () => {
    expect(isSystemContextFile("foo.rules.md")).toBe(true);
    expect(isSystemContextFile("bar.SKILLS.md")).toBe(true);
  });

  it("flags files inside system dirs, including Windows separators", () => {
    expect(isSystemContextFile(".claude/config.md")).toBe(true);
    expect(isSystemContextFile("a\\.cursor\\rules.md")).toBe(true);
    expect(isSystemContextFile(".opencode/x.md")).toBe(true);
  });

  it("does not flag ordinary notes", () => {
    expect(isSystemContextFile("notes/idea.md")).toBe(false);
    expect(isSystemContextFile("README.md")).toBe(false);
  });
});

describe("detectFormat", () => {
  it("classifies system context files without OKF validation", () => {
    const r = detectFormat({ rel: "AGENTS.md", frontmatter: {}, body: "hi" });
    expect(r.format).toBe("agents-md");
    expect(r.isSystemContext).toBe(true);
    expect(r.missingFields).toEqual([]);
    expect(r.suggestions).toEqual([]);
  });

  it("classifies CLAUDE.md as claude-md", () => {
    const r = detectFormat({ rel: "docs/CLAUDE.md", frontmatter: {}, body: "" });
    expect(r.format).toBe("claude-md");
    expect(r.isSystemContext).toBe(true);
  });

  it("treats a doc with no frontmatter as plain and lists all required fields missing", () => {
    const r = detectFormat({ rel: "note.md", frontmatter: {}, body: "# Title\n\ntext" });
    expect(r.format).toBe("plain");
    expect(r.hasValidFrontmatter).toBe(false);
    expect(r.missingFields).toEqual(OKF_REQUIRED);
    expect(r.suggestions.length).toBeGreaterThan(0);
  });

  it("detects obsidian format via aliases/cssclass", () => {
    const r = detectFormat({ rel: "n.md", frontmatter: { aliases: ["x"] }, body: "b" });
    expect(r.format).toBe("obsidian");
    expect(r.hasValidFrontmatter).toBe(true);
  });

  it("detects full OKF doc as valid when all required fields present", () => {
    const fm = {
      type: "note",
      title: "T",
      description: "D",
      tags: ["a"],
      timestamp: "2026-01-01",
    };
    const r = detectFormat({ rel: "n.md", frontmatter: fm, body: "b" });
    expect(r.format).toBe("okf");
    expect(r.version).toBe("v0.2");
    expect(r.hasValidFrontmatter).toBe(true);
    expect(r.missingFields).toEqual([]);
    expect(r.invalidFields).toEqual([]);
  });

  it("reports missing OKF fields and honors custom format_version", () => {
    const r = detectFormat({
      rel: "n.md",
      frontmatter: { type: "note", format_version: "v0.3" },
      body: "b",
    });
    expect(r.format).toBe("okf");
    expect(r.version).toBe("v0.3");
    expect(r.hasValidFrontmatter).toBe(false);
    expect(r.missingFields).toContain("title");
    expect(r.missingFields).toContain("timestamp");
  });

  it("flags invalid OKF field values (bad type, non-array tags)", () => {
    const r = detectFormat({
      rel: "n.md",
      frontmatter: { type: "bogus", tags: "not-array", title: "T", description: "D", timestamp: "t" },
      body: "b",
    });
    const joined = r.invalidFields.join(" ");
    expect(joined).toMatch(/type/);
    expect(joined).toMatch(/tags/);
  });

  it("treats frontmatter without type/obsidian markers as plain", () => {
    const r = detectFormat({ rel: "n.md", frontmatter: { foo: "bar" }, body: "b" });
    expect(r.format).toBe("plain");
    expect(r.hasValidFrontmatter).toBe(true);
    expect(r.missingFields).toEqual(OKF_REQUIRED);
  });
});

describe("suggestOkfFields", () => {
  it("infers type from decision keywords in the body", () => {
    const s = suggestOkfFields({ rel: "n.md", frontmatter: {}, body: "We decided to chose option A." });
    const typeSug = s.find((x) => x.field === "type");
    expect(typeSug.value).toBe("decision");
  });

  it("infers rule type from imperative keywords", () => {
    const s = suggestOkfFields({ rel: "n.md", frontmatter: {}, body: "You must never do this." });
    expect(s.find((x) => x.field === "type").value).toBe("rule");
  });

  it("defaults type to note when no pattern matches", () => {
    const s = suggestOkfFields({ rel: "n.md", frontmatter: {}, body: "plain prose here" });
    expect(s.find((x) => x.field === "type").value).toBe("note");
  });

  it("derives title from H1 heading over filename", () => {
    const s = suggestOkfFields({ rel: "some-file.md", frontmatter: {}, body: "# Real Title\n\nbody" });
    expect(s.find((x) => x.field === "title").value).toBe("Real Title");
  });

  it("falls back to filename (dashes to spaces) when no H1", () => {
    const s = suggestOkfFields({ rel: "my-cool_note.md", frontmatter: {}, body: "no heading" });
    expect(s.find((x) => x.field === "title").value).toBe("my cool note");
  });

  it("suggests description from first non-heading paragraph", () => {
    const s = suggestOkfFields({ rel: "n.md", frontmatter: {}, body: "# H\n\nFirst paragraph." });
    expect(s.find((x) => x.field === "description").value).toBe("First paragraph.");
  });

  it("always suggests format_version v0.2", () => {
    const s = suggestOkfFields({ rel: "n.md", frontmatter: {}, body: "x" });
    expect(s.find((x) => x.field === "format_version").value).toBe("v0.2");
  });

  it("pulls timestamp from existing created/date field", () => {
    const s = suggestOkfFields({ rel: "n.md", frontmatter: { date: "2026-05-01" }, body: "x" });
    expect(s.find((x) => x.field === "timestamp").value).toBe("2026-05-01");
  });

  it("does not suggest fields already present", () => {
    const s = suggestOkfFields({ rel: "n.md", frontmatter: { type: "note", title: "T" }, body: "x" });
    expect(s.find((x) => x.field === "type")).toBeUndefined();
    expect(s.find((x) => x.field === "title")).toBeUndefined();
  });
});

describe("buildOkfFrontmatter", () => {
  it("merges suggestions non-destructively, keeping existing values", () => {
    const suggestions = [
      { field: "type", value: "note" },
      { field: "title", value: "New" },
    ];
    const merged = buildOkfFrontmatter(suggestions, { title: "Existing" });
    expect(merged.title).toBe("Existing");
    expect(merged.type).toBe("note");
  });

  it("defaults existing to empty object", () => {
    const merged = buildOkfFrontmatter([{ field: "x", value: 1 }]);
    expect(merged).toEqual({ x: 1 });
  });
});

describe("enrichOkfFrontmatter", () => {
  it("reports changed=true and fills missing fields", () => {
    const { enriched, changed } = enrichOkfFrontmatter({
      rel: "n.md",
      frontmatter: {},
      body: "# Title\n\nbody",
    });
    expect(changed).toBe(true);
    expect(enriched.type).toBeDefined();
    expect(enriched.title).toBe("Title");
    expect(enriched.format_version).toBe("v0.2");
  });

  it("reports changed=false when nothing to add", () => {
    const fm = {
      type: "note",
      title: "T",
      description: "D",
      tags: ["a"],
      timestamp: "t",
      format_version: "v0.2",
    };
    const { changed } = enrichOkfFrontmatter({ rel: "n.md", frontmatter: fm, body: "x" });
    expect(changed).toBe(false);
  });
});

describe("extractWikilinks", () => {
  it("extracts a bare wikilink", () => {
    expect(extractWikilinks("see [[Note]]")).toEqual([
      { target: "Note", alias: null, section: null },
    ]);
  });

  it("parses alias via pipe", () => {
    expect(extractWikilinks("[[target|Display]]")).toEqual([
      { target: "target", alias: "Display", section: null },
    ]);
  });

  it("parses section via hash", () => {
    expect(extractWikilinks("[[doc#Heading]]")).toEqual([
      { target: "doc", alias: null, section: "Heading" },
    ]);
  });

  it("parses combined section + alias", () => {
    expect(extractWikilinks("[[doc#Sec|Nice]]")).toEqual([
      { target: "doc", alias: "Nice", section: "Sec" },
    ]);
  });

  it("extracts multiple links and is repeatable (lastIndex reset)", () => {
    const body = "[[a]] and [[b]]";
    expect(extractWikilinks(body)).toHaveLength(2);
    // second call must not be affected by the stateful global regex
    expect(extractWikilinks(body)).toHaveLength(2);
  });

  it("returns empty array when there are no links", () => {
    expect(extractWikilinks("no links here")).toEqual([]);
  });
});

describe("resolveWikilink", () => {
  const all = ["okf/index.md", "notes/Foo.md", "deep/nested/Bar.md"];

  it("resolves exact relative path (adds .md)", () => {
    expect(resolveWikilink("okf/index", "x.md", all)).toBe("okf/index.md");
  });

  it("resolves case-insensitively on full path", () => {
    expect(resolveWikilink("OKF/INDEX", "x.md", all)).toBe("okf/index.md");
  });

  it("resolves by basename when path differs", () => {
    expect(resolveWikilink("Bar", "x.md", all)).toBe("deep/nested/Bar.md");
    expect(resolveWikilink("foo", "x.md", all)).toBe("notes/Foo.md");
  });

  it("returns null when unresolvable", () => {
    expect(resolveWikilink("does-not-exist", "x.md", all)).toBeNull();
  });
});

describe("exported OKF constants", () => {
  it("has the documented required and type sets", () => {
    expect(OKF_REQUIRED).toEqual(["type", "title", "description", "tags", "timestamp"]);
    expect(OKF_TYPES).toContain("decision");
    expect(OKF_TYPES).toContain("runbook");
  });
});
