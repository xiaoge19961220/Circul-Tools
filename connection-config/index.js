const fs = require("fs");
const { join } = require("node:path");
const { app } = require("electron");

const CONFIG_FILENAME = 'server-db-config.json';

function missingConfigError() {
    return new Error('server-db-config.json 未导入（位于 userData）。请先在设置中导入服务器/数据库配置。');
}

function resolveImportedPath(filename) {
    try {
        const p = join(app.getPath('userData'), 'credentials', filename);
        if (fs.existsSync(p)) return p;
    } catch {
        // app may not be ready yet; fall back
    }
    return join(__dirname, '..', filename);
}

function readImportedUtf8(filename) {
    const p = resolveImportedPath(filename);
    try {
        return fs.readFileSync(p, 'utf-8');
    } catch {
        // 在未导入证书/密钥时不要在 require 阶段直接崩溃
        return '';
    }
}

function serverDbConfigPath() {
    return join(app.getPath('userData'), CONFIG_FILENAME);
}

function loadServerDbConfig() {
    try {
        if (!fs.existsSync(serverDbConfigPath())) return null;
        const raw = fs.readFileSync(serverDbConfigPath(), 'utf-8');
        const json = JSON.parse(raw);
        return json;
    } catch {
        return null;
    }
}

function normalizeRegion(region) {
    return region === 'jp1' ? 'jp1' : 'default';
}

function buildSshOption(region) {
    const cfg = loadServerDbConfig();
    if (!cfg) throw missingConfigError();
    const r = normalizeRegion(region);

    const sshHost = cfg?.ssh?.regions?.[r]?.host;
    if (!sshHost) throw missingConfigError();
    return {
        host: sshHost,
        port: cfg?.ssh?.port,
        username: cfg?.ssh?.username,
        privateKey: readImportedUtf8('id_ed25519'),
    };
}

function buildForwardOption(region) {
    const cfg = loadServerDbConfig();
    if (!cfg) throw missingConfigError();
    const r = normalizeRegion(region);

    const dstAddr = cfg?.forward?.regions?.[r]?.dstAddr;
    if (!dstAddr) throw missingConfigError();
    return {
        srcAddr: cfg?.forward?.srcAddr,
        srcPort: cfg?.forward?.srcPort,
        dstAddr,
        dstPort: cfg?.forward?.dstPort,
    };
}

function getSshOption(region) {
    const sshOptions = buildSshOption(region);
    const forwardOptions = buildForwardOption(region);
    return { sshOptions, forwardOptions };
}

function getConnectOptions() {
    const cfg = loadServerDbConfig();
    if (!cfg) throw missingConfigError();

    return {
        username: cfg?.mongo?.username,
        password: cfg?.mongo?.password,
        url: cfg?.mongo?.url,
        // DB/index.js 用的是 MongoClient URI 中的 `:${this.port}`，所以这里不需要关心 connectOptions.port
        database: cfg?.mongo?.database,
        pem: {
            tls: true,
            tlsCAFile: resolveImportedPath('global-bundle.pem'),
            tlsAllowInvalidHostnames: true,
        },
        options: cfg?.mongo?.options,
    };
}

module.exports = { getSshOption, getConnectOptions };