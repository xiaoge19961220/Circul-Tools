const { app } = require('electron');
const path = require('path');
const fs = require('fs-extra');
const crypto = require('crypto');

const PEM_FILENAME = 'global-bundle.pem';
const KEY_FILENAME = 'id_ed25519';
const STATE_FILENAME = 'credentials-state.json';

function credentialsDir() {
  return path.join(app.getPath('userData'), 'credentials');
}

function pemDestPath() {
  return path.join(credentialsDir(), PEM_FILENAME);
}

function keyDestPath() {
  return path.join(credentialsDir(), KEY_FILENAME);
}

function statePath() {
  return path.join(credentialsDir(), STATE_FILENAME);
}

async function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  await new Promise((resolve, reject) => {
    const s = fs.createReadStream(filePath);
    s.on('data', (d) => hash.update(d));
    s.on('error', reject);
    s.on('end', resolve);
  });
  return hash.digest('hex');
}

async function readState() {
  try {
    return await fs.readJson(statePath());
  } catch {
    return null;
  }
}

async function writeState(next) {
  await fs.ensureDir(credentialsDir());
  await fs.writeJson(statePath(), next, { spaces: 2 });
}

async function validateCredentials() {
  const [pemExists, keyExists] = await Promise.all([fs.pathExists(pemDestPath()), fs.pathExists(keyDestPath())]);
  const missing = [];
  if (!pemExists) missing.push('pem证书');
  if (!keyExists) missing.push('私钥证书');

  const state = await readState();
  if (missing.length) {
    return {
      imported: false,
      valid: false,
      missing,
      paths: { pem: pemDestPath(), key: keyDestPath() },
      state,
    };
  }

  const [pemHash, keyHash] = await Promise.all([sha256File(pemDestPath()), sha256File(keyDestPath())]);
  const hashMatches =
    !!state &&
    state.version === 1 &&
    state.pemSha256 === pemHash &&
    state.keySha256 === keyHash;

  const now = new Date().toISOString();
  if (!state || !hashMatches) {
    await writeState({
      version: 1,
      importedAt: state?.importedAt ?? now,
      lastValidatedAt: now,
      pemSha256: pemHash,
      keySha256: keyHash,
    });
  } else {
    await writeState({ ...state, lastValidatedAt: now });
  }

  return {
    imported: true,
    valid: true,
    missing: [],
    paths: { pem: pemDestPath(), key: keyDestPath() },
    state: await readState(),
  };
}

async function importCredentialsFromFiles({ pemSourcePath, keySourcePath }) {
  await fs.ensureDir(credentialsDir());

  const pemTarget = pemDestPath();
  const keyTarget = keyDestPath();

  await fs.copy(pemSourcePath, pemTarget, { overwrite: true, errorOnExist: false });
  await fs.copy(keySourcePath, keyTarget, { overwrite: true, errorOnExist: false });

  try {
    await fs.chmod(keyTarget, 0o600);
  } catch {
    // best-effort (Windows / sandbox)
  }

  const [pemHash, keyHash] = await Promise.all([sha256File(pemTarget), sha256File(keyTarget)]);
  const nextState = {
    version: 1,
    importedAt: new Date().toISOString(),
    lastValidatedAt: new Date().toISOString(),
    pemSha256: pemHash,
    keySha256: keyHash,
  };
  await writeState(nextState);
  return {
    imported: true,
    valid: true,
    missing: [],
    paths: { pem: pemTarget, key: keyTarget },
    state: nextState,
  };
}

async function clearCredentials() {
  // delete only known files, then best-effort remove folder if empty
  await Promise.allSettled([
    fs.remove(pemDestPath()),
    fs.remove(keyDestPath()),
    fs.remove(statePath()),
  ]);
  try {
    const items = await fs.readdir(credentialsDir());
    if (!items.length) await fs.remove(credentialsDir());
  } catch {
    // ignore
  }
  return await validateCredentials();
}

module.exports = {
  PEM_FILENAME,
  KEY_FILENAME,
  credentialsDir,
  pemDestPath,
  keyDestPath,
  validateCredentials,
  importCredentialsFromFiles,
  clearCredentials,
};

