// test/vault.test.mjs — vault path utils, chunking, tag/backlink extraction,
// and real filesystem round-trips against an isolated temp vault.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { TEST_VAULT_ROOT } from "./setup.mjs";
import {
  getVaultRoot,
  toRelative,
  toAbsolute,
  walkVault,
  readDoc,
  writeDoc,
  deleteDoc,
  listDir,
  chunkText,
  extractTags,
  findBacklinks,
} from "../src/lib/vault.mjs";

describe("path helpers", () => {
  it("getVaultRoot reflects the configured root", () => {
    expect(getVaultRoot()).toBe(TEST_VAULT_ROOT);
  });

  it("toRelative strips the vault root and leading slash", () => {
    expect(toRelative(`${TEST_VAULT_ROOT}/a/b.md`)).toBe("a/b.md");
  });

  it("toRelative returns paths outside the vault unchanged", () => {
    expect(toRelative("/somewhere/else.md")).toBe("/somewhere/else.md");
  });

  it("toAbsolute resolves under the vault and normalizes separators", () => {
    expect(toAbsolute("a\\b.md")).toBe(`${TEST_VAULT_ROOT}/a/b.md`);
  });

  it("toAbsolute rejects path traversal escaping the vault", () => {
    expect(() => toAbsolute("../../etc/passwd")).toThrow(/escapes vault root/);
  });
});

describe("chunkText", () => {
  it("returns a single chunk when under the limit", () => {
    expect(chunkText("short text")).toEqual(["short text"]);
  });

  it("normalizes CRLF to LF", () => {
    expect(chunkText("a\r\nb")).toEqual(["a\nb"]);
  });

  it("splits long text into overlapping chunks covering all content", () => {
    const text = Array.from({ length: 2000 }, (_, i) => `line ${i}`).join("\n");
    const chunks = chunkText(text, { maxChars: 1000, overlap: 100 });
    expect(chunks.length).toBeGreaterThan(1);
    // first and last lines are represented somewhere
    expect(chunks[0]).toContain("line 0");
    expect(chunks.at(-1)).toContain("line 1999");
  });

  it("prefers breaking on paragraph/line boundaries", () => {
    const para = "x".repeat(600) + "\n\n" + "y".repeat(600);
    const chunks = chunkText(para, { maxChars: 800, overlap: 50 });
    expect(chunks.length).toBeGreaterThan(1);
    // no chunk should be empty
    expect(chunks.every((c) => c.length > 0)).toBe(true);
  });
});

describe("extractTags", () => {
  it("reads array frontmatter tags", () => {
    expect(extractTags({ tags: ["a", "b"] }, "").sort()).toEqual(["a", "b"]);
  });

  it("splits string frontmatter tags on comma/space", () => {
    expect(extractTags({ tags: "a, b c" }, "").sort()).toEqual(["a", "b", "c"]);
  });

  it("extracts inline #tags from the body", () => {
    const tags = extractTags({}, "some #alpha and #beta/nested text");
    expect(tags).toContain("alpha");
    expect(tags).toContain("beta/nested");
  });

  it("merges and de-duplicates frontmatter + inline tags", () => {
    const tags = extractTags({ tags: ["shared"] }, "#shared #unique");
    expect(tags.sort()).toEqual(["shared", "unique"]);
  });

  it("returns empty for no tags", () => {
    expect(extractTags({}, "no tags here")).toEqual([]);
  });
});

describe("findBacklinks", () => {
  const docs = [
    { rel: "a.md", raw: "links to [[target]] here" },
    { rel: "b.md", raw: "markdown [x](target.md) link" },
    { rel: "c.md", raw: "no reference at all" },
    { rel: "target.md", raw: "self [[target]] must be ignored" },
  ];

  it("finds wikilink and markdown-link backlinks, excluding the target itself", () => {
    const links = findBacklinks("target.md", docs);
    expect(links).toContain("a.md");
    expect(links).toContain("b.md");
    expect(links).not.toContain("c.md");
    expect(links).not.toContain("target.md");
  });

  it("returns empty when nothing links to the target", () => {
    expect(findBacklinks("orphan.md", docs)).toEqual([]);
  });
});

describe("filesystem round-trip (temp vault)", () => {
  const dir = "roundtrip";

  beforeAll(async () => {
    await fs.mkdir(path.join(TEST_VAULT_ROOT, dir), { recursive: true });
  });

  afterAll(async () => {
    await fs.rm(path.join(TEST_VAULT_ROOT, dir), { recursive: true, force: true });
  });

  it("writes, reads (with frontmatter parse), lists, walks, and deletes", async () => {
    const rel = `${dir}/note.md`;
    const content = "---\ntitle: Hello\ntags:\n  - x\n---\n# Body\n\nContent line.";

    const w = await writeDoc(rel, content);
    expect(w.rel).toBe(rel);
    expect(w.bytes).toBe(Buffer.byteLength(content));

    const d = await readDoc(rel);
    expect(d.frontmatter.title).toBe("Hello");
    expect(d.frontmatter.tags).toEqual(["x"]);
    expect(d.body).toContain("# Body");

    const listed = await listDir(dir);
    expect(listed).toContain(rel);

    const walked = await walkVault(path.join(TEST_VAULT_ROOT, dir));
    expect(walked.some((p) => p.endsWith("note.md"))).toBe(true);

    const del = await deleteDoc(rel);
    expect(del.rel).toBe(rel);
    await expect(readDoc(rel)).rejects.toThrow();
  });

  it("respects overwrite=false on existing files", async () => {
    const rel = `${dir}/guard.md`;
    await writeDoc(rel, "first");
    await expect(writeDoc(rel, "second", { overwrite: false })).rejects.toThrow(/overwrite=false/);
    await deleteDoc(rel);
  });

  it("walkVault skips dotfiles and skip-dirs", async () => {
    await fs.mkdir(path.join(TEST_VAULT_ROOT, dir, ".git"), { recursive: true });
    await fs.writeFile(path.join(TEST_VAULT_ROOT, dir, ".git", "hidden.md"), "x");
    await fs.writeFile(path.join(TEST_VAULT_ROOT, dir, "visible.md"), "y");
    const walked = await walkVault(path.join(TEST_VAULT_ROOT, dir));
    expect(walked.some((p) => p.includes(".git"))).toBe(false);
    expect(walked.some((p) => p.endsWith("visible.md"))).toBe(true);
  });
});
