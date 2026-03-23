const { app, BrowserWindow, ipcMain, Menu, dialog, clipboard } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const Tunnel = require("../ssh-tunnel");
const MongoDB = require("../db");
const {
    promptImportServerDbConfigLoop,
    validateServerDbConfig,
    importServerDbConfigFromFile,
    clearServerDbConfig,
} = require("./serverDbConfig");
const {
    validateCredentials,
    importCredentialsFromFiles,
    clearCredentials,
} = require("./credentials");
const {
    getSettings: getLogSettings,
    setLogDir,
    readLogs,
    addLog,
    clearLogs,
    listLogFiles,
    exportFileWithDialog,
} = require("./queryLogStore");
const { log } = require('console');

let win;
// login removed

function setupAutoUpdater() {
    // Keep it simple: log to console and auto-install on download.
    autoUpdater.logger = {
        info: console.log,
        warn: console.warn,
        error: console.error,
    };

    autoUpdater.on('error', (err) => console.error('autoUpdater error:', err));
    autoUpdater.on('checking-for-update', () => console.log('[updater] checking-for-update'));
    autoUpdater.on('update-available', (info) => console.log('[updater] update-available:', info?.version));
    autoUpdater.on('update-not-available', () => console.log('[updater] update-not-available'));
    autoUpdater.on('download-progress', (progress) => console.log('[updater] download-progress:', progress));
    autoUpdater.on('update-downloaded', () => {
        // Install after download with standard electron-updater flow.
        try {
            autoUpdater.quitAndInstall(false, true);
        } catch (e) {
            console.error('quitAndInstall failed:', e);
        }
    });
}

function createWindow() {
    win = new BrowserWindow({
        width: 900,
        height: 800,
        webPreferences: {
            preload: path.join(__dirname, '../preload.js'),
        },
    });

    win.loadFile(path.join(__dirname, '../renderer/index.html'));

    const template = [
        {
            label: '开发',
            submenu: [
                {
                    label: 'DevTools',
                    click: () => {
                        win.webContents.toggleDevTools()
                    }
                },
                { role: 'undo' },
                { role: 'redo' },
                { type: 'separator' },
                { role: 'cut' },
                { role: 'copy' },
                { role: 'paste' },
                { role: 'selectAll' }
            ]
        }
    ]

    const menu = Menu.buildFromTemplate(template)
    Menu.setApplicationMenu(menu)
}

async function promptImportCredentialsLoop(parentWindow) {
    while (true) {
        const status = await validateCredentials();
        if (status.valid) return status;

        const missing = (status.missing || []).join(', ') || 'pem文件 / 私钥证书';
        const choice = await dialog.showMessageBox(parentWindow, {
            type: 'warning',
            title: '需要导入证书/密钥',
            message: '未检测到必需的证书/密钥，无法继续使用。',
            detail: `缺少：${missing}\n\n请导入 pem文件 和 私钥证书。`,
            buttons: ['导入', '退出'],
            defaultId: 0,
            cancelId: 0,
            noLink: true,
        });

        if (choice.response === 1) {
            app.quit();
            return status;
        }

        const pemPick = await dialog.showOpenDialog(parentWindow, {
            title: '选择 pem文件',
            properties: ['openFile'],
            filters: [{ name: 'PEM', extensions: ['pem'] }],
        });
        if (pemPick.canceled || !pemPick.filePaths?.[0]) {
            continue;
        }

        const keyPick = await dialog.showOpenDialog(parentWindow, {
            title: '选择 证书',
            properties: ['openFile'],
        });
        if (keyPick.canceled || !keyPick.filePaths?.[0]) {
            continue;
        }

        try {
            await importCredentialsFromFiles({
                pemSourcePath: pemPick.filePaths[0],
                keySourcePath: keyPick.filePaths[0],
            });
        } catch (e) {
            await dialog.showMessageBox(parentWindow, {
                type: 'error',
                title: '导入失败',
                message: '证书/密钥导入失败',
                detail: e?.message || String(e),
            });
        }
    }
}

function buildSnFilter(snRaw) {
    const snStr = String(snRaw ?? '').trim().replace(/\s+/g, '');
    if (!snStr) return null;
    const inValues = [snStr];
    if (/^\d+$/.test(snStr)) {
        const n = Number(snStr);
        if (Number.isFinite(n)) inValues.push(n);
    }
    // de-dupe
    const uniq = Array.from(new Set(inValues.map(v => (typeof v === 'number' ? v : String(v)))));
    return { $in: uniq };
}

app.whenReady().then(() => {
    createWindow()
    win.webContents.once('did-finish-load', async () => {
        await promptImportServerDbConfigLoop(win);
        await promptImportCredentialsLoop(win);

        // Check for updates only for packaged builds.
        const shouldCheckUpdates =
            app.isPackaged || String(process.env.ELECTRON_UPDATER_DEBUG) === '1';

        if (shouldCheckUpdates) {
            if (!app.isPackaged) {
                // electron-updater默认不会在dev里检查，需要强制读取更新配置
                autoUpdater.forceDevUpdateConfig = true;
                console.log('[updater] dev check enabled (ELECTRON_UPDATER_DEBUG=1)');
            }
            setupAutoUpdater();
            try {
                const p = autoUpdater.checkForUpdatesAndNotify();
                // `electron-updater` Promise result varies by version; we only log it.
                if (p && typeof p.then === 'function') {
                    p.then((res) => console.log('[updater] checkForUpdatesAndNotify result:', res))
                        .catch((e) => {
                            console.error('[updater] checkForUpdatesAndNotify failed:', e);
                            dialog.showMessageBox(win, {
                                type: 'error',
                                title: '检查更新失败',
                                message: '自动更新检查失败',
                                detail: e?.message || String(e),
                                noLink: true,
                            });
                        });
                }
            } catch (e) {
                console.error('[updater] checkForUpdatesAndNotify threw:', e);
                dialog.showMessageBox(win, {
                    type: 'error',
                    title: '检查更新失败',
                    message: '自动更新检查失败',
                    detail: e?.message || String(e),
                    noLink: true,
                });
            }
        }
    });
})

ipcMain.handle('credentials:get-status', async () => {
    return await validateCredentials();
});

ipcMain.handle('credentials:import', async () => {
    if (!win) throw new Error('主窗口未就绪');

    const pemPick = await dialog.showOpenDialog(win, {
        title: '选择 pem文件',
        properties: ['openFile'],
        filters: [{ name: 'PEM', extensions: ['pem'] }],
    });
    if (pemPick.canceled || !pemPick.filePaths?.[0]) {
        return { canceled: true };
    }

    const keyPick = await dialog.showOpenDialog(win, {
        title: '选择 私钥证书',
        properties: ['openFile'],
    });
    if (keyPick.canceled || !keyPick.filePaths?.[0]) {
        return { canceled: true };
    }

    const result = await importCredentialsFromFiles({
        pemSourcePath: pemPick.filePaths[0],
        keySourcePath: keyPick.filePaths[0],
    });
    return { canceled: false, ...result };
});

ipcMain.handle('credentials:clear', async () => {
    if (!win) throw new Error('主窗口未就绪');
    const res = await dialog.showMessageBox(win, {
        type: 'warning',
        title: '清除证书/密钥',
        message: '确定要清除已导入的证书/密钥吗？',
        detail: '清除后需要重新导入，否则无法继续使用。',
        buttons: ['清除', '取消'],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
    });
    if (res.response !== 0) return { canceled: true, status: await validateCredentials() };
    await clearCredentials();
    // 清除后立即强制导入一次，避免用户清除后陷入不可用状态
    const status = await promptImportCredentialsLoop(win);
    return { canceled: false, status };
});

// server/db config: get status
ipcMain.handle('serverdb:get-status', async () => {
    return await validateServerDbConfig();
});

// server/db config: import once
ipcMain.handle('serverdb:import', async () => {
    if (!win) throw new Error('主窗口未就绪');
    const picked = await dialog.showOpenDialog(win, {
        title: '选择 server-db-config.json',
        properties: ['openFile'],
        filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (picked.canceled || !picked.filePaths?.[0]) return { canceled: true };
    const status = await importServerDbConfigFromFile(picked.filePaths[0]);
    return { canceled: false, status };
});

// server/db config: clear + re-import loop
ipcMain.handle('serverdb:clear', async () => {
    if (!win) throw new Error('主窗口未就绪');
    const res = await dialog.showMessageBox(win, {
        type: 'warning',
        title: '清除服务器/数据库配置',
        message: '确定要清除已导入的 server-db-config.json 吗？',
        detail: '清除后程序将无法继续使用，直到重新导入配置。',
        buttons: ['清除', '取消'],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
    });
    if (res.response !== 0) return { canceled: true };

    await clearServerDbConfig();
    // 清除后强制导入一次，避免不可用状态
    const status = await promptImportServerDbConfigLoop(win);
    return { canceled: false, status };
});

ipcMain.handle('querylog:list', async () => {
    return await readLogs();
});

ipcMain.handle('querylog:add', async (event, entry) => {
    await addLog(entry);
    return { ok: true };
});

ipcMain.handle('querylog:clear', async () => {
    const entries = await clearLogs();
    return { ok: true, entries };
});

ipcMain.handle('querylog:settings:get', async () => {
    return await getLogSettings();
});

ipcMain.handle('querylog:settings:choose-dir', async () => {
    if (!win) throw new Error('主窗口未就绪');
    const picked = await dialog.showOpenDialog(win, {
        title: '选择查询记录保存位置',
        properties: ['openDirectory', 'createDirectory'],
    });
    if (picked.canceled || !picked.filePaths?.[0]) return { canceled: true };
    const next = await setLogDir(picked.filePaths[0]);
    return { canceled: false, settings: next };
});

ipcMain.handle('querylog:files:list', async () => {
    return await listLogFiles();
});

ipcMain.handle('querylog:file:export', async (event, filename) => {
    if (!win) throw new Error('主窗口未就绪');
    return await exportFileWithDialog(win, filename);
});

ipcMain.handle('clipboard:writeText', async (event, text) => {
    clipboard.writeText(String(text ?? ''));
    return { ok: true };
});

ipcMain.handle('app:get-version', async () => {
    return { version: app.getVersion() };
});

// 接收渲染进程的数据
ipcMain.handle('submit-input', async (event, data) => {
    const serverStatus = await validateServerDbConfig();
    if (!serverStatus.ok) {
        throw new Error('服务器/数据库配置未导入。请在设置中导入 server-db-config.json。');
    }
    const cred = await validateCredentials();
    if (!cred.valid) {
        const missing = (cred.missing || []).join(', ');
        throw new Error(`证书未导入或缺失：${missing}。请先在主界面导入 global-bundle.pem 和 id_ed25519`);
    }
    const queryMode = data?.queryMode || 'email';
    return await myMainFunction(data.input, data.options, queryMode);
});


const getRegion=async (email)=>{
    const us1SSH=new Tunnel();
    await us1SSH.connect()
    const us1Mongo=new MongoDB(us1SSH,'us1')
    await us1Mongo.connect()
    const data=await us1Mongo.find('region', {email: email}, {email: 1, region: 1})
    return {
        regionData:data,
        Tunnel:us1SSH,
        MongoDB:us1Mongo
    }
}

const getRegionBySn=async (sn)=>{
    const snFilter = buildSnFilter(sn);

    // 1) 先查 us1
    const us1SSH = new Tunnel();
    await us1SSH.connect();
    const us1Mongo = new MongoDB(us1SSH, 'us1');
    await us1Mongo.connect();
    const deviceUs = await us1Mongo.find('BoundDevice', { sn: snFilter, effective: true }, { email: 1 });
    if (deviceUs) {
        const regionData = await us1Mongo.find('region', { email: deviceUs.email }, { email: 1, region: 1 });
        return {
            regionData,
            Tunnel: us1SSH,
            MongoDB: us1Mongo,
            deviceSn: sn,
            deviceEmail: deviceUs.email,
        };
    }

    us1Mongo.close();
    us1SSH.close();

    // 2) us 没查到，再查 jp1
    const jp1SSH = new Tunnel('jp1');
    await jp1SSH.connect();
    const jp1Mongo = new MongoDB(jp1SSH, 'jp1');
    await jp1Mongo.connect();

    const deviceJp = await jp1Mongo.find('BoundDevice', { sn: snFilter, effective: true }, { email: 1 });
    if (!deviceJp) {
        jp1Mongo.close();
        jp1SSH.close();
        return { regionData: null };
    }

    const regionData = await jp1Mongo.find('region', { email: deviceJp.email }, { email: 1, region: 1 });
    return {
        regionData,
        Tunnel: jp1SSH,
        MongoDB: jp1Mongo,
        deviceSn: sn,
        deviceEmail: deviceJp.email,
    };
}

const getEmailBySnUsThenJp = async (sn) => {
    const snFilter = buildSnFilter(sn);
    if (!snFilter) return null;

    // 1) us1
    const us1SSH = new Tunnel();
    await us1SSH.connect();
    const us1Mongo = new MongoDB(us1SSH, 'us1');
    await us1Mongo.connect();

    const deviceUs = await us1Mongo.find('BoundDevice', { sn: snFilter, effective: true }, { email: 1 });
    if (deviceUs?.email) {
        us1Mongo.close();
        us1SSH.close();
        return deviceUs.email;
    }
    us1Mongo.close();
    us1SSH.close();

    // 2) jp1
    const jp1SSH = new Tunnel('jp1');
    await jp1SSH.connect();
    const jp1Mongo = new MongoDB(jp1SSH, 'jp1');
    await jp1Mongo.connect();

    const deviceJp = await jp1Mongo.find('BoundDevice', { sn: snFilter, effective: true }, { email: 1 });
    if (deviceJp?.email) {
        jp1Mongo.close();
        jp1SSH.close();
        return deviceJp.email;
    }
    jp1Mongo.close();
    jp1SSH.close();

    return null;
};

const getJp1Data=async (regionData,options,deviceSn, showRegion = true)=>{
    //建立日区的隧道
    const jp1SSH=new Tunnel('jp1');
    await jp1SSH.connect()
    //建立日区的数据连接
    const jp1Mongo=new MongoDB(jp1SSH,'jp1')
    await jp1Mongo.connect()
    //查询数据
    return getData(jp1Mongo,regionData,options,()=>{jp1SSH.close()},deviceSn, showRegion)
}
const getData=async(MongoDB,userRegionData,options,func,deviceSn=null, showRegion = true)=>{
    const email=userRegionData?userRegionData.email:""
    const resultData={email}
    //查用户的设备、密码、sn、创建时间、时区、app版本、固件版本
    const userData=await MongoDB.find('User',{email:userRegionData.email},{email:1,password:1})

    if(options['password'])resultData['password']=userData?userData.password:""

    if(options['platform']||options['build']||options['endAt']){
        const LogData=await MongoDB.find('Log',{email:userRegionData.email},{email:1,platform:1,build:1,endAt:1})
        if(options['platform'])resultData['platform']=LogData?LogData.platform:""
        if(options['build'])resultData['build']=LogData?LogData.build:""
        if(options['endAt'])resultData['endAt']=LogData?LogData.endAt:""
    }

    if(options['sn']||options['mac']||options['swVersion']){
        const deviceQuery={email:email,effective:true}
        if(deviceSn) deviceQuery.sn = buildSnFilter(deviceSn)
        const device=await MongoDB.find('BoundDevice',deviceQuery,{sn:1,mac:1,swVersion:1})
        if(options['sn'])resultData['sn']=device?device.sn:''
        if(options['mac'])resultData['mac']=device?device.mac:''
        if(options['swVersion'])resultData['swVersion']=device?device.swVersion:''
    }
    MongoDB.close()
    func()
    const pretty = formatQueryResult({
        region: showRegion ? userRegionData.region : null,
        email: resultData.email,
        password: resultData.password,
        platform: resultData.platform,
        sn: resultData.sn,
        mac: resultData.mac,
        build: resultData.build,
        swVersion: resultData.swVersion,
    });
    return pretty;
}

function padRight(s, len) {
    const str = String(s ?? '');
    if (str.length >= len) return str;
    return str + ' '.repeat(len - str.length);
}

function displayWidth(input) {
    const str = String(input ?? '');
    let w = 0;
    for (const ch of str) {
        const cp = ch.codePointAt(0) || 0;
        // treat common CJK / fullwidth codepoints as width 2
        if (
            (cp >= 0x1100 && cp <= 0x115F) || // Hangul Jamo
            (cp >= 0x2E80 && cp <= 0xA4CF) || // CJK, Yi, etc.
            (cp >= 0xAC00 && cp <= 0xD7A3) || // Hangul Syllables
            (cp >= 0xF900 && cp <= 0xFAFF) || // CJK Compatibility Ideographs
            (cp >= 0xFE10 && cp <= 0xFE19) || // Vertical forms
            (cp >= 0xFE30 && cp <= 0xFE6F) || // CJK Compatibility Forms
            (cp >= 0xFF00 && cp <= 0xFF60) || // Fullwidth forms
            (cp >= 0xFFE0 && cp <= 0xFFE6)
        ) {
            w += 2;
        } else {
            w += 1;
        }
    }
    return w;
}

function padRightDisplay(input, targetWidth) {
    const str = String(input ?? '');
    const w = displayWidth(str);
    if (w >= targetWidth) return str;
    return str + ' '.repeat(targetWidth - w);
}

function formatQueryResult(data) {
    const now = new Date();
    const header = `用户查询结果  ${now.toLocaleString()}`;
    const rows = [
        data.region ? ['Region', data.region] : null,
        ['Email', data.email],
        data.password ? ['Password', data.password] : null,
        data.platform ? ['Platform', data.platform] : null,
        data.sn ? ['SN', data.sn] : null,
        data.mac ? ['MAC', data.mac] : null,
        data.build ? ['AppVersion', data.build] : null,
        data.swVersion ? ['FirmwareVersion', data.swVersion] : null,
    ].filter(Boolean);

    const keyWidth = Math.max(...rows.map(r => String(r[0]).length));
    const contentLines = rows.map(([k, v]) => `${padRight(k, keyWidth)} : ${v ?? ''}`);
    const innerWidth = Math.max(
        24,
        displayWidth(header),
        ...contentLines.map(l => displayWidth(l))
    ) + 2; // left/right padding inside box

    return [
        '┌' + '─'.repeat(innerWidth) + '┐',
        ...contentLines.map(l => `│ ${padRightDisplay(l, innerWidth - 2)} │`),
        '└' + '─'.repeat(innerWidth) + '┘',
    ].join('\n');
}
// 主函数处理逻辑
async function myMainFunction(input, options, queryMode = 'email') {
    const isSn = queryMode === 'sn';

    // SN 查询：只查 BoundDevice -> email（先 us1，不行再 jp1；都不行返回无数据）
    if (isSn) {
        const email = await getEmailBySnUsThenJp(input);
        if (!email) return '数据不存在';
        return formatQueryResult({ region: null, email });
    }

    // 邮箱查询：按勾选字段决定是否附带查设备详情/日志等
    const queryOptions = {};
    options.map(a => (queryOptions[a] = 1));

    const { regionData, Tunnel, MongoDB } = await getRegion(input);
    if (!regionData) {
        MongoDB?.close?.();
        Tunnel?.close?.();
        return '数据不存在';
    }

    if (regionData.region === 'ap-northeast-1') {
        MongoDB?.close?.();
        Tunnel?.close?.();
        return await getJp1Data(regionData, queryOptions, null, /* showRegion */ true);
    }

    return await getData(
        MongoDB,
        regionData,
        queryOptions,
        () => {
            Tunnel?.close?.();
        },
        null,
        /* showRegion */ true
    );
}


// app.whenReady().then(createWindow);
