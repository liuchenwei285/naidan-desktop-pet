/* ============================================================================
 *  main.js —— Electron 主进程
 * ----------------------------------------------------------------------------
 *  · 透明 / 无边框 / 置顶 / 不在任务栏 / 不抢键盘焦点
 *  · 透明区域鼠标穿透(渲染进程做像素级判定后回报)
 *  · 原生右键菜单:静音、置顶、开机自启、退出
 *  · 系统托盘:显示/隐藏桌宠、退出
 *  · 单实例:重复启动时不再开窗口,而是让已有桌宠轻轻弹一下
 *  · 退出时释放托盘、窗口,渲染进程自行关闭 AudioContext
 * ========================================================================== */
'use strict';

const {
  app, BrowserWindow, Menu, Tray, ipcMain, screen,
  nativeImage, shell
} = require('electron');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..', '..');
const RENDERER = path.join(ROOT, 'src', 'renderer', 'index.html');
const ICON_PNG = path.join(ROOT, 'build', 'icon.png');
const TRAY_PNG = path.join(ROOT, 'build', 'tray.png');

/* -------------------------------------------------------------------------- */
/* 读取渲染进程的 config.js —— 主进程与渲染进程共用同一份配置,避免两处不一致  */
/* -------------------------------------------------------------------------- */
let CFG = null;
try {
  require(path.join(ROOT, 'src', 'renderer', 'js', 'config.js'));
  CFG = globalThis.Naidan && globalThis.Naidan.CONFIG;
} catch (e) { console.warn('[config] 读取失败,使用内置默认值:', e.message); }

const BASE_W = (CFG && CFG.window && CFG.window.baseCanvasWidth) || 160;
const BASE_H = (CFG && CFG.window && CFG.window.baseCanvasHeight) || 170;
const SCALE_PRESETS = (CFG && CFG.appearance && CFG.appearance.presets) || [
  { key: 'small', label: '小(0.75)', scale: 0.75 },
  { key: 'normal', label: '默认(1.0)', scale: 1.00 },
  { key: 'large', label: '大(1.5)', scale: 1.50 }
];
const DEFAULT_SCALE = (CFG && CFG.appearance && CFG.appearance.scale) || 1.0;
const EYE_FOLLOW_DEFAULT = !(CFG && CFG.motion && CFG.motion.eyeFollow && CFG.motion.eyeFollow.enabled === false);

const STARTUP_MARGIN = (CFG && CFG.window && CFG.window.startupMargin) || { right: 24, bottom: 56 };
const ALWAYS_ON_TOP_DEFAULT = !(CFG && CFG.window && CFG.window.alwaysOnTop === false);
const APP_NAME = (CFG && CFG.app && CFG.app.name) || '奶蛋';

function winSize(scale) {
  const s = scale || 1;
  return { w: Math.round(BASE_W * s), h: Math.round(BASE_H * s) };
}

/* -------------------------------------------------------------------------- */
/* 设置持久化                                                                  */
/* -------------------------------------------------------------------------- */
const DEFAULTS = { muted: false, alwaysOnTop: ALWAYS_ON_TOP_DEFAULT, autoLaunch: false, visible: true,
                   scale: DEFAULT_SCALE, eyeFollow: EYE_FOLLOW_DEFAULT, x: null, y: null };
let settings = Object.assign({}, DEFAULTS);

function settingsPath() { return path.join(app.getPath('userData'), 'settings.json'); }

function loadSettings() {
  try {
    const raw = fs.readFileSync(settingsPath(), 'utf8');
    settings = Object.assign({}, DEFAULTS, JSON.parse(raw));
  } catch (e) { settings = Object.assign({}, DEFAULTS); }
}

let saveTimer = null;
function saveSettings() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2), 'utf8'); } catch (e) { /* ignore */ }
  }, 250);
}

/* -------------------------------------------------------------------------- */
/* 单实例                                                                      */
/* -------------------------------------------------------------------------- */
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  return;
}

/* -------------------------------------------------------------------------- */
/* 全局状态                                                                    */
/* -------------------------------------------------------------------------- */
let win = null;
let tray = null;
let isQuitting = false;
let dragState = null;

/* -------------------------------------------------------------------------- */
/* 窗口                                                                        */
/* -------------------------------------------------------------------------- */
function defaultPosition() {
  const d = screen.getPrimaryDisplay().workArea;
  const sz = winSize(settings.scale);
  // 默认停靠在右下角、任务栏上方(workArea 已经排除任务栏)
  return {
    x: Math.round(d.x + d.width - sz.w - (STARTUP_MARGIN.right || 0)),
    y: Math.round(d.y + d.height - sz.h - (STARTUP_MARGIN.bottom || 0))
  };
}

/** 保证窗口至少有 60px 落在某个显示器里(防止被拖到屏幕外找不回来) */
function clampToDisplay(x, y, sizeOverride) {
  const displays = screen.getAllDisplays();
  const minVisible = 60;
  const sz = sizeOverride || winSize(settings.scale);
  for (const d of displays) {
    const a = d.workArea;
    if (x + sz.w > a.x + minVisible && x < a.x + a.width - minVisible &&
        y + sz.h > a.y + minVisible && y < a.y + a.height - minVisible) {
      return { x, y };
    }
  }
  const p = screen.getPrimaryDisplay().workArea;
  return {
    x: Math.min(Math.max(x, p.x - sz.w + 120), p.x + p.width - 120),
    y: Math.min(Math.max(y, p.y), p.y + p.height - 60)
  };
}

function createWindow() {
  const pos = (settings.x === null || settings.y === null)
    ? defaultPosition()
    : clampToDisplay(settings.x, settings.y);

  const size = winSize(settings.scale);
  win = new BrowserWindow({
    width: size.w,
    height: size.h,
    x: pos.x,
    y: pos.y,
    transparent: true,
    frame: false,
    resizable: false,
    movable: true,
    hasShadow: false,
    skipTaskbar: true,          // 不出现在任务栏
    alwaysOnTop: settings.alwaysOnTop,
    focusable: false,           // 不抢键盘焦点
    fullscreenable: false,
    maximizable: false,
    minimizable: false,
    acceptFirstMouse: true,
    show: false,
    backgroundColor: '#00000000',
    icon: fs.existsSync(ICON_PNG) ? ICON_PNG : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false
    }
  });

  win.setAlwaysOnTop(settings.alwaysOnTop, 'floating');
  if (process.platform === 'darwin') {
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }
  win.setIgnoreMouseEvents(true, { forward: true });
  win.loadFile(RENDERER);

  win.once('ready-to-show', () => { if (settings.visible || SHOT_ARG) win.showInactive(); });

  win.on('close', (e) => {
    if (!isQuitting) { e.preventDefault(); hidePet(); }
  });
  win.on('closed', () => { win = null; });
}

function showPet() {
  if (!win) { createWindow(); settings.visible = true; saveSettings(); return; }
  settings.visible = true; saveSettings();
  win.showInactive();
  curLast = null; scheduleCursorPoll();
  if (tray) refreshTrayMenu();
}

function hidePet() {
  if (!win) return;
  settings.visible = false; saveSettings();
  stopCursorPoll();
  win.hide();
  if (tray) refreshTrayMenu();
}

function togglePet() { settings.visible ? hidePet() : showPet(); }

/* -------------------------------------------------------------------------- */
/* 全局光标轮询:让瞳孔跟随整个屏幕上的鼠标                                     */
/*   · 窗口隐藏 / 最小化时停止                                                  */
/*   · 鼠标没动时降到 10Hz,动了用 60Hz(CPU 占用低)                            */
/* -------------------------------------------------------------------------- */
let cursorTimer = null;
let curLast = null;
let curMoving = false;

const EF_CFG = (CFG && CFG.motion && CFG.motion.eyeFollow) || {};

function stopCursorPoll() {
  if (cursorTimer) { clearTimeout(cursorTimer); cursorTimer = null; }
  curLast = null;
}

function scheduleCursorPoll() {
  if (cursorTimer) return;
  if (!settings.eyeFollow || !win || !settings.visible || win.isMinimized()) return;
  const hz = curMoving ? (EF_CFG.pollHzActive || 60) : (EF_CFG.pollHzIdle || 10);
  cursorTimer = setTimeout(pollCursor, Math.max(16, Math.round(1000 / hz)));
}

function pollCursor() {
  cursorTimer = null;
  if (!settings.eyeFollow || !win || !settings.visible || win.isMinimized()) return;
  try {
    const p = screen.getCursorScreenPoint();
    const b = win.getBounds();
    curMoving = !curLast || Math.abs(p.x - curLast.x) > 0.5 || Math.abs(p.y - curLast.y) > 0.5;
    curLast = p;
    // 换算成「窗口内坐标」再发给渲染进程
    win.webContents.send('pet:cursor', {
      x: p.x - b.x, y: p.y - b.y,
      w: b.width, h: b.height,
      screenX: p.x, screenY: p.y,
      moving: curMoving
    });
  } catch (e) { /* ignore */ }
  scheduleCursorPoll();
}

/* -------------------------------------------------------------------------- */
/* 托盘                                                                        */
/* -------------------------------------------------------------------------- */
function trayImage() {
  let img = null;
  if (fs.existsSync(TRAY_PNG)) img = nativeImage.createFromPath(TRAY_PNG);
  else if (fs.existsSync(ICON_PNG)) img = nativeImage.createFromPath(ICON_PNG);
  if (!img || img.isEmpty()) return null;
  return img.resize({ width: 16, height: 16, quality: 'best' });
}

function refreshTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: settings.visible ? '隐藏桌宠' : '显示桌宠', click: togglePet },
    { type: 'separator' },
    { label: '静音', type: 'checkbox', checked: settings.muted, click: (mi) => setMuted(mi.checked) },
    { label: '窗口置顶', type: 'checkbox', checked: settings.alwaysOnTop, click: (mi) => setAlwaysOnTop(mi.checked) },
    { label: '开机自启', type: 'checkbox', checked: settings.autoLaunch, click: (mi) => setAutoLaunch(mi.checked) },
    { type: 'separator' },
    { label: '大小', submenu: sizeSubmenu() },
    { label: '眼睛跟随鼠标', type: 'checkbox', checked: settings.eyeFollow, click: (mi) => setEyeFollow(mi.checked) },
    { type: 'separator' },
    { label: '退出', click: () => quitApp() }
  ]));
}

function createTray() {
  const img = trayImage();
  if (!img) { console.warn('[tray] 未找到托盘图标,跳过托盘创建'); return; }
  tray = new Tray(img);
  tray.setToolTip(APP_NAME + ' —— 右键可调大小 / 静音 / 置顶 / 退出');
  refreshTrayMenu();
  tray.on('double-click', togglePet);
  tray.on('click', () => { if (!settings.visible) showPet(); });
}

/* -------------------------------------------------------------------------- */
/* 设置项动作                                                                  */
/* -------------------------------------------------------------------------- */
function sizeSubmenu() {
  return SCALE_PRESETS.map((p) => ({
    label: p.label, type: 'radio', checked: Math.abs(settings.scale - p.scale) < 1e-6,
    click: () => setScale(p.scale)
  }));
}

/** 切换大小:窗口尺寸 + 渲染尺寸同步,底部中心保持不动,并记住选择 */
function setScale(scale) {
  settings.scale = Number(scale) || DEFAULT_SCALE;
  saveSettings();
  if (win) {
    const b = win.getBounds();
    const cx = b.x + b.width / 2, bottom = b.y + b.height;
    const n = winSize(settings.scale);
    let x = Math.round(cx - n.w / 2), y = Math.round(bottom - n.h);
    const c = clampToDisplay(x, y, n);
    win.setBounds({ x: c.x, y: c.y, width: n.w, height: n.h });
    settings.x = c.x; settings.y = c.y; saveSettings();
    win.webContents.send('pet:scale', settings.scale);
  }
  refreshTrayMenu();
}

function setMuted(m) {
  settings.muted = !!m; saveSettings();
  if (win) win.webContents.send('pet:muted', settings.muted);
  refreshTrayMenu();
}

function setAlwaysOnTop(v) {
  settings.alwaysOnTop = !!v; saveSettings();
  if (win) win.setAlwaysOnTop(settings.alwaysOnTop, 'floating');
  refreshTrayMenu();
}

function setAutoLaunch(v) {
  settings.autoLaunch = !!v; saveSettings();
  try {
    app.setLoginItemSettings({
      openAtLogin: settings.autoLaunch,
      openAsHidden: false,
      path: process.execPath,
      args: app.isPackaged ? [] : [app.getAppPath()]
    });
  } catch (e) { console.warn('[autostart] 设置失败:', e.message); }
  refreshTrayMenu();
}

/* -------------------------------------------------------------------------- */
/* IPC                                                                         */
/* -------------------------------------------------------------------------- */
/* 音频文件读取:file:// 页面不能 fetch,由主进程读字节流交给渲染进程解码 */
ipcMain.handle('pet:read-audio', async () => {
  const A = (CFG && CFG.audio) || {};
  const base = path.join(ROOT, 'src', 'renderer');
  const list = [A.file].concat(A.fallbackFiles || []).filter(Boolean);
  for (const rel of list) {
    const abs = path.resolve(base, rel);
    try {
      if (!fs.existsSync(abs)) continue;
      const buf = fs.readFileSync(abs);
      const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
      console.log('[audio] 已加载', abs, buf.length, 'bytes');
      return { ok: true, data: ab, name: path.basename(abs) };
    } catch (e) { /* 试下一个 */ }
  }
  console.warn('[audio] 未找到音频文件。请把 Bubble_4 放到:',
               path.join(ROOT, 'audio', 'bubble_4.mp3'));
  return { ok: false, error: 'audio file not found' };
});

ipcMain.on('pet:ready', () => {
  if (!win) return;
  win.webContents.send('pet:config', {
    muted: settings.muted, alwaysOnTop: settings.alwaysOnTop,
    scale: settings.scale, eyeFollow: settings.eyeFollow
  });
  curLast = null; scheduleCursorPoll();
});

ipcMain.on('pet:ignore-mouse', (_e, flag) => {
  if (!win) return;
  // forward:true —— 即使穿透也能收到 mousemove,才能判断何时重新“变实心”
  win.setIgnoreMouseEvents(!!flag, { forward: true });
});

ipcMain.on('pet:drag-start', () => {
  if (!win) return;
  const cur = screen.getCursorScreenPoint();
  const [x, y] = win.getPosition();
  dragState = { cx: cur.x, cy: cur.y, wx: x, wy: y };
  win.setIgnoreMouseEvents(false);
});

ipcMain.on('pet:drag-move', () => {
  if (!win || !dragState) return;
  const cur = screen.getCursorScreenPoint();
  win.setPosition(Math.round(dragState.wx + (cur.x - dragState.cx)),
                  Math.round(dragState.wy + (cur.y - dragState.cy)));
});

ipcMain.on('pet:drag-end', () => {
  dragState = null;
  if (!win) return;
  const [x, y] = win.getPosition();
  const c = clampToDisplay(x, y, winSize(settings.scale));
  if (c.x !== x || c.y !== y) win.setPosition(c.x, c.y);
  settings.x = c.x; settings.y = c.y; saveSettings();
});

ipcMain.on('pet:context-menu', (_e, state) => {
  if (!win) return;
  if (state && typeof state.muted === 'boolean' && state.muted !== settings.muted) settings.muted = state.muted;

  const menu = Menu.buildFromTemplate([
    { label: '静音', type: 'checkbox', checked: settings.muted, click: (mi) => setMuted(mi.checked) },
    { label: '窗口置顶', type: 'checkbox', checked: settings.alwaysOnTop, click: (mi) => setAlwaysOnTop(mi.checked) },
    { label: '开机自启', type: 'checkbox', checked: settings.autoLaunch, click: (mi) => setAutoLaunch(mi.checked) },
    { type: 'separator' },
    { label: '大小', submenu: sizeSubmenu() },
    { label: '眼睛跟随鼠标', type: 'checkbox', checked: settings.eyeFollow, click: (mi) => setEyeFollow(mi.checked) },
    { type: 'separator' },
    { label: '隐藏桌宠(可在托盘恢复)', click: hidePet },
    { type: 'separator' },
    { label: '退出', click: () => quitApp() }
  ]);
  menu.popup({ window: win });
});

/* -------------------------------------------------------------------------- */
/* 退出                                                                        */
/* -------------------------------------------------------------------------- */
function quitApp() {
  isQuitting = true;
  try { if (tray) { tray.destroy(); tray = null; } } catch (e) { /* ignore */ }
  try { if (win) { win.setIgnoreMouseEvents(true); win.removeAllListeners('close'); win.destroy(); win = null; } } catch (e) { /* ignore */ }
  app.quit();
  // 兜底:3 秒内若仍未退出,强制结束
  setTimeout(() => { try { process.exit(0); } catch (e) { /* ignore */ } }, 3000).unref();
}

app.on('window-all-closed', (e) => {
  // 有托盘时不要因为窗口关闭而退出;真正退出只走 quitApp()
  if (isQuitting) app.quit();
});

app.on('before-quit', () => { isQuitting = true; });

app.on('second-instance', () => {
  if (!win) { showPet(); return; }
  if (!settings.visible) showPet();
  win.setAlwaysOnTop(true, 'floating');
  if (settings.alwaysOnTop === false) win.setAlwaysOnTop(false, 'floating');
  win.webContents.send('pet:nudge');       // 已有桌宠轻轻弹一下
  win.showInactive();
});

/* -------------------------------------------------------------------------- */
/* 自测:--shot=<png> 启动后截图并退出(用于自动化验收)                        */
/* -------------------------------------------------------------------------- */
const SHOT_ARG = process.argv.find((a) => a.startsWith('--shot='));
const SHOT_DELAY = parseInt((process.argv.find((a) => a.startsWith('--shot-delay=')) || '--shot-delay=2000').split('=')[1], 10);

function runShot() {
  if (!SHOT_ARG || !win) return;
  win.webContents.once('did-finish-load', () => {
    setTimeout(async () => {
      try {
        const img = await win.webContents.capturePage();
        fs.writeFileSync(SHOT_ARG.split('=')[1], img.toPNG());
        console.log('[shot] saved ->', SHOT_ARG.split('=')[1]);
      } catch (e) {
        console.error('[shot] failed:', e.message);
      }
      isQuitting = true;
      app.exit(0);
    }, SHOT_DELAY);
  });
}

app.whenReady().then(() => {
  loadSettings();
  try {
    const ls = app.getLoginItemSettings();
    if (settings.autoLaunch !== !!ls.openAtLogin) { settings.autoLaunch = !!ls.openAtLogin; }
  } catch (e) { /* ignore */ }

  createWindow();
  createTray();
  runShot();

  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); else showPet(); });
});

// 安全:禁止导航到外部页面
app.on('web-contents-created', (_e, contents) => {
  contents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  contents.on('will-navigate', (e) => e.preventDefault());
});
