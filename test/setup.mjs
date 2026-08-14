// test/setup.mjs — runs before every test file (vitest setupFiles).
// Points the vault root + cache dir at an isolated temp directory so the
// lazy getters in src/config.mjs resolve deterministically, off the real FS.
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const TEST_ROOT = path.join(os.tmpdir(), "mdv-mcp-test-vault");
fs.mkdirSync(TEST_ROOT, { recursive: true });

process.env.VAULT_ROOT = TEST_ROOT;
process.env.MDV_CACHE_DIR = path.join(TEST_ROOT, ".mdv-cache");
// Ensure no accidental live embedding calls.
delete process.env.NVIDIA_API_KEY;

export const TEST_VAULT_ROOT = TEST_ROOT.replace(/\\/g, "/");
