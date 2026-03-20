const { app, dialog } = require('electron');
const path = require('path');
const fs = require('fs-extra');
const zlib = require('zlib');
const { pipeline } = require('stream/promises');

const MAX_ENTRIES_UI = 1200;
const MAX_ACTIVE_LOG_BYTES = 10 * 1024 * 1024; // 10MB
const MAX_ARCHIVES = 50;

function uiStorePath() {
  return path.join(app.getPath('userData'), 'query-logs.json');
}

function settingsPath() {
  return path.join(app.getPath('userData'), 'querylog-settings.json');
}

function defaultLogDir() {
  return path.join(app.getPath('userData'), 'querylogs');
}

async function getSettings() {
  try {
    const s = await fs.readJson(settingsPath());
    return {
      version: 1,
      logDir: s?.logDir || defaultLogDir(),
    };
  } catch {
    return { version: 1, logDir: defaultLogDir() };
  }
}

async function setLogDir(logDir) {
  const next = { version: 1, logDir };
  await fs.ensureDir(path.dirname(settingsPath()));
  await fs.writeJson(settingsPath(), next, { spaces: 2 });
  await fs.ensureDir(logDir);
  return next;
}

async function ensureLogDir() {
  const { logDir } = await getSettings();
  await fs.ensureDir(logDir);
  return logDir;
}

async function activeLogPath() {
  const dir = await ensureLogDir();
  return path.join(dir, 'active.log');
}

function tsFileSafe(iso) {
  return String(iso).replace(/[:.]/g, '-');
}

async function gzipRotateIfNeeded(extraBytes = 0) {
  const p = await activeLogPath();
  let size = 0;
  try {
    size = (await fs.stat(p)).size;
  } catch {
    size = 0;
  }
  if (size + extraBytes <= MAX_ACTIVE_LOG_BYTES) return { rotated: false };

  const dir = path.dirname(p);
  const stamp = tsFileSafe(new Date().toISOString());
  const archivePath = path.join(dir, `archive-${stamp}.log.gz`);

  // If active.log doesn't exist yet, nothing to rotate
  if (!(await fs.pathExists(p))) return { rotated: false };

  await pipeline(
    fs.createReadStream(p),
    zlib.createGzip({ level: 9 }),
    fs.createWriteStream(archivePath)
  );
  await fs.writeFile(p, '', 'utf-8');

  // prune old archives
  try {
    const names = (await fs.readdir(dir))
      .filter(n => n.startsWith('archive-') && n.endsWith('.log.gz'))
      .sort(); // timestamped => lexical sort ok
    const toRemove = names.length - MAX_ARCHIVES;
    if (toRemove > 0) {
      await Promise.allSettled(names.slice(0, toRemove).map(n => fs.remove(path.join(dir, n))));
    }
  } catch {
    // ignore
  }

  return { rotated: true, archivePath };
}

async function appendToActiveFile(line) {
  const buf = Buffer.from(line + '\n', 'utf-8');
  await gzipRotateIfNeeded(buf.length);
  const p = await activeLogPath();
  await fs.ensureFile(p);
  await fs.appendFile(p, buf);
}

async function readLogs() {
  try {
    const data = await fs.readJson(uiStorePath());
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.entries)) return data.entries;
    return [];
  } catch {
    return [];
  }
}

async function writeLogs(entries) {
  await fs.ensureDir(path.dirname(uiStorePath()));
  const trimmed = entries.slice(-MAX_ENTRIES_UI);
  await fs.writeJson(uiStorePath(), { version: 1, entries: trimmed }, { spaces: 2 });
  return trimmed;
}

function toLine(entry) {
  const ts = entry?.ts || new Date().toISOString();
  const level = String(entry?.level || 'info').toUpperCase();
  const msg = String(entry?.message ?? '');
  return `[${ts}] ${level} ${msg}`;
}

async function addLog(entry) {
  const e = {
    ts: entry?.ts || new Date().toISOString(),
    level: entry?.level || 'info',
    message: String(entry?.message ?? ''),
  };

  // UI store (small, for loading into renderer)
  const entries = await readLogs();
  entries.push(e);
  await writeLogs(entries);

  // file store (rolling gzip)
  await appendToActiveFile(toLine(e));
}

async function clearLogs() {
  await writeLogs([]);
  const p = await activeLogPath();
  await fs.ensureFile(p);
  await fs.writeFile(p, '', 'utf-8');
  return [];
}

async function listLogFiles() {
  const dir = await ensureLogDir();
  const names = await fs.readdir(dir);
  const files = [];
  for (const n of names) {
    if (n === 'active.log' || (n.startsWith('archive-') && n.endsWith('.log.gz'))) {
      try {
        const st = await fs.stat(path.join(dir, n));
        files.push({ name: n, bytes: st.size, mtimeMs: st.mtimeMs });
      } catch {
        // ignore
      }
    }
  }
  files.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return { dir, files };
}

async function exportFileWithDialog(parentWindow, filename) {
  const { dir, files } = await listLogFiles();
  const exists = files.find(f => f.name === filename);
  if (!exists) throw new Error('文件不存在');

  const from = path.join(dir, filename);
  const isGz = filename.endsWith('.gz');
  const picked = await dialog.showSaveDialog(parentWindow, {
    title: '导出文件',
    defaultPath: filename,
    filters: isGz
      ? [{ name: 'GZip', extensions: ['gz'] }]
      : [{ name: 'Log', extensions: ['log', 'txt'] }],
  });
  if (picked.canceled || !picked.filePath) return { canceled: true };
  await fs.copy(from, picked.filePath, { overwrite: true });
  return { canceled: false, filePath: picked.filePath };
}

module.exports = {
  getSettings,
  setLogDir,
  readLogs,
  addLog,
  clearLogs,
  listLogFiles,
  exportFileWithDialog,
};

