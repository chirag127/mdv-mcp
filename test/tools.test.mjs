// test/tools.test.mjs — MCP tool-call handlers as plain unit tests.
// A fake server captures the (name, description, schema, handler) tuples that
// each register* fn passes to server.tool(); we then invoke the real handlers
// and assert the JSON payload they return. No transport, no network.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { TEST_VAULT_ROOT } from "./setup.mjs";
import { config } from "../src/config.mjs";
import { Indexer } from "../src/lib/indexer.mjs";
import { Memory } from "../src/lib/memory-store.mjs";
import { registerReadTools } from "../src/tools/read.mjs";
import { registerWriteTools } from "../src/tools/write.mjs";
import { registerSearchTools } from "../src/tools/search.mjs";
import { registerMemoryTools } from "../src/tools/memory.mjs";

/** Minimal server double that records tool handlers by name. */
function fakeServer() {
  const tools = new Map();
  return {
    tool(name, description, schema, handler) {
      tools.set(name, { description, schema, handler });
    },
    async call(name, args) {
      const t = tools.get(name);
      if (!t) throw new Error(`tool not registered: ${name}`);
      return t.handler(args);
    },
    names() {
      return [...tools.keys()];
    },
  };
}

/** Parse the JSON text payload out of an MCP text result. */
function payload(result) {
  expect(result.content[0].type).toBe("text");
  return JSON.parse(result.content[0].text);
}

const SUB = "tools-fixture";
const abs = (rel) => path.join(TEST_VAULT_ROOT, rel);

async function seedVault() {
  await fs.mkdir(abs(SUB), { recursive: true });
  await fs.writeFile(
    abs(`${SUB}/alpha.md`),
    "---\ntitle: Alpha\ntags:\n  - shared\n---\n# Alpha\n\nThe quick brown fox. See [[beta]].",
  );
  await fs.writeFile(
    abs(`${SUB}/beta.md`),
    "---\ntitle: Beta\ntags:\n  - shared\n  - unique\n---\n# Beta\n\nlazy dog content #inline",
  );
}

describe("MCP tool handlers", () => {
  let server;
  let indexer;
  let memory;

  beforeAll(async () => {
    await fs.rm(abs(SUB), { recursive: true, force: true });
    await fs.rm(config.CACHE_DIR, { recursive: true, force: true });
    await seedVault();

    indexer = new Indexer();
    await indexer.init({ embed: false }); // no API key => TF-IDF only, no network
    memory = new Memory();
    await memory.load();

    server = fakeServer();
    registerReadTools(server, indexer);
    registerWriteTools(server, indexer);
    registerSearchTools(server, indexer);
    registerMemoryTools(server, memory);
  });

  afterAll(async () => {
    await fs.rm(abs(SUB), { recursive: true, force: true });
    await fs.rm(config.CACHE_DIR, { recursive: true, force: true });
  });

  it("registers the full tool surface", () => {
    const names = server.names();
    for (const n of [
      "vault_read", "vault_frontmatter", "vault_list", "vault_wikilinks",
      "vault_write", "vault_delete", "vault_format",
      "vault_search", "vault_tags", "vault_backlinks", "vault_stats",
      "vault_remember", "vault_recall", "vault_memory_stats", "vault_memory_archive",
    ]) {
      expect(names).toContain(n);
    }
  });

  describe("read tools", () => {
    it("vault_read returns frontmatter, body, detected format, and wikilinks", async () => {
      const p = payload(await server.call("vault_read", { path: `${SUB}/alpha.md` }));
      expect(p.path).toBe(`${SUB}/alpha.md`);
      expect(p.frontmatter.title).toBe("Alpha");
      expect(p.body).toContain("quick brown fox");
      // frontmatter has title/tags but no OKF `type` and no obsidian markers => plain
      expect(p.format.format).toBe("plain");
      expect(p.wikilinks[0].target).toBe("beta");
    });

    it("vault_frontmatter returns only frontmatter", async () => {
      const p = payload(await server.call("vault_frontmatter", { path: `${SUB}/beta.md` }));
      expect(p.frontmatter.title).toBe("Beta");
      expect(p.body).toBeUndefined();
    });

    it("vault_list lists seeded files under a subdir", async () => {
      const p = payload(await server.call("vault_list", { subdir: SUB }));
      expect(p.count).toBe(2);
      expect(p.files).toContain(`${SUB}/alpha.md`);
      expect(p.files).toContain(`${SUB}/beta.md`);
    });

    it("vault_wikilinks resolves [[beta]] to beta.md", async () => {
      const p = payload(await server.call("vault_wikilinks", { path: `${SUB}/alpha.md` }));
      expect(p.count).toBe(1);
      expect(p.wikilinks[0].target).toBe("beta");
      expect(p.wikilinks[0].resolvedPath).toBe(`${SUB}/beta.md`);
    });
  });

  describe("search tools", () => {
    it("vault_search (TF-IDF fallback) finds the fox note", async () => {
      const p = payload(await server.call("vault_search", { query: "quick brown fox", limit: 5 }));
      expect(p.count).toBeGreaterThan(0);
      expect(p.results[0].rel).toBe(`${SUB}/alpha.md`);
      expect(p.results[0].via).toBe("tfidf");
    });

    it("vault_tags aggregates frontmatter + inline tags by frequency", async () => {
      const p = payload(await server.call("vault_tags", {}));
      const byTag = Object.fromEntries(p.tags.map((t) => [t.tag, t.count]));
      expect(byTag.shared).toBe(2);
      expect(byTag.unique).toBe(1);
      expect(byTag.inline).toBe(1);
    });

    it("vault_backlinks finds notes linking to beta", async () => {
      const p = payload(await server.call("vault_backlinks", { path: `${SUB}/beta.md` }));
      expect(p.backlinks).toContain(`${SUB}/alpha.md`);
    });

    it("vault_stats reports embeddings disabled and docs loaded", async () => {
      const p = payload(await server.call("vault_stats", {}));
      expect(p.embeddingsEnabled).toBe(false);
      expect(p.docsLoaded).toBeGreaterThanOrEqual(2);
      expect(p.dims).toBe(config.EMBED_DIMS);
    });
  });

  describe("write tools", () => {
    it("vault_write creates a file and reindexes it (findable via list)", async () => {
      const rel = `${SUB}/created.md`;
      const p = payload(
        await server.call("vault_write", { path: rel, content: "# New\n\nhello", overwrite: true }),
      );
      expect(p.written).toBe(rel);
      expect(p.bytes).toBeGreaterThan(0);
      const list = payload(await server.call("vault_list", { subdir: SUB }));
      expect(list.files).toContain(rel);
    });

    it("vault_format suggests OKF fields without applying by default", async () => {
      const p = payload(await server.call("vault_format", { path: `${SUB}/created.md`, apply: false }));
      expect(p.applied).toBe(false);
      expect(p.suggestions.some((s) => s.field === "type")).toBe(true);
      expect(p.suggestedFrontmatter.format_version).toBe("v0.2");
    });

    it("vault_format apply=true writes enriched frontmatter back", async () => {
      const rel = `${SUB}/created.md`;
      const p = payload(await server.call("vault_format", { path: rel, apply: true }));
      expect(p.applied).toBe(true);
      const read = payload(await server.call("vault_read", { path: rel }));
      expect(read.frontmatter.type).toBeDefined();
      expect(read.frontmatter.title).toBe("New");
    });

    it("vault_delete removes the file from vault and index", async () => {
      const rel = `${SUB}/created.md`;
      const p = payload(await server.call("vault_delete", { path: rel }));
      expect(p.deleted).toBe(rel);
      const list = payload(await server.call("vault_list", { subdir: SUB }));
      expect(list.files).not.toContain(rel);
    });
  });

  describe("memory tools", () => {
    beforeEach(async () => {
      // fresh memory per assertion group
      await fs.rm(config.CACHE_DIR, { recursive: true, force: true });
      memory.memories = [];
    });

    it("vault_remember saves and vault_recall retrieves it", async () => {
      const saved = payload(
        await server.call("vault_remember", {
          title: "Decided X", content: "we chose X", type: "decision", tags: ["t"], related: [], project: "proj", source: "claude-code",
        }),
      );
      expect(saved.saved).toBe(true);
      expect(saved.memory.type).toBe("decision");

      const recalled = payload(await server.call("vault_recall", { query: "chose", limit: 10 }));
      expect(recalled.count).toBe(1);
      expect(recalled.memories[0].title).toBe("Decided X");
    });

    it("vault_memory_stats reports counts", async () => {
      await server.call("vault_remember", { title: "A", content: "c", type: "insight", tags: [], related: [] });
      const p = payload(await server.call("vault_memory_stats", {}));
      expect(p.total).toBe(1);
      expect(p.active).toBe(1);
    });

    it("vault_memory_archive archives by id and errors on unknown id", async () => {
      const saved = payload(
        await server.call("vault_remember", { title: "A", content: "c", type: "insight", tags: [], related: [] }),
      );
      const arch = payload(await server.call("vault_memory_archive", { id: saved.memory.id }));
      expect(arch.archived).toBe(true);
      const miss = payload(await server.call("vault_memory_archive", { id: "does-not-exist" }));
      expect(miss.error).toBeTruthy();
    });
  });
});
