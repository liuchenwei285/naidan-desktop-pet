'use strict';
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path'), fs = require('fs');
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'audio-preview');

ipcMain.on('save-wav', (_e, p) => {
  fs.mkdirSync(OUT, { recursive: true });
  const abs = path.join(OUT, p.name);
  fs.writeFileSync(abs, Buffer.from(p.data));
  console.log('[export] ' + abs + '  ' + p.data.byteLength + ' bytes');
});

ipcMain.handle('pet:read-audio', async () => {
  let CFG = null;
  try { require(path.join(ROOT, 'src', 'renderer', 'js', 'config.js')); CFG = globalThis.Naidan && globalThis.Naidan.CONFIG; } catch (e) {}
  const A = (CFG && CFG.audio) || {};
  const base = path.join(ROOT, 'src', 'renderer');
  const list = [A.file].concat(A.fallbackFiles || []).filter(Boolean);
  for (const rel of list) {
    const abs = path.resolve(base, rel);
    try {
      if (!fs.existsSync(abs)) continue;
      const buf = fs.readFileSync(abs);
      return { ok: true, data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), name: path.basename(abs) };
    } catch (e) {}
  }
  return { ok: false, error: 'not found' };
});

app.whenReady().then(() => {
  const win = new BrowserWindow({
    show: false, width: 400, height: 260,
    webPreferences: { preload: path.join(__dirname, 'export-preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  win.loadFile(path.join(__dirname, 'export-audio.html'));
  setTimeout(() => { try { app.quit(); } catch (e) {} }, 8000);
});
app.on('window-all-closed', () => app.quit());
