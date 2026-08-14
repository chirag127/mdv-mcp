// test/memory-store.test.mjs — persistent memory store: remember/recall/archive/
// supersede/stats + filtering. Uses the isolated temp cache dir.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import { Memory } from "../src/lib/memory-store.mjs";
import { config } from "../src/config.mjs";

async function clearCache() {
  await fs.rm(config.CACHE_DIR, { recursive: true, force: true });
}

describe("Memory", () => {
  beforeEach(clearCache);
  afterEach(clearCache);

  it("remembers with defaults and persists to disk", async () => {
    const m = new Memory();
    const rec = await m.remember({ title: "T", content: "C" });
    expect(rec.id).toBeTruthy();
    expect(rec.type).toBe("insight");
    expect(rec.status).toBe("active");
    expect(rec.source).toBe("manual");
    expect(rec.tags).toEqual([]);

    // Reload from disk into a fresh instance
    const m2 = new Memory();
    await m2.load();
    const recalled = await m2.recall({});
    expect(recalled).toHaveLength(1);
    expect(recalled[0].title).toBe("T");
  });

  it("recall filters by project, type, and query, and hides archived by default", async () => {
    const m = new Memory();
    await m.remember({ title: "Alpha", content: "about cats", project: "p1", type: "decision" });
    await m.remember({ title: "Beta", content: "about dogs", project: "p2", type: "bug" });
    const archived = await m.remember({ title: "Gamma", content: "old", project: "p1" });
    await m.archive(archived.id);

    expect(await m.recall({ project: "p1" })).toHaveLength(1); // gamma archived, alpha active
    expect((await m.recall({ project: "p1" }))[0].title).toBe("Alpha");
    expect(await m.recall({ type: "bug" })).toHaveLength(1);
    expect(await m.recall({ query: "dogs" })).toHaveLength(1);
    expect(await m.recall({ query: "CATS" })).toHaveLength(1); // case-insensitive
    expect(await m.recall({ project: "p1", includeArchived: true })).toHaveLength(2);
  });

  it("recall orders newest first and honors limit", async () => {
    const m = new Memory();
    await m.remember({ title: "old", content: "c" });
    await new Promise((r) => setTimeout(r, 5));
    await m.remember({ title: "new", content: "c" });
    const all = await m.recall({});
    expect(all[0].title).toBe("new");
    expect(await m.recall({ limit: 1 })).toHaveLength(1);
  });

  it("archive marks status and returns null for unknown id", async () => {
    const m = new Memory();
    const rec = await m.remember({ title: "T", content: "C" });
    const arch = await m.archive(rec.id);
    expect(arch.status).toBe("archived");
    expect(await m.archive("nope")).toBeNull();
  });

  it("supersede marks the old record and links related, returning new record", async () => {
    const m = new Memory();
    const old = await m.remember({ title: "Old", content: "C", related: ["r1.md"] });
    const created = await m.supersede(old.id, { title: "New", content: "C2", related: ["r2.md"] });
    expect(created.supersedes).toBe(old.id);
    expect(created.related).toEqual(expect.arrayContaining(["r1.md", "r2.md"]));
    const oldNow = (await m.recall({ includeArchived: true })).find((x) => x.id === old.id);
    expect(oldNow.status).toBe("superseded");
    expect(await m.supersede("nope", { title: "x", content: "y" })).toBeNull();
  });

  it("stats aggregates totals, active/archived, byProject, byType", async () => {
    const m = new Memory();
    await m.remember({ title: "A", content: "c", project: "p1", type: "decision" });
    const b = await m.remember({ title: "B", content: "c", project: "p1", type: "bug" });
    await m.archive(b.id);
    const s = await m.stats();
    expect(s.total).toBe(2);
    expect(s.active).toBe(1);
    expect(s.archived).toBe(1);
    expect(s.byProject.p1).toBe(2);
    expect(s.byType.decision).toBe(1);
    expect(s.byType.bug).toBe(1);
  });

  it("load tolerates a missing store file", async () => {
    const m = new Memory();
    await m.load();
    expect(m.memories).toEqual([]);
  });
});
