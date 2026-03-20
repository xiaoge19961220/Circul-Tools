const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    submitInput: (data) => ipcRenderer.invoke('submit-input', data),
    getCredentialsStatus: () => ipcRenderer.invoke('credentials:get-status'),
    importCredentials: () => ipcRenderer.invoke('credentials:import'),
    clearCredentials: () => ipcRenderer.invoke('credentials:clear'),
    listQueryLogs: () => ipcRenderer.invoke('querylog:list'),
    addQueryLog: (entry) => ipcRenderer.invoke('querylog:add', entry),
    clearQueryLogs: () => ipcRenderer.invoke('querylog:clear'),
    getQueryLogSettings: () => ipcRenderer.invoke('querylog:settings:get'),
    chooseQueryLogDir: () => ipcRenderer.invoke('querylog:settings:choose-dir'),
    listQueryLogFiles: () => ipcRenderer.invoke('querylog:files:list'),
    exportQueryLogFile: (filename) => ipcRenderer.invoke('querylog:file:export', filename),
    clipboardWriteText: (text) => ipcRenderer.invoke('clipboard:writeText', text),
    getAppVersion: () => ipcRenderer.invoke('app:get-version'),
    serverDbGetStatus: () => ipcRenderer.invoke('serverdb:get-status'),
    serverDbImport: () => ipcRenderer.invoke('serverdb:import'),
    serverDbClear: () => ipcRenderer.invoke('serverdb:clear'),
});