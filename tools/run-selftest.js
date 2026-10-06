/* ============================================================================
 *  run-selftest.js —— 用本机 Chrome/Edge 无头运行 tools/selftest.html 并打印结果
 *  用法: npm run selftest
 * ========================================================================== */
'use strict';
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
];

const chrome = CANDIDATES.find((p) => { try { return fs.existsSync(p); } catch (e) { return false; } });
if (!chrome) { console.error('找不到 Chrome / Edge,无法运行自测。'); process.exit(1); }

const page = 'file:///' + path.resolve(__dirname, 'selftest.html').replace(/\\/g, '/');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'naidan-'));
const r = spawnSync(chrome, [
  '--headless=new', '--user-data-dir=' + profile,
  '--disable-gpu', '--no-sandbox', '--allow-file-access-from-files',
  '--virtual-time-budget=30000', '--dump-dom', page
], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

const dom = r.stdout || '';
const m = dom.match(/<pre id="out">([\s\S]*?)<\/pre>/);
if (!m) { console.error('自测页面没有输出,可能加载失败。'); process.exit(1); }
const text = m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
console.log(text);
const fail = /(\d+) failed/.exec(text);
process.exit(fail && Number(fail[1]) > 0 ? 1 : 0);
