const { app, dialog } = require('electron');
const path = require('path');
const fs = require('fs-extra');

const CONFIG_FILENAME = 'server-db-config.json';

function configPath() {
  return path.join(app.getPath('userData'), CONFIG_FILENAME);
}

async function validateServerDbConfig() {
  try {
    const raw = await fs.readFile(configPath(), 'utf-8');
    const json = JSON.parse(raw);
    // minimal schema checks
    if (!json?.ssh || !json?.forward || !json?.mongo) return { ok: false, reason: 'schema' };
    if (!json?.mongo?.username || !json?.mongo?.database) return { ok: false, reason: 'mongo' };
    if (!json?.mongo?.password) return { ok: false, reason: 'mongo_password' };
    return { ok: true, config: json };
  } catch (e) {
    return { ok: false, reason: 'missing_or_invalid' };
  }
}

async function importServerDbConfigFromFile(sourcePath) {
  await fs.ensureDir(path.dirname(configPath()));
  await fs.copy(sourcePath, configPath(), { overwrite: true });
  return await validateServerDbConfig();
}

async function clearServerDbConfig() {
  try {
    await fs.remove(configPath());
  } catch {
    // ignore
  }
  return await validateServerDbConfig();
}

async function promptImportServerDbConfigLoop(parentWindow) {
  while (true) {
    const status = await validateServerDbConfig();
    if (status.ok) return status.config;

    const choice = await dialog.showMessageBox(parentWindow, {
      type: 'warning',
      title: '需要导入服务器/数据库配置',
      message: '未检测到服务器/数据库配置文件 server-db-config.json，无法继续。',
      detail: '请导入 JSON 配置文件（包含 SSH、转发、MongoDB 参数）。',
      buttons: ['导入', '退出'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });

    if (choice.response === 1) {
      app.quit();
      return null;
    }

    const picked = await dialog.showOpenDialog(parentWindow, {
      title: '选择 server-db-config.json',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (picked.canceled || !picked.filePaths?.[0]) continue;

    await importServerDbConfigFromFile(picked.filePaths[0]);
  }
}

module.exports = {
  CONFIG_FILENAME,
  configPath,
  validateServerDbConfig,
  importServerDbConfigFromFile,
  clearServerDbConfig,
  promptImportServerDbConfigLoop,
};

