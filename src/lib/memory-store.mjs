// lib/memory-store.mjs — persistent memory store for session conclusions/decisions.
import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.mjs";

/** @returns {string} */
function memoryFile() {
  return path.join(config.CACHE_DIR, "memories.json");
}

function generateId() {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${ts}-${rand}`;
}

export class Memory {
  constructor() {
    /** @type {object[]} */
    this.memories = [];
  }

  async load() {
    try {
      const raw = await fs.readFile(memoryFile(), "utf8");
      this.memories = JSON.parse(raw);
    } catch {
      this.memories = [];
    }
  }

  async save() {
    await fs.mkdir(config.CACHE_DIR, { recursive: true });
    await fs.writeFile(memoryFile(), JSON.stringify(this.memories, null, 2), "utf8");
  }

  /**
   * @param {{ project?: string, type?: string, title: string, content: string, tags?: string[], related?: string[], source?: string }} opts
   */
  async remember({ project, type, title, content, tags, related, source }) {
    const mem = {
      id: generateId(),
      timestamp: new Date().toISOString(),
      project: project ?? null,
      type: type ?? "insight",
      title, content,
      tags: tags ?? [],
      related: related ?? [],
      source: source ?? "manual",
      status: "active",
    };
    this.memories.push(mem);
    await this.save();
    return mem;
  }

  /**
   * @param {{ project?: string, query?: string, type?: string, limit?: number, includeArchived?: boolean }} opts
   */
  async recall({ project, query, type, limit = 10, includeArchived = false } = {}) {
    let results = this.memories;
    if (!includeArchived) results = results.filter((m) => m.status !== "archived" && m.status !== "superseded");
    if (project) results = results.filter((m) => m.project === project);
    if (type) results = results.filter((m) => m.type === type);
    if (query) {
      const q = query.toLowerCase();
      results = results.filter(
        (m) => m.title?.toLowerCase().includes(q) || m.content?.toLowerCase().includes(q)
      );
    }
    results.sort((a, b) => (b.timestamp > a.timestamp ? 1 : -1));
    return results.slice(0, limit);
  }

  /** @param {string} id */
  async archive(id) {
    const mem = this.memories.find((m) => m.id === id);
    if (!mem) return null;
    mem.status = "archived";
    await this.save();
    return mem;
  }

  /**
   * @param {string} id
   * @param {object} newMemoryData
   */
  async supersede(id, newMemoryData) {
    const old = this.memories.find((m) => m.id === id);
    if (!old) return null;
    old.status = "superseded";
    const created = await this.remember({
      ...newMemoryData,
      related: [...(newMemoryData.related ?? []), ...(old.related ?? [])],
    });
    created.supersedes = id;
    await this.save();
    return created;
  }

  async stats() {
    let active = 0;
    let archived = 0;
    const byProject = {};
    const byType = {};
    for (const m of this.memories) {
      if (m.status === "active") active++;
      else if (m.status === "archived" || m.status === "superseded") archived++;
      const proj = m.project ?? "(none)";
      byProject[proj] = (byProject[proj] ?? 0) + 1;
      byType[m.type] = (byType[m.type] ?? 0) + 1;
    }
    return { total: this.memories.length, active, archived, byProject, byType };
  }
}
