/* ============================================================================
 *  preload.js —— 渲染进程与主进程之间唯一的桥(最小权限)
 * ========================================================================== */
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('petAPI', {
  ready:            ()      => ipcRenderer.send('pet:ready'),
  setIgnoreMouse:   (flag)  => ipcRenderer.send('pet:ignore-mouse', !!flag),
  dragStart:        ()      => ipcRenderer.send('pet:drag-start'),
  dragMove:         ()      => ipcRenderer.send('pet:drag-move'),
  dragEnd:          ()      => ipcRenderer.send('pet:drag-end'),
  contextMenu:      (state) => ipcRenderer.send('pet:context-menu', state || {}),
  onMuted:          (cb)    => ipcRenderer.on('pet:muted', (_e, v) => cb(!!v)),
  onNudge:          (cb)    => ipcRenderer.on('pet:nudge', () => cb()),
  onConfig:         (cb)    => ipcRenderer.on('pet:config', (_e, v) => cb(v)),
  onScale:          (cb)    => ipcRenderer.on('pet:scale', (_e, v) => cb(v)),
  onEyeFollow:      (cb)    => ipcRenderer.on('pet:eye-follow', (_e, v) => cb(v)),
  onCursor:         (cb)    => ipcRenderer.on('pet:cursor', (_e, v) => cb(v)),
  readAudio:        (f)     => ipcRenderer.invoke('pet:read-audio', f || null)
});
