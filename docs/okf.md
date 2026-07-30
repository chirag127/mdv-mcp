# OKF Frontmatter Support

mdv-mcp reads, validates, and enriches [OKF (Open Knowledge Format) v0.2](https://github.com/chirag127/workspace/blob/main/knowledge/_okf.md) frontmatter.

## OKF v0.2 schema

```yaml
---
type: note          # required — see valid types below
title: "..."        # required
description: "..."  # required
tags: [tag1, tag2]  # required — array
timestamp: "..."    # required — ISO date or human date
format_version: v0.2  # optional
status: active      # optional
related: []         # optional — array of vault-relative paths
---
```

### Valid types

| Type | When to use |
|---|---|
| `note` | General-purpose knowledge note |
| `decision` | Architectural or project decisions |
| `rule` | Rules, constraints, conventions |
| `runbook` | Step-by-step operational procedures |
| `service` | Service/API/integration documentation |
| `concept` | Conceptual explanations |
| `log` | Session logs, changelogs |

## How mdv-mcp uses OKF

### Detection (`vault_read`, `vault_format`)

Every doc read is classified into one of:
- `okf` — has `type:` field; validated against required fields
- `obsidian` — has `aliases:` / `cssclass:` / `cssclasses:` fields
- `plain` — has frontmatter but no type/obsidian markers
- `claude-md` / `agents-md` — system context files (CLAUDE.md, AGENTS.md, etc.)

### Validation

`vault_format` returns:
- `missingFields` — required OKF fields absent from the file
- `invalidFields` — fields present but with invalid values (e.g. unknown `type`)
- `suggestions` — inferred values for missing fields

### Enrichment (`vault_format` with `apply: true`)

When `apply: true`, mdv-mcp writes the enriched frontmatter back to the file.
Only adds missing fields — never overwrites existing values.

Inference heuristics:
| Field | How inferred |
|---|---|
| `type` | Pattern matching on body text (e.g. "decided" → `decision`, "must/never" → `rule`) |
| `title` | First `# H1` heading, or filename with `-_` replaced by spaces |
| `description` | First non-heading paragraph (max 200 chars) |
| `tags` | Heading words + bold phrases from body |
| `timestamp` | Existing `created:` or `date:` frontmatter field |
| `format_version` | Always `v0.2` |

### Indexing

The `title` frontmatter field is prepended to the body before chunking so that
title-based queries match correctly even when the title isn't in the body text.

## Example workflow

```
# Check a file
vault_format { path: "knowledge/decisions/arch.md" }
→ { missingFields: ["timestamp", "format_version"], suggestions: [...] }

# Apply enrichment in-place
vault_format { path: "knowledge/decisions/arch.md", apply: true }
→ { applied: true, suggestedFrontmatter: { type: "decision", ... } }
```
