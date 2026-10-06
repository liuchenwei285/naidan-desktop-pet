'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('exportAPI', {
  save: (name, data) => ipcRenderer.send('save-wav', { name: name, data: data })
});
contextBridge.exposeInMainWorld('petAPI', {
  readAudio: (f) => ipcRenderer.invoke('pet:read-audio', f || null)
});
