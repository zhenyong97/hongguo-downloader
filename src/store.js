/**
 * store.js - module lưu trữ gọn nhẹ
 * Dùng một file JSON duy nhất để lưu "cài đặt" và "tác vụ tải", thay cho cơ sở dữ liệu sql.js + electron-store của dự án gốc,
 * giảm phụ thuộc, tiện đóng gói độc lập.
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

// ===== Hồ sơ phim ngắn (để trang phát vẫn liệt kê đủ các tập khi không có tác vụ tải) =====
function getSeries() {
  const c = loadCache();
  if (!Array.isArray(c.series)) c.series = [];
  return c.series;
}

function saveSeries(list) {
  loadCache().series = list || [];
  flush();
}

// ===== Tiến độ phát (xem tiếp từ chỗ đã dừng) =====
function getPlayback() {
  const c = loadCache();
  if (!c.playback || typeof c.playback !== 'object') c.playback = {};
  return c.playback;
}

function savePlayback(map) {
  loadCache().playback = map || {};
  flush();
}

// ===== Lịch sử tác vụ gộp =====
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

