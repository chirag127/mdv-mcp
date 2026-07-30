# MCP Tools

All 16 tools exposed by mdv-mcp. All paths are vault-relative (e.g. `okf/index.md`).

---

## vault_search

Semantic + keyword hybrid search across all markdown files.

Uses NVIDIA nemotron-3-embed-1b embeddings when `NVIDIA_API_KEY` is set; falls back to TF-IDF otherwise. Results merged via reciprocal-rank fusion.

**Params**
| Name | Type | Default | Description |
|---|---|---|---|
| `query` | string | required | Natural-language or keyword query |
| `limit` | int (1–50) | 10 | Max results |

**Returns** `{ query, count, results: [{ rel, score, snippet, via }] }`

---

## vault_read

Read one markdown file. Returns parsed frontmatter + body + format detection + wikilinks.

**Params**
| Name | Type | Description |
|---|---|---|
| `path` | string | Vault-relative path |

**Returns** `{ path, frontmatter, body, format, wikilinks }`

---

## vault_write

Create or overwrite a markdown file. Re-indexes it automatically.

**Params**
| Name | Type | Default | Description |
|---|---|---|---|
| `path` | string | required | Vault-relative path |
| `content` | string | required | Full file content including frontmatter |
| `overwrite` | bool | true | Whether to overwrite existing files |

**Returns** `{ written, bytes }`

---

## vault_delete

Delete a markdown file and remove its index entry.

**Params**
| Name | Type | Description |
|---|---|---|
| `path` | string | Vault-relative path |

**Returns** `{ deleted }`

---

## vault_list

List markdown files, optionally under a subdirectory.

**Params**
| Name | Type | Default | Description |
|---|---|---|---|
| `subdir` | string | `""` | Subdirectory filter |

**Returns** `{ subdir, count, files: string[] }`

---

## vault_tags

Aggregate all `#tags` and frontmatter `tags:` across the vault by frequency.

**Params** none

**Returns** `{ count, tags: [{ tag, count }] }`

---

## vault_backlinks

Find all files that link to a given file via `[[wikilink]]` or `[](path)`.

**Params**
| Name | Type | Description |
|---|---|---|
| `path` | string | Vault-relative path of target file |

**Returns** `{ target, count, backlinks: string[] }`

---

## vault_frontmatter

Read just the parsed YAML frontmatter of a file (no body loaded).

**Params**
| Name | Type | Description |
|---|---|---|
| `path` | string | Vault-relative path |

**Returns** `{ path, frontmatter }`

---

## vault_stats

Report index status and vault configuration.

**Params** none

**Returns** `{ vault, embeddingsEnabled, model, files, chunks, dims, docsLoaded }`

---

## vault_reindex

Force a full incremental re-embed sync of the vault (embeds new/changed files, drops deleted).

**Params** none

**Returns** `{ changed, files, chunks, dims }` or `{ skipped: "no-api-key" }`

---

## vault_remember

Save a session conclusion, decision, insight, bug, or todo to persistent memory. Survives across sessions.

**Params**
| Name | Type | Default | Description |
|---|---|---|---|
| `title` | string | required | Short summary |
| `content` | string | required | Full text |
| `project` | string | — | Project subdirectory name |
| `type` | enum | `insight` | `session`, `decision`, `insight`, `bug`, `todo` |
| `tags` | string[] | `[]` | |
| `related` | string[] | `[]` | Vault-relative paths of related notes |
| `source` | enum | `opencode` | `opencode`, `claude-code`, `manual` |

**Returns** `{ saved: true, memory: { id, timestamp, ... } }`

---

## vault_recall

Retrieve past session memories.

**Params**
| Name | Type | Default | Description |
|---|---|---|---|
| `query` | string | — | Filter by keyword |
| `project` | string | — | Filter by project |
| `type` | enum | — | Filter by type |
| `limit` | int | 10 | Max results |
| `includeArchived` | bool | false | Include archived/superseded |

**Returns** `{ query, project, count, memories: [...] }`

---

## vault_memory_stats

Report memory store statistics.

**Params** none

**Returns** `{ total, active, archived, byProject, byType }`

---

## vault_memory_archive

Archive a memory by ID (mark as no longer active).

**Params**
| Name | Type | Description |
|---|---|---|
| `id` | string | Memory ID to archive |

**Returns** `{ archived: true, memory }` or `{ error, id }`

---

## vault_format

Detect the format of a vault file, validate OKF v0.2 compliance, and optionally apply enrichment.

**Params**
| Name | Type | Default | Description |
|---|---|---|---|
| `path` | string | required | Vault-relative path |
| `apply` | bool | false | Write enriched frontmatter back to file |

**Returns** `{ path, format, currentFrontmatter, suggestedFrontmatter, suggestions, applied }`

---

## vault_wikilinks

Extract and resolve `[[wikilinks]]` from a vault file.

**Params**
| Name | Type | Description |
|---|---|---|
| `path` | string | Vault-relative path |

**Returns** `{ path, count, wikilinks: [{ target, alias, section, resolvedPath }] }`

---

## vault_install_opencode

Install mdv-mcp config into a project directory for OpenCode/Claude Code discovery.
Creates/updates `opencode.json`, `AGENTS.md`, and installs a skill file.

**Params**
| Name | Type | Default | Description |
|---|---|---|---|
| `targetDir` | string | required | Project directory |
| `transport` | enum | `stdio` | `stdio` or `http` |

**Returns** `{ targetDir, actions: string[] }`
