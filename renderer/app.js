const log = document.getElementById('log');
const submitBtn = document.getElementById('submitBtn');
const copyLogBtn = document.getElementById('copyLogBtn');
const clearBtn = document.getElementById('clearBtn');
const selectAllBtn = document.getElementById('selectAllBtn');
const selectNoneBtn = document.getElementById('selectNoneBtn');
const toastRoot = document.getElementById('toastRoot');
const uiModal = document.getElementById('uiModal');
const uiModalTitle = document.getElementById('uiModalTitle');
const uiModalBody = document.getElementById('uiModalBody');
const uiModalOkBtn = document.getElementById('uiModalOkBtn');
const uiModalCloseBtn = document.getElementById('uiModalCloseBtn');
const settingsBtn = document.getElementById('settingsBtn');
const settingsModal = document.getElementById('settingsModal');
const settingsCloseBtn = document.getElementById('settingsCloseBtn');
const appVersionText = document.getElementById('appVersionText');
const certStatusLine = document.getElementById('certStatusLine');
const certStatusDetails = document.getElementById('certStatusDetails');
const certImportBtn = document.getElementById('certImportBtn');
const certClearBtn = document.getElementById('certClearBtn');
const certRefreshBtn = document.getElementById('certRefreshBtn');
const serverDbStatusLine = document.getElementById('serverDbStatusLine');
const serverDbStatusDetails = document.getElementById('serverDbStatusDetails');
const serverDbImportBtn = document.getElementById('serverDbImportBtn');
const serverDbClearBtn = document.getElementById('serverDbClearBtn');
const serverDbRefreshBtn = document.getElementById('serverDbRefreshBtn');
const logDirLine = document.getElementById('logDirLine');
const logChooseDirBtn = document.getElementById('logChooseDirBtn');
const logExportActiveBtn = document.getElementById('logExportActiveBtn');
const logExportLatestArchiveBtn = document.getElementById('logExportLatestArchiveBtn');
const logClearPersistBtn = document.getElementById('logClearPersistBtn');
const inputLabel = document.getElementById('inputLabel');
const queryFieldsSection = document.getElementById('queryFieldsSection');
const queryModeRadios = document.querySelectorAll('input[name="queryMode"]');
const inputBox = document.getElementById('inputBox');

const MAX_LOG_CHARS = 30000;
async function appendLog(msg, level = 'info') {
    const line = String(msg ?? '');
    log.textContent += line + '\n';
    if (log.textContent.length > MAX_LOG_CHARS) {
        log.textContent = log.textContent.slice(log.textContent.length - MAX_LOG_CHARS);
    }
    log.scrollTop = log.scrollHeight; // 自动滚动到底部
    try {
        await window.api.addQueryLog({ level, message: line, ts: new Date().toISOString() });
    } catch {
        // ignore persistence failures
    }
}

copyLogBtn?.addEventListener('click', async () => {
    try {
        await window.api.clipboardWriteText(log?.textContent || '');
        showToast('ok', '已复制', '日志已复制到剪贴板');
    } catch (e) {
        showToast('err', '复制失败', e?.message || String(e));
    }
});

// 兼容复制/粘贴的兜底逻辑已移除（由系统菜单实现原生复制/粘贴）

function showToast(type, title, text, ms = 2400) {
    if (!toastRoot) return;
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = `<div class="toast-title">${title}</div><div class="toast-text">${text}</div>`;
    toastRoot.appendChild(el);
    setTimeout(() => {
        try { toastRoot.removeChild(el); } catch { /* ignore */ }
    }, ms);
}

function showModal(title, body) {
    if (!uiModal) return;
    uiModalTitle.textContent = title || '提示';
    uiModalBody.textContent = body || '';
    uiModal.classList.remove('hidden');
}
function closeModal() {
    uiModal?.classList.add('hidden');
}

function setModalOpen(open) {
    if (!settingsModal) return;
    settingsModal.classList.toggle('hidden', !open);
}

function renderCertStatus(status) {
    if (!certStatusLine || !certStatusDetails) return;
    if (!status) {
        certStatusLine.textContent = '未知';
        certStatusDetails.textContent = '';
        return;
    }

    if (status.valid) {
        certStatusLine.innerHTML = `<span class="status-ok">已导入</span>`;
    } else {
        const missing = (status.missing || []).join(', ') || '未知';
        certStatusLine.innerHTML = `<span class="status-bad">未导入</span>（缺少：${missing}）`;
    }

    const s = status.state || {};
    const lines = [
        `pem: ${status.paths?.pem || ''}`,
        `key: ${status.paths?.key || ''}`,
        s.importedAt ? `importedAt: ${s.importedAt}` : null,
        s.lastValidatedAt ? `lastValidatedAt: ${s.lastValidatedAt}` : null,
        s.pemSha256 ? `pemSha256: ${s.pemSha256}` : null,
        s.keySha256 ? `keySha256: ${s.keySha256}` : null,
    ].filter(Boolean);
    certStatusDetails.textContent = lines.join('\n');
}

async function refreshCertStatus() {
    try {
        certStatusLine.textContent = '加载中…';
        const status = await window.api.getCredentialsStatus();
        renderCertStatus(status);
        return status;
    } catch (e) {
        certStatusLine.innerHTML = `<span class="status-bad">读取失败</span>`;
        certStatusDetails.textContent = e?.message || String(e);
        return null;
    }
}

// 邮箱验证
function isValidEmail(email) {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
}

function getQueryMode() {
    const checked = Array.from(queryModeRadios).find(r => r.checked);
    return checked?.value || 'email';
}

function applyQueryModeUI(mode) {
    const input = document.getElementById('inputBox');
    if (!inputLabel || !input) return;
    if (mode === 'sn') {
        inputLabel.textContent = 'SN（必填）';
        input.placeholder = '请输入 SN';
        queryFieldsSection?.classList.add('hidden');
    } else {
        inputLabel.textContent = '邮箱（必填）';
        input.placeholder = 'name@example.com';
        queryFieldsSection?.classList.remove('hidden');
    }
}

queryModeRadios.forEach(radio => {
    radio.addEventListener('change', () => applyQueryModeUI(radio.value));
});
applyQueryModeUI(getQueryMode());

settingsBtn?.addEventListener('click', async () => {
    setModalOpen(true);
    try {
        const v = await window.api.getAppVersion();
        if (appVersionText) appVersionText.textContent = v?.version ? `版本：${v.version}` : '';
    } catch {
        if (appVersionText) appVersionText.textContent = '';
    }
    await refreshCertStatus();
    await refreshServerDbStatus();
    await refreshLogDirLine();
});
settingsCloseBtn?.addEventListener('click', () => setModalOpen(false));
settingsModal?.addEventListener('click', (e) => {
    if (e.target === settingsModal) setModalOpen(false);
});
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') setModalOpen(false);
});

uiModalOkBtn?.addEventListener('click', closeModal);
uiModalCloseBtn?.addEventListener('click', closeModal);
uiModal?.addEventListener('click', (e) => {
    if (e.target === uiModal) closeModal();
});

certRefreshBtn?.addEventListener('click', async () => {
    await refreshCertStatus();
});

async function refreshServerDbStatus() {
    try {
        if (serverDbStatusLine) serverDbStatusLine.textContent = '加载中…';
        const status = await window.api.serverDbGetStatus();
        if (!status || !status.ok) {
            if (serverDbStatusLine) serverDbStatusLine.innerHTML = '<span class="status-bad">未导入</span>';
            if (serverDbStatusDetails) {
                const reason = status?.reason ? `原因：${status.reason}` : '未知原因';
                serverDbStatusDetails.textContent = reason;
            }
            return status;
        }
        if (serverDbStatusLine) serverDbStatusLine.innerHTML = '<span class="status-ok">已导入</span>';
        const sshRegions = status.config?.ssh?.regions ? Object.keys(status.config.ssh.regions).join(', ') : '';
        const dstRegions = status.config?.forward?.regions ? Object.keys(status.config.forward.regions).join(', ') : '';
        const lines = [
            `ssh.regions: ${sshRegions || 'unknown'}`,
            `forward.regions: ${dstRegions || 'unknown'}`,
            `mongo.database: ${status.config?.mongo?.database || ''}`,
        ];
        serverDbStatusDetails.textContent = lines.join('\\n');
        return status;
    } catch (e) {
        if (serverDbStatusLine) serverDbStatusLine.innerHTML = '<span class="status-bad">读取失败</span>';
        if (serverDbStatusDetails) serverDbStatusDetails.textContent = e?.message || String(e);
        return null;
    }
}

serverDbRefreshBtn?.addEventListener('click', async () => {
    await refreshServerDbStatus();
});

serverDbImportBtn?.addEventListener('click', async () => {
    serverDbImportBtn.disabled = true;
    try {
        const res = await window.api.serverDbImport();
        if (res?.canceled) return;
        await refreshServerDbStatus();
        appendLog('服务器/数据库配置已导入');
    } catch (e) {
        appendLog(`❌ 导入配置失败: ${e.message}`);
    } finally {
        serverDbImportBtn.disabled = false;
    }
});

serverDbClearBtn?.addEventListener('click', async () => {
    serverDbClearBtn.disabled = true;
    try {
        const res = await window.api.serverDbClear();
        if (res?.canceled) return;
        await refreshServerDbStatus();
        appendLog('服务器/数据库配置已清除并重新导入');
    } catch (e) {
        appendLog(`❌ 清除配置失败: ${e.message}`);
    } finally {
        serverDbClearBtn.disabled = false;
    }
});

certImportBtn?.addEventListener('click', async () => {
    certImportBtn.disabled = true;
    try {
        const res = await window.api.importCredentials();
        if (res?.canceled) return;
        appendLog('证书/密钥导入成功');
    } catch (e) {
        appendLog(`❌ 导入失败: ${e.message}`);
    } finally {
        certImportBtn.disabled = false;
        await refreshCertStatus();
    }
});

certClearBtn?.addEventListener('click', async () => {
    certClearBtn.disabled = true;
    try {
        const res = await window.api.clearCredentials();
        if (res?.canceled) return;
        appendLog('🗑️ 已清除证书/密钥');
        if (res?.status?.valid) appendLog('证书/密钥已重新导入');
    } catch (e) {
        appendLog(`❌ 清除失败: ${e.message}`);
    } finally {
        certClearBtn.disabled = false;
        await refreshCertStatus();
    }
});

logClearPersistBtn?.addEventListener('click', async () => {
    try {
        await window.api.clearQueryLogs();
        log.textContent = '';
        showToast('ok', '已清空', '查询记录已清空');
    } catch (e) {
        showToast('err', '清空失败', e?.message || String(e));
    }
});

async function refreshLogDirLine() {
    if (!logDirLine) return;
    try {
        const s = await window.api.getQueryLogSettings();
        logDirLine.textContent = `保存位置：${s?.logDir || ''}`;
    } catch {
        logDirLine.textContent = '保存位置：读取失败';
    }
}

logChooseDirBtn?.addEventListener('click', async () => {
    try {
        const res = await window.api.chooseQueryLogDir();
        if (res?.canceled) return;
        await refreshLogDirLine();
        showToast('ok', '已更新', '保存位置已更新');
    } catch (e) {
        showToast('err', '设置失败', e?.message || String(e));
    }
});

async function pickLatestFiles() {
    const data = await window.api.listQueryLogFiles();
    const files = data?.files || [];
    const active = files.find(f => f.name === 'active.log');
    const latestArchive = files.find(f => f.name?.startsWith('archive-') && f.name?.endsWith('.log.gz'));
    return { active: active?.name || 'active.log', latestArchive: latestArchive?.name || null };
}

logExportActiveBtn?.addEventListener('click', async () => {
    try {
        const { active } = await pickLatestFiles();
        const res = await window.api.exportQueryLogFile(active);
        if (res?.canceled) return;
        showToast('ok', '已导出', '当前日志已导出');
    } catch (e) {
        showToast('err', '导出失败', e?.message || String(e));
    }
});

logExportLatestArchiveBtn?.addEventListener('click', async () => {
    try {
        const { latestArchive } = await pickLatestFiles();
        if (!latestArchive) {
            showToast('warn', '暂无归档', '还没有产生归档文件（超过 10MB 才会归档）');
            return;
        }
        const res = await window.api.exportQueryLogFile(latestArchive);
        if (res?.canceled) return;
        showToast('ok', '已导出', '最近归档已导出');
    } catch (e) {
        showToast('err', '导出失败', e?.message || String(e));
    }
});

submitBtn.addEventListener('click', async () => {
    const inputValue = document.getElementById('inputBox').value.trim();
    const queryMode = getQueryMode();
    if (!inputValue) {
        if (queryMode === 'sn') showModal('SN必填', '请输入 SN 后再查询。');
        else showModal('邮箱必填', '请输入邮箱后再查询。');
        return;
    }
    if (queryMode === 'email' && !isValidEmail(inputValue)) {
        showModal('邮箱格式不正确', '请检查邮箱格式，例如：name@example.com');
        return;
    }

    let selectedOptions = [];
    if (queryMode === 'email') {
        const checkboxes = document.querySelectorAll('.checkbox-group input[type=checkbox]');
        // 新布局里不再有 .checkbox-group，兼容处理
        const allBoxes = checkboxes.length
            ? checkboxes
            : document.querySelectorAll('.checkbox-grid input[type=checkbox]');
        selectedOptions = Array.from(allBoxes).filter(cb => cb.checked).map(cb => cb.value);
        // 不选字段 => 默认查全部字段
        if (selectedOptions.length === 0) {
            selectedOptions = ['password', 'platform', 'sn', 'mac', 'build', 'swVersion'];
            showToast('warn', '提示', '未选择字段，默认查询全部');
        }
    }

    submitBtn.disabled = true;
    submitBtn.innerHTML = '处理中 <span class="loader"></span>';
    await appendLog(`开始处理${queryMode === 'sn' ? 'SN' : '邮箱'}: ${inputValue}`, 'info');
    try {
        // 调用主进程处理
        const result = await window.api.submitInput({ input: inputValue, options: selectedOptions, queryMode });
        await appendLog(`${result}`, 'result');
    } catch (e) {
        await appendLog(`Error: ${e.message}`, 'error');
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '开始查询';
    }
});

clearBtn?.addEventListener('click', () => {
    document.getElementById('inputBox').value = '';
    const boxes = document.querySelectorAll('.checkbox-grid input[type=checkbox]');
    boxes.forEach(cb => cb.checked = false);
    log.textContent = '';
    showToast('ok', '已清空', '输入与选项已重置');
});

selectAllBtn?.addEventListener('click', () => {
    const boxes = document.querySelectorAll('.checkbox-grid input[type=checkbox]');
    boxes.forEach(cb => cb.checked = true);
});
selectNoneBtn?.addEventListener('click', () => {
    const boxes = document.querySelectorAll('.checkbox-grid input[type=checkbox]');
    boxes.forEach(cb => cb.checked = false);
});

(async () => {
    try {
        const entries = await window.api.listQueryLogs();
        if (Array.isArray(entries) && entries.length) {
            const text = entries.map(e => e.message).join('\n') + '\n';
            log.textContent = text.length > MAX_LOG_CHARS ? text.slice(text.length - MAX_LOG_CHARS) : text;
            log.scrollTop = log.scrollHeight;
        }
    } catch {
        // ignore
    }
})();

