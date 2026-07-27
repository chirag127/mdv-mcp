import fs from "node:fs/promises";
import fssync from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { config } from "./config.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..").replace(/\\/g, "/");
const INDEX_ENTRY = `${PROJECT_ROOT}/src/index.mjs`;

function slash(p) {
  return p.replace(/\\/g, "/");
}

export function generateOpenCodeConfig(projectDir, options = {}) {
  const {
    transport = "stdio",
    httpPort = 3777,
    vaultRoot = config.VAULT_ROOT,
  } = options;

  if (transport === "http") {
    return {
      mcpServers: {
        "mdv-mcp": {
          url: `http://localhost:${httpPort}/mcp`,
        },
      },
    };
  }

  return {
    mcpServers: {
      "mdv-mcp": {
        command: "node",
        args: [INDEX_ENTRY],
        env: {
          VAULT_ROOT: vaultRoot,
          NVIDIA_API_KEY: "${NVIDIA_API_KEY}",
        },
      },
    },
  };
}

export function generateAgentsMd(projectDir, options = {}) {
  const dir = slash(projectDir || ".");
  return `# mdv-mcp — Vault Memory

Private local knowledge base backed by an Obsidian/markdown vault.
Semantic search via NVIDIA nemotron-3-embed-1b + TF-IDF hybrid.

## Available Tools

| Tool | Description |
|---|---|
| vault_search | Semantic + keyword hybrid search across all markdown files |
| vault_read | Read a specific note by vault-relative path |
| vault_write | Create or overwrite a markdown file in the vault |
| vault_delete | Delete a markdown file and its index entry |
| vault_list | List markdown files, optionally under a subdirectory |
| vault_tags | Aggregate all #tags and frontmatter tags by frequency |
| vault_backlinks | Find all files that link to a given file |
| vault_frontmatter | Read just the parsed YAML frontmatter (no body) |
| vault_stats | Report index status: file/chunk counts, dims, embedding status |
| vault_reindex | Force a full incremental re-embed sync of the vault |
| vault_remember | Save session conclusions, decisions, insights to persistent memory |
| vault_recall | Retrieve past session memories \u2014 load context at session start |
| vault_memory_stats | Report memory store statistics |
| vault_memory_archive | Archive a memory by ID |
| vault_format | Detect file format and suggest OKF frontmatter improvements |
| vault_wikilinks | Extract and resolve [[wikilinks]] from a vault file |
| vault_install_opencode | Install mdv-mcp config into a project for OpenCode |

## Session Workflow

1. At session start, call \`vault_recall\` with the current project name to load past context
2. During work, use \`vault_search\` to find relevant knowledge and \`vault_read\` to fetch full notes
3. When you learn something important, call \`vault_remember\` to persist the insight
4. At session end, call \`vault_remember\` with type "session" to save conclusions
5. Use \`vault_format\` to check if notes follow OKF conventions
6. Use \`vault_tags\` to discover the knowledge taxonomy
7. Use \`vault_backlinks\` to find related notes linking to a topic

## Notes

- All paths are vault-relative (e.g. \`okf/runbooks/deploy.md\`)
- The vault root is \`${config.VAULT_ROOT}\`
- Project dir: \`${dir}\`
`;
}

export function generateSkillFile() {
  return `---
name: mdv-mcp
description: Local vault memory — persistent knowledge base for all projects
---

# mdv-mcp Vault Memory Skill

Query and manage a local Obsidian/markdown vault via MCP tools.
Uses NVIDIA nemotron-3-embed-1b semantic search with TF-IDF fallback.

## When to Use

Use whenever you need to:
- Search for past decisions, runbooks, or context across projects
- Read or write knowledge base notes
- Discover related notes via tags or backlinks
- Persist session conclusions for future sessions

## Key Tools

- \`vault_search\`: Primary entry point — semantic + keyword hybrid search
- \`vault_read\`: Fetch full note content by path
- \`vault_write\`: Save new notes or update existing ones
- \`vault_remember\`: Persist session conclusions, decisions, insights
- \`vault_recall\`: Retrieve past session memories for context
- \`vault_list\`: Browse vault structure
- \`vault_tags\`: Discover knowledge taxonomy
- \`vault_backlinks\`: Find notes linking to a given file
- \`vault_format\`: Check OKF format compliance and get suggestions
- \`vault_wikilinks\`: Extract and resolve wikilinks

## Workflow

1. Search the vault for relevant context before starting work
2. Read specific notes to get detailed knowledge
3. After completing a task, write a summary note to the vault
4. Use tags and backlinks for discovery and navigation

## Conventions

- Paths are vault-relative: \`okf/runbooks/deploy.md\`
- Notes use YAML frontmatter + markdown body
- Tags appear as \`#tag\` in body or \`tags:\` in frontmatter
- Wikilinks \`[[note]]\` and markdown links \`[](path)\` are both supported
`;
}

export async function install(targetDir, options = {}) {
  const dir = slash(path.resolve(targetDir));
  const summary = [];

  const configObj = generateOpenCodeConfig(dir, options);
  const configPath = path.join(dir, "opencode.json");

  if (fssync.existsSync(configPath)) {
    const existing = JSON.parse(await fs.readFile(configPath, "utf8"));
    existing.mcpServers = {
      ...(existing.mcpServers ?? {}),
      ...configObj.mcpServers,
    };
    await fs.writeFile(configPath, JSON.stringify(existing, null, 2) + "\n");
    summary.push(`merged mdv-mcp into ${slash(configPath)}`);
  } else {
    await fs.writeFile(
      configPath,
      JSON.stringify(configObj, null, 2) + "\n",
    );
    summary.push(`created ${slash(configPath)}`);
  }

  const agentsMd = generateAgentsMd(dir, options);
  const agentsPath = path.join(dir, "AGENTS.md");

  if (fssync.existsSync(agentsPath)) {
    const existing = await fs.readFile(agentsPath, "utf8");
    if (!existing.includes("mdv-mcp")) {
      await fs.writeFile(agentsPath, existing.trimEnd() + "\n\n" + agentsMd);
      summary.push(`appended mdv-mcp section to ${slash(agentsPath)}`);
    } else {
      summary.push(`${slash(agentsPath)} already contains mdv-mcp section`);
    }
  } else {
    await fs.writeFile(agentsPath, agentsMd);
    summary.push(`created ${slash(agentsPath)}`);
  }

  const homeDir = slash(os.homedir());
  const skillDir = path.join(homeDir, ".opencode", "skills", "mdv-mcp");
  await fs.mkdir(skillDir, { recursive: true });

  const skillPath = path.join(skillDir, "SKILL.md");
  await fs.writeFile(skillPath, generateSkillFile());
  summary.push(`created ${slash(skillPath)}`);

  return { targetDir: dir, actions: summary };
}
