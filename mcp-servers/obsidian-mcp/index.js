'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.OBSIDIAN_PORT || 3002;
// Default to the built-in vault inside the project if no external vault is configured
const DEFAULT_VAULT = path.join(__dirname, '../../vault');
const VAULT_PATH = process.env.OBSIDIAN_VAULT_PATH || DEFAULT_VAULT;
const WC_FOLDER = process.env.OBSIDIAN_WC_FOLDER || 'WC2026';

/**
 * Resolve and validate a vault-relative path, preventing traversal outside vault.
 * @param {string} filename - Relative path inside vault
 * @returns {string} Absolute safe path
 */
function safeVaultPath(filename) {
  const resolved = path.resolve(VAULT_PATH, filename);
  if (!resolved.startsWith(path.resolve(VAULT_PATH))) {
    throw new Error('Path traversal attempt blocked');
  }
  return resolved;
}

/**
 * Ensure the WC2026 subfolder exists inside the vault.
 */
function ensureWcFolder() {
  const wcDir = path.join(VAULT_PATH, WC_FOLDER);
  if (!fs.existsSync(wcDir)) {
    fs.mkdirSync(wcDir, { recursive: true });
    console.log(`[OBSIDIAN] Created WC folder: ${wcDir}`);
  }
}

/**
 * Recursively list all .md files under a directory.
 * @param {string} dir - Absolute directory path
 * @param {string} base - Base path for relative filenames
 * @returns {string[]} Array of relative file paths
 */
function listMdFiles(dir, base) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(base, full);
    if (entry.isDirectory()) {
      results.push(...listMdFiles(full, base));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      results.push(rel.replace(/\\/g, '/'));
    }
  }
  return results;
}

/**
 * GET /list?folder=optional
 * List all .md files in vault (or subfolder).
 */
app.get('/list', (req, res) => {
  try {
    ensureWcFolder();
    const subfolder = req.query.folder;
    const searchDir = subfolder
      ? safeVaultPath(subfolder)
      : VAULT_PATH;
    const files = listMdFiles(searchDir, VAULT_PATH);
    const withStats = files.map((f) => {
      try {
        const absPath = path.join(VAULT_PATH, f);
        const stat = fs.statSync(absPath);
        return { filename: f, modified: stat.mtime.toISOString() };
      } catch {
        return { filename: f, modified: null };
      }
    });
    console.log(`[OBSIDIAN] Listed ${files.length} notes`);
    res.json({ files: withStats });
  } catch (err) {
    console.error('[OBSIDIAN] list error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /read/:filename(*) — URL-encoded path
 * Read full content of a note.
 */
app.get('/read/:filename(*)', (req, res) => {
  try {
    const filename = req.params.filename;
    const absPath = safeVaultPath(filename);
    if (!fs.existsSync(absPath)) {
      return res.status(404).json({ error: 'Note not found', filename });
    }
    const content = fs.readFileSync(absPath, 'utf8');
    const stat = fs.statSync(absPath);
    console.log(`[OBSIDIAN] Read note: ${filename}`);
    res.json({ filename, content, modified: stat.mtime.toISOString() });
  } catch (err) {
    console.error('[OBSIDIAN] read error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /write
 * Create or overwrite a note atomically.
 * Body: { filename, content }
 */
app.post('/write', (req, res) => {
  try {
    const { filename, content } = req.body;
    if (!filename || content === undefined) {
      return res.status(400).json({ error: 'filename and content required' });
    }
    const absPath = safeVaultPath(filename);
    const dir = path.dirname(absPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmpPath = absPath + '.tmp';
    fs.writeFileSync(tmpPath, content, 'utf8');
    fs.renameSync(tmpPath, absPath);
    console.log(`[OBSIDIAN] Wrote note: ${filename}`);
    res.json({ success: true, filename });
  } catch (err) {
    console.error('[OBSIDIAN] write error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /search?q=query
 * Search all notes for a keyword (case-insensitive).
 */
app.get('/search', (req, res) => {
  try {
    const query = (req.query.q || '').toLowerCase();
    if (!query) return res.json({ results: [] });
    const wcDir = path.join(VAULT_PATH, WC_FOLDER);
    const files = listMdFiles(wcDir, VAULT_PATH);
    const results = [];
    for (const f of files) {
      try {
        const absPath = path.join(VAULT_PATH, f);
        const content = fs.readFileSync(absPath, 'utf8');
        if (content.toLowerCase().includes(query)) {
          results.push({ filename: f, content, snippet: extractSnippet(content, query) });
        }
      } catch {
        // skip unreadable files
      }
    }
    console.log(`[OBSIDIAN] Search "${query}" → ${results.length} results`);
    res.json({ results });
  } catch (err) {
    console.error('[OBSIDIAN] search error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /append
 * Append text to an existing note (creates it if missing).
 * Body: { filename, content }
 */
app.post('/append', (req, res) => {
  try {
    const { filename, content } = req.body;
    if (!filename || content === undefined) {
      return res.status(400).json({ error: 'filename and content required' });
    }
    const absPath = safeVaultPath(filename);
    const dir = path.dirname(absPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const existing = fs.existsSync(absPath) ? fs.readFileSync(absPath, 'utf8') : '';
    const updated = existing + '\n' + content;
    const tmpPath = absPath + '.tmp';
    fs.writeFileSync(tmpPath, updated, 'utf8');
    fs.renameSync(tmpPath, absPath);
    console.log(`[OBSIDIAN] Appended to note: ${filename}`);
    res.json({ success: true, filename });
  } catch (err) {
    console.error('[OBSIDIAN] append error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /health
 */
app.get('/health', (req, res) => {
  const vaultExists = fs.existsSync(VAULT_PATH);
  const isBuiltIn = VAULT_PATH === DEFAULT_VAULT;
  res.json({
    status: 'ok',
    vault: VAULT_PATH,
    vaultExists,
    isBuiltIn,
    wcFolder: WC_FOLDER,
    noteCount: vaultExists ? listMdFiles(VAULT_PATH, VAULT_PATH).length : 0,
  });
});

/**
 * Extract a short snippet around the match position.
 * @param {string} content
 * @param {string} query
 * @returns {string}
 */
function extractSnippet(content, query) {
  const idx = content.toLowerCase().indexOf(query);
  if (idx === -1) return '';
  const start = Math.max(0, idx - 80);
  const end = Math.min(content.length, idx + 200);
  return content.slice(start, end).replace(/\n/g, ' ').trim();
}

app.listen(PORT, () => {
  const isBuiltIn = VAULT_PATH === DEFAULT_VAULT;
  console.log(`[OBSIDIAN] MCP server running on port ${PORT}`);
  console.log(`[OBSIDIAN] Vault: ${VAULT_PATH} ${isBuiltIn ? '(built-in)' : '(external)'}`);
  ensureWcFolder();
});
