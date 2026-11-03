/**
 * store.js - 精简持久化模块
 * 用单个 JSON 文件保存「设置」与「下载任务」，替代原项目里的 sql.js 数据库 + electron-store，
 * 减少依赖，方便独立打包。
 */
const fs = require('fs');
const path = require('path');

let dataFile = null;
let cache = null; // { settings, tasks }

function loadCache() {
  if (!dataFile) throw new Error('store chưa được khởi tạo');
  if (cache) return cache;
  try {
    if (fs.existsSync(dataFile)) {
      cache = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    }
  } catch (e) {
    console.error('[Store] Đọc tệp dữ liệu thất bại, dùng dữ liệu rỗng:', e.message);
  }
  if (!cache || typeof cache !== 'object') cache = {};
  if (!Array.isArray(cache.tasks)) cache.tasks = [];
  if (!cache.settings || typeof cache.settings !== 'object') cache.settings = {};
  return cache;
}

function flush() {
  if (!dataFile) return;
  try {
    fs.mkdirSync(path.dirname(dataFile), { recursive: true });
    fs.writeFileSync(dataFile, JSON.stringify(cache || {}, null, 2), 'utf8');
  } catch (e) {
    console.error('[Store] Ghi tệp dữ liệu thất bại:', e.message);
  }
}

function init(filePath) {
  dataFile = filePath;
  loadCache();
}

function getSettings() {
  return loadCache().settings;
}

function saveSettings(settings) {
  loadCache().settings = settings || {};
  flush();
}

function getTasks() {
  return loadCache().tasks;
}

function saveTasks(tasks) {
  loadCache().tasks = tasks || [];
  flush();
}

// ===== 短剧档案（让播放页在没有下载任务时也能列出完整分集）=====
function getSeries() {
  const c = loadCache();
  if (!Array.isArray(c.series)) c.series = [];
  return c.series;
}

function saveSeries(list) {
  loadCache().series = list || [];
  flush();
}

// ===== 播放进度（断点续播）=====
function getPlayback() {
  const c = loadCache();
  if (!c.playback || typeof c.playback !== 'object') c.playback = {};
  return c.playback;
}

function savePlayback(map) {
  loadCache().playback = map || {};
  flush();
}

// ===== 合并任务记录 =====
function getMergeTasks() {
  const c = loadCache();
  if (!Array.isArray(c.mergeTasks)) c.mergeTasks = [];
  return c.mergeTasks;
}

function saveMergeTasks(list) {
  loadCache().mergeTasks = list || [];
  flush();
}

module.exports = {
  init,
  getSettings,
  saveSettings,
  getTasks,
  saveTasks,
  getSeries,
  saveSeries,
  getPlayback,
  savePlayback,
  getMergeTasks,
  saveMergeTasks,
};

