/**
 * main.js - 红果短剧下载器（独立版）主进程
 *
 * 功能：
 *   1. 红果短剧解析（分享链接 / series_id -> 全剧集列表）
 *   2. 批量提交下载任务到下载队列
 *   3. 并发下载：流式下载播放直链 -> spade_a 派生 AES Key -> CENC-AES-CTR 解密 -> 输出 mp4
 *   4. 下载管理：进度推送、暂停/取消、重试、删除、打开所在文件夹
 *   5. 设置：下载目录、命名规则、并发数（JSON 文件持久化）
 */
const { app, BrowserWindow, ipcMain, dialog, shell, session, protocol } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const axios = require('axios');

const hongguo = require('./src/native/hongguo');
const store = require('./src/store');
const APP_VERSION = app.getVersion() || '1.0.0';

const APP_TITLE = '红果短剧下载器';

let mainWindow = null;

// ===== 视频解码兼容性 =====
// 平台视频是 HEVC(bytevc1)，Chromium 在 Windows 上只能靠硬件解码 HEVC。
// 若显卡不支持、或被 Chromium 的 GPU 黑名单挡掉，就会出现「黑屏但有声音」。
// 这里主动开启平台 HEVC 解码并放宽黑名单，能救回相当一部分机器；
// 仍然不行的，由「兼容模式转码」兜底（见 transcodeForPlayback）。
app.commandLine.appendSwitch('enable-features', 'PlatformHEVCDecoderSupport,PlatformHEVCEncoderSupport');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
// 允许在无硬件解码时也尽量使用平台解码器
app.commandLine.appendSwitch('disable-features', 'UseChromeOSDirectVideoDecoder');


// ===== 在线播放：自定义流协议（内存缓存 + Range 支持）=====
// 视频是 CENC 加密的，无法直接把 CDN 地址交给 <video> 播放，
// 因此这里先在内存里完成「下载 + 解密」，再用自定义协议按 Range 供给播放器。
// 好处：不落盘（不占用用户的下载目录），且支持拖动进度。
const STREAM_SCHEME = 'hongguo-stream';
// 本地已下载文件的播放协议。
// 不能在开发模式下直接用 file:// —— 渲染页面来自 http://localhost:5173，
// Chromium 会以「Not allowed to load local resource」拒绝（表现为播放器黑屏、0:00）。
// 因此改由主进程用 Node 读文件并通过自定义协议供给，带 Range 支持以便拖动进度。
const LOCAL_SCHEME = 'hongguo-local';
protocol.registerSchemesAsPrivileged([
  {
    scheme: STREAM_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: false },
  },
  {
    scheme: LOCAL_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: false },
  },
]);

/** vid -> { buffer, size, lastUsed, seriesId, vidIndex } */
const onlineCache = new Map();
const ONLINE_MAX_BYTES = 300 * 1024 * 1024; // 内存缓存上限
let onlinePreparing = new Map(); // vid -> Promise，避免同集重复下载

function onlineCacheTotal() {
  let t = 0;
  for (const e of onlineCache.values()) t += e.size;
  return t;
}

function trimOnlineCache() {
  let total = onlineCacheTotal();
  while (total > ONLINE_MAX_BYTES && onlineCache.size > 1) {
    let oldestKey = null;
    let oldest = Infinity;
    for (const [k, e] of onlineCache) {
      if (e.lastUsed < oldest) { oldest = e.lastUsed; oldestKey = k; }
    }
    if (!oldestKey) break;
    total -= onlineCache.get(oldestKey).size;
    onlineCache.delete(oldestKey);
  }
}

function clearOnlineCache() {
  onlineCache.clear();
}



// ===== 下载任务管理 =====
let downloadTasks = [];
let downloadQueue = [];
let activeDownloads = 0;
let MAX_CONCURRENT_DOWNLOADS = 3;

// ===== 设置 =====
function getDefaultSettings() {
  return {
    root: app.getPath('downloads'),
    // 文件命名模板：可用变量 剧名(series_title) 集数(vid_index) 标题(ep_title)
    name_format: '剧名 集数',
    max_concurrent: 3,
    // 看完一集后自动删除本地文件（边看边清，避免占用磁盘）
    auto_delete_watched: false,
    // 兼容模式：本机无法解码 HEVC 时自动转码为 H.264（解决「黑屏有声」）
    compat_mode: true,
    // ===== 网络代理 =====
    // proxy_enabled: 是否启用代理（关闭时忽略系统代理，直连）
    // proxy_mode:    system=跟随系统/环境变量 · custom=手动指定 · direct=强制直连
    proxy_enabled: false,
    proxy_mode: 'system',
    proxy_host: '127.0.0.1',
    proxy_port: 7890,
    proxy_username: '',
    proxy_password: '',
  };
}

/**
 * 计算当前生效的代理 URL。
 * 返回 { mode, url }：
 *   mode='direct'  直连
 *   mode='system'  跟随系统/环境变量（url 可能是环境变量里的代理，用于展示）
 *   mode='custom'  手动指定
 */
function resolveProxyConfig(settings) {
  const s = settings || {};
  if (s.proxy_enabled !== true) {
    return { mode: 'direct', url: null };
  }
  const mode = s.proxy_mode || 'system';
  if (mode === 'direct') {
    return { mode: 'direct', url: null };
  }
  if (mode === 'custom') {
    let host = String(s.proxy_host || '').trim();
    const port = String(s.proxy_port || '').trim();
    if (!host) return { mode: 'custom', url: null };
    // 容错：用户可能直接粘贴了 http://host:port 甚至带账号密码
    let protocol = 'http';
    const scheme = host.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//);
    if (scheme) {
      protocol = scheme[1].toLowerCase();
      host = host.slice(scheme[0].length);
    }
    host = host.replace(/\/+$/, '');
    if (!port && !/:\d+$/.test(host)) return { mode: 'custom', url: null };

    const username = String(s.proxy_username || '').trim();
    const password = String(s.proxy_password || '');
    let auth = '';
    if (username) {
      auth = encodeURIComponent(username) + ':' + encodeURIComponent(password) + '@';
    }
    return { mode: 'custom', url: `${protocol}://${auth}${host}${port ? ':' + port : ''}` };
  }
  // system：以环境变量为准
  const envUrl =
    process.env.HTTPS_PROXY || process.env.https_proxy ||
    process.env.HTTP_PROXY || process.env.http_proxy || null;
  return { mode: 'system', url: envUrl };
}

/**
 * 把代理写进环境变量，axios 会自动读取（proxy-from-env），
 * 因此红果 API 解析与视频下载都会走代理，无需改动业务代码。
 */
function applyProxyToEnv(resolved) {
  const keys = ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy'];
  for (const k of keys) {
    if (resolved.url) process.env[k] = resolved.url;
    else delete process.env[k];
  }
}

/** 让 Electron 窗口自身的请求（如封面图）也走代理 */
async function applyProxyToSession(resolved) {
  try {
    const ses = session.defaultSession;
    if (!ses) return;
    if (resolved.mode === 'direct') {
      await ses.setProxy({ mode: 'direct' });
    } else if (resolved.mode === 'custom' && resolved.url) {
      await ses.setProxy({ mode: 'fixed_servers', proxyRules: resolved.url });
    } else {
      await ses.setProxy({ mode: 'system' });
    }
  } catch (e) {
    console.error('[Proxy] 设置窗口代理失败:', e.message);
  }
}

/** 统一入口：设置变化或启动时调用 */
async function applyProxySettings(settings) {
  const resolved = resolveProxyConfig(settings);
  applyProxyToEnv(resolved);
  await applyProxyToSession(resolved);
  console.log(`[Proxy] mode=${resolved.mode} url=${resolved.url || '(直连)'}`);
  return resolved;
}

function getCurrentSettings() {
  const saved = store.getSettings() || {};
  const merged = { ...getDefaultSettings(), ...saved };
  // 保证并发数合法
  const mc = parseInt(merged.max_concurrent, 10);
  MAX_CONCURRENT_DOWNLOADS = Number.isInteger(mc) && mc >= 1 && mc <= 10 ? mc : 3;
  return { ...merged, max_concurrent: MAX_CONCURRENT_DOWNLOADS };
}

// 净化文件夹/文件名称（移除非法字符、结尾的点和空格）
function sanitizeFolderName(name) {
  return String(name || '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
    .replace(/[. ]+$/g, '')
    .trim()
    .slice(0, 80) || '';
}

// 按命名模板渲染文件名，返回 名称(不含扩展名) 或 null
function renderName(format, seriesTitle, vidIndex, epTitle) {
  const fmt = String(format || '').trim();
  if (!fmt) return null;
  const vars = {
    'series_title': String(seriesTitle || '').trim(),
    'vid_index': String(vidIndex).padStart(3, '0'),
    'ep_title': String(epTitle || '').trim(),
  };
  const zhMap = {
    '剧名': 'series_title',
    '集数': 'vid_index',
    '标题': 'ep_title',
  };
  const zhRe = /剧名|集数|标题/g;
  let name = fmt
    .replace(zhRe, (w) => zhMap[w] || w)
    .replace(/([A-Za-z]+(?:_[A-Za-z]+)*)/g, (tok) => (vars[tok] !== undefined ? (vars[tok] || '') : tok));
  name = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/\s+/g, ' ').trim();
  return name || null;
}

// ===== 加载/保存下载任务 =====
function loadDownloadTasks() {
  const saved = store.getTasks() || [];
  saved.sort((a, b) => (b.startTime || 0) - (a.startTime || 0));
  downloadTasks = saved.map((task) => {
    const inProgress = task.status === 'downloading' || task.status === 'pending';
    return {
      ...task,
      status: inProgress ? 'failed' : task.status,
      error: inProgress ? '应用关闭时任务中断' : task.error,
    };
  });
}

/**
 * 从已有下载任务回填短剧档案。
 * 用户可能在这功能上线前就已经下载了不少剧集，没有档案播放页就看不到它们。
 */
function rebuildSeriesRegistryFromTasks() {
  const groups = new Map();
  for (const t of downloadTasks) {
    const info = t.hongguoInfo;
    if (!info || !info.series_id) continue;
    const sid = String(info.series_id);
    if (!groups.has(sid)) {
      groups.set(sid, {
        series_id: sid,
        series_title: info.series_title || '未命名短剧',
        cover: (t.videoInfo && t.videoInfo.cover) || '',
        episodes: new Map(),
      });
    }
    const g = groups.get(sid);
    const idx = Number(info.vid_index) || 0;
    if (!g.episodes.has(idx)) {
      g.episodes.set(idx, {
        vid: String(info.vid),
        vid_index: idx,
        title: info.ep_title || '',
        cover: (t.videoInfo && t.videoInfo.cover) || '',
      });
    }
  }

  let added = 0;
  for (const g of groups.values()) {
    const existing = seriesRegistry.find((s) => String(s.series_id) === g.series_id);
    const list = Array.from(g.episodes.values()).sort((a, b) => a.vid_index - b.vid_index);
    if (!existing) {
      seriesRegistry.push({
        series_id: g.series_id,
        series_title: g.series_title,
        cover: g.cover,
        total: list.length,
        episodes: list,
        updatedAt: 0, // 回填的排在搜索/解析得到的后面
        dismissed: false,
      });
      added++;
    } else if (!existing.dismissed && (!existing.episodes || existing.episodes.length < list.length)) {
      // 档案里的分集不完整时，用任务里能凑出的补上
      existing.episodes = list;
      existing.total = list.length;
      added++;
    }
  }
  if (added > 0) {
    saveSeriesRegistry();
    console.log(`[Series] 从下载任务回填 ${added} 部短剧档案`);
  }
}

function saveDownloadTasks() {
  const serializable = downloadTasks.map((task) => {
    const { cancelSource, writer, ...rest } = task;
    return rest;
  });
  store.saveTasks(serializable);
}

// ===== 短剧档案（播放页据此列出完整分集）=====
let seriesRegistry = [];

function loadSeriesRegistry() {
  seriesRegistry = store.getSeries() || [];
}

function saveSeriesRegistry() {
  store.saveSeries(seriesRegistry);
}

/**
 * 登记/更新一部短剧。data 需含 series_id 与 episodes。
 * 已有的不覆盖 episodes（避免接口异常时把好数据冲掉），仅补全标题与封面。
 */
function upsertSeriesRegistry(data) {
  if (!data || !data.series_id || !Array.isArray(data.episodes) || data.episodes.length === 0) return;
  const sid = String(data.series_id);
  const idx = seriesRegistry.findIndex((s) => String(s.series_id) === sid);
  const entry = {
    series_id: sid,
    series_title: data.series_title || '未命名短剧',
    cover: data.cover || '',
    total: data.episodes.length,
    episodes: data.episodes.map((e) => ({
      vid: String(e.vid),
      vid_index: e.vid_index || 0,
      title: e.title || '',
      cover: e.cover || '',
    })),
    updatedAt: Date.now(),
    dismissed: false, // 用户主动移除过；再次登记时自动恢复显示
  };
  if (idx === -1) seriesRegistry.unshift(entry);
  else seriesRegistry[idx] = { ...seriesRegistry[idx], ...entry, dismissed: false };
  saveSeriesRegistry();
}

/** 播放页/合并选择器可见的短剧（过滤掉被用户移除的） */
function visibleSeries() {
  return seriesRegistry.filter((s) => !s.dismissed);
}

// ===== 下载队列调度 =====
// 说明：这里必须「立即返回」。早期实现写成 `await executeDownload(task)`，
// 会让一次调用只启动一个任务、并一直阻塞到该任务结束，
// 导致并发数恒为 1（无论 max_concurrent 设为多少）。
// 现在由 runTask 自行在结束时回调 pumpQueue，调度器只负责按并发上限派发。
function pumpQueue() {
  while (activeDownloads < MAX_CONCURRENT_DOWNLOADS && downloadQueue.length > 0) {
    const task = downloadQueue.shift();
    if (!task) break;
    activeDownloads++;
    runTask(task);
  }
}

async function runTask(task) {
  try {
    await executeDownload(task);
  } catch (error) {
    console.error('[Download Queue] 下载失败:', error);
  } finally {
    activeDownloads--;
    pumpQueue();
  }
}

// 保留旧名，内部逻辑保持不变（多处调用点仍在用）
function processDownloadQueue() {
  pumpQueue();
}

/** 把等待中的任务重新排进队列（用于启动时自动续跑 / 一键启动） */
function enqueuePendingTasks() {
  const pending = downloadTasks.filter(
    (t) => t.status === 'pending' && !downloadQueue.some((q) => q.id === t.id)
  );
  for (const t of pending) downloadQueue.push(t);
  return pending.length;
}

/**
 * 一键暂停：取消进行中的任务、清空等待队列、把等待中的标记为已停止。
 * 返回被暂停的任务数。
 */
function pauseAllTasks() {
  let stopped = 0;
  for (const task of downloadTasks) {
    if (task.status === 'pending') {
      task.status = 'stopped';
      task.error = '已手动暂停';
      task.endTime = Date.now();
      stopped++;
    } else if (task.status === 'downloading') {
      task.cancelled = true;
      if (task.cancelSource) {
        try { task.cancelSource.cancel('用户一键暂停'); } catch (_) {}
      }
      if (task.writer) {
        try { task.writer.end(); } catch (_) {}
      }
      task.status = 'stopped';
      delete task.cancelSource;
      delete task.writer;
      stopped++;
    }
  }
  downloadQueue = [];
  saveDownloadTasks();
  sendToRenderer('download-queue-changed', {});
  return stopped;
}

/**
 * 一键启动：把所有未完成（已停止 / 失败 / 等待中）的任务重新排队开跑。
 * 返回重新排队任务数。
 */
function resumeAllTasks() {
  let count = 0;
  for (const task of downloadTasks) {
    if (task.status !== 'stopped' && task.status !== 'failed' && task.status !== 'pending') continue;

    task.status = 'pending';
    task.progress = 0;
    task.receivedBytes = 0;
    task.totalBytes = 0;
    task.cancelled = false;
    delete task.error;
    delete task.cancelSource;
    delete task.writer;

    if (!downloadQueue.some((t) => t.id === task.id)) downloadQueue.push(task);
    count++;
  }
  if (count > 0) {
    saveDownloadTasks();
    pumpQueue();
  }
  sendToRenderer('download-queue-changed', {});
  return count;
}

// ===== 下载分发 =====
async function executeDownload(task) {
  if (task.type === 'hongguo') {
    await executeHongguoDownload(task);
    return;
  }
  throw new Error('未知任务类型: ' + task.type);
}

// ===== 红果短剧下载 =====
async function executeHongguoDownload(task) {
  const { id, hongguoInfo, filename } = task;
  const { vid, series_title, vid_index } = hongguoInfo || {};

  try {
    console.log(`[Hongguo] 开始下载《${series_title}》第${vid_index}集:`, vid);
    task.status = 'downloading';
    task.progress = 0;
    sendToRenderer('download-progress', { id, progress: 0, receivedBytes: 0, totalBytes: 0 });

    // 1. 获取播放直链与 spade_a 加密信息（官网兜底时 spadeA 为空，直链为明文 MP4）
    const playInfo = await hongguo.fetchPlayUrlSingle(vid, hongguoInfo && hongguoInfo.series_id);
    if (!playInfo || !playInfo.url) {
      throw new Error('未获取到有效播放地址');
    }

    // 2. 下载目录
    const settings = getCurrentSettings();
    const root = (settings.root && String(settings.root).trim()) ? String(settings.root).trim() : app.getPath('downloads');
    const seriesFolder = sanitizeFolderName(series_title) || '未命名短剧';
    const downloadDir = task.customDir || path.join(root, '红果短剧', seriesFolder);
    fs.mkdirSync(downloadDir, { recursive: true });

    const finalPath = task.savePath || path.join(downloadDir, filename);
    task.savePath = finalPath;

    // 目标已存在且大小合格，跳过重下
    if (fs.existsSync(finalPath) && fs.statSync(finalPath).size > 1024 * 100) {
      console.log('[Hongguo] 文件已存在，直接完成:', finalPath);
      task.status = 'completed';
      task.progress = 100;
      task.endTime = Date.now();
      saveDownloadTasks();
      sendToRenderer('download-completed', { id, path: finalPath });
      return;
    }

    const tmpPath = finalPath + '.enc.tmp';

    // 3. HTTP 流式下载
    const CancelToken = axios.CancelToken;
    const source = CancelToken.source();
    task.cancelSource = source;

    let headers = { "User-Agent": hongguo.UA };
    let response;
    try {
      response = await axios({
        method: 'GET', url: playInfo.url, responseType: 'stream',
        headers, timeout: 60000, cancelToken: source.token,
      });
    } catch (err) {
      if (err.response && err.response.status === 403) {
        headers["Referer"] = hongguo.VIDEO_REFERER;
        response = await axios({
          method: 'GET', url: playInfo.url, responseType: 'stream',
          headers, timeout: 60000, cancelToken: source.token,
        });
      } else {
        throw err;
      }
    }

    const totalLength = parseInt(response.headers['content-length'], 10) || 0;
    task.totalBytes = totalLength;

    const writer = fs.createWriteStream(tmpPath);
    task.writer = writer;

    let received = 0;
    response.data.on('data', (chunk) => {
      received += chunk.length;
      task.receivedBytes = received;
      const progress = totalLength ? Math.floor((received / totalLength) * 100) : 0;
      task.progress = progress;
      sendToRenderer('download-progress', { id, progress, receivedBytes: received, totalBytes: totalLength });
    });

    response.data.pipe(writer);
    await new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });

    delete task.cancelSource;
    delete task.writer;

    if (task.cancelled) {
      if (fs.existsSync(tmpPath)) try { fs.unlinkSync(tmpPath); } catch (_) {}
      task.status = 'stopped';
      task.endTime = Date.now();
      saveDownloadTasks();
      sendToRenderer('download-stopped', { id });
      return;
    }

    // 4. CENC-AES-CTR 解密
    if (playInfo.spadeA) {
      console.log('[Hongguo] 正在派生 AES Key 并解密 MP4...');
      const key = hongguo.deriveKey(playInfo.spadeA);
      if (!key) {
        throw new Error('Key 派生失败');
      }
      hongguo.decryptMp4File(tmpPath, finalPath, key);
      try { fs.unlinkSync(tmpPath); } catch (_) {}
    } else {
      fs.renameSync(tmpPath, finalPath);
    }

    task.status = 'completed';
    task.progress = 100;
    task.endTime = Date.now();
    saveDownloadTasks();

    console.log('[Hongguo] 下载完成:', finalPath);
    sendToRenderer('download-completed', { id, path: finalPath });
  } catch (error) {
    console.error('[Hongguo] 下载失败:', error.message);
    delete task.cancelSource;
    delete task.writer;
    task.status = 'failed';
    task.error = error.message;
    saveDownloadTasks();
    sendToRenderer('download-failed', { id, error: error.message });
  }
}

// 向渲染进程发送事件
function sendToRenderer(channel, payload) {
  if (mainWindow && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

// ===== IPC：红果解析与批量下载 =====
ipcMain.handle('hongguo-resolve', async (event, input) => {
  try {
    const seriesId = await hongguo.resolveSeriesId(input);
    const data = await hongguo.fetchEpisodeList(seriesId);
    upsertSeriesRegistry(data);
    return { success: true, data };
  } catch (error) {
    console.error('[Hongguo] 解析失败:', error.message);
    return { success: false, error: error.message };
  }
});

// ===== 搜索：内嵌浏览器嗅探 hongguoduanju.com =====
const SEARCH_SITE = 'https://hongguoduanju.com';
const SEARCH_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const SEARCH_TIMEOUT_MS = 15000;

let searchWindow = null;
let searchWindowReady = null;

function getSearchWindow() {
  if (searchWindow && !searchWindow.isDestroyed()) return searchWindow;
  searchWindow = new BrowserWindow({
    width: 1100,
    height: 820,
    show: false,
    title: '搜索 - 红果短剧',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  // 站内跳转保持在同一个窗口内，避免弹出新窗口
  searchWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(SEARCH_SITE)) {
      searchWindow.loadURL(url);
    }
    return { action: 'deny' };
  });
  searchWindow.on('closed', () => {
    searchWindow = null;
    searchWindowReady = null;
  });
  return searchWindow;
}

/**
 * 通用卡片提取脚本（分类页 / 搜索页共用）。
 * 只依赖链接里的 series_id（不依赖 hash 类名），剧名优先取 img[alt]，
 * 这样站点改版时更不容易失效。
 */
const SNIFFER_JS = `(() => {
  const out = [];
  const seen = new Set();
  const links = Array.from(document.querySelectorAll('a')).filter((a) =>
    /series_id=\\d{6,}/.test(a.getAttribute('href') || '')
  );
  for (const a of links) {
    const m = (a.getAttribute('href') || '').match(/series_id=(\\d{6,})/);
    if (!m) continue;
    const sid = m[1];
    if (seen.has(sid)) continue;
    seen.add(sid);

    const img = a.querySelector('img');
    let title = (img && img.getAttribute('alt')) || '';
    if (!title) {
      const t = a.querySelector('[class*="title"]');
      title = (t ? t.textContent : a.textContent || '').trim();
    }

    // 封面：优先 picture>source[srcset]（分类页用 picture），兜底 img[src]
    let cover = '';
    const pic = a.querySelector('picture');
    if (pic) {
      const src = pic.querySelector('source[srcset]');
      if (src) cover = (src.getAttribute('srcset') || '').split(' ')[0];
    }
    if (!cover && img) cover = img.getAttribute('src') || img.getAttribute('data-src') || '';

    // 总集数：「全86集」
    let episode_count = 0;
    const epEl = a.querySelector('[class*="episode"]');
    if (epEl) {
      const em = (epEl.textContent || '').match(/(\\d+)\\s*集/);
      if (em) episode_count = parseInt(em[1], 10);
    }

    // 标签
    const tags = Array.from(a.querySelectorAll('[class*="tag-text"]'))
      .map((e) => (e.textContent || '').trim())
      .filter(Boolean)
      .slice(0, 4);

    out.push({
      series_id: sid,
      series_title: title.trim(),
      cover: cover,
      episode_count: episode_count,
      tags: tags,
    });
  }
  return JSON.stringify(out);
})()`;

/**
 * 分类页附加信息：分页元数据 + 可用的题材筛选项。
 * 题材从页面里的 /category/<cat>/<genre> 链接提取，避免硬编码。
 */
const BROWSE_META_JS = `(() => {
  const out = { page: 1, totalPages: 0, total: 0, genres: [] };

  // 1) 优先读页面内嵌的分页数据
  try {
    const html = document.documentElement.innerHTML;
    const m = html.match(/"pagination":\\s*\\{[^}]*"total":(\\d+)[^}]*"pageNum":(\\d+)[^}]*"pageSize":(\\d+)[^}]*"totalPages":(\\d+)/);
    if (m) {
      out.total = parseInt(m[1], 10);
      out.page = parseInt(m[2], 10);
      out.totalPages = parseInt(m[4], 10);
    }
  } catch (e) {}

  // 2) 兜底：从分页链接推算总页数
  if (!out.totalPages) {
    let maxPage = 0;
    document.querySelectorAll('a[href*="page="]').forEach((a) => {
      const m = (a.getAttribute('href') || '').match(/[?&]page=(\\d+)/);
      if (m) maxPage = Math.max(maxPage, parseInt(m[1], 10));
    });
    out.totalPages = maxPage;
  }

  // 3) 题材筛选项：/category/<cat>/<genre>
  const seen = new Set();
  document.querySelectorAll('a[href*="/category/"]').forEach((a) => {
    const href = a.getAttribute('href') || '';
    const m = href.match(/\\/category\\/[a-z0-9\\-]+\\/([a-z0-9\\-]+)/);
    if (!m) return;
    const slug = m[1];
    const label = (a.textContent || '').trim();
    if (!label || label.length > 8 || seen.has(slug)) return;
    seen.add(slug);
    out.genres.push({ slug: slug, label: label });
  });

  return JSON.stringify(out);
})()`;

/** 页面结构与搜索页一致，分类页复用同一个嗅探 + 串行队列 */
async function runSniffOnUrl(url, label) {
  const win = getSearchWindow();

  // 同一窗口串行执行，避免并发导航互相打断
  const task = async () => {
    console.log(`[${label}] 打开:`, url);
    try {
      await win.loadURL(url, { userAgent: SEARCH_UA });
    } catch (e) {
      // loadURL 在页面内有重定向/中断时也可能 reject，这里继续尝试读取 DOM
      console.warn(`[${label}] loadURL 返回异常（继续尝试读取）:`, e.message);
    }

    const deadline = Date.now() + SEARCH_TIMEOUT_MS;
    let last = [];
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 400));
      try {
        const raw = await win.webContents.executeJavaScript(SNIFFER_JS, true);
        last = JSON.parse(raw || '[]');
      } catch (e) {
        last = [];
      }
      if (last.length > 0) break;
    }

    let meta = { page: 1, totalPages: 0, total: 0, genres: [] };
    try {
      meta = JSON.parse((await win.webContents.executeJavaScript(BROWSE_META_JS, true)) || '{}');
    } catch (_) {}

    if (!last.length) {
      // 兜底：把页面标题带回去，便于用户判断是「无结果」还是「被拦」
      let pageTitle = '';
      try {
        pageTitle = await win.webContents.executeJavaScript('document.title', true);
      } catch (_) {}
      return { success: true, results: [], pageTitle, meta };
    }

    const results = last
      .filter((r) => r.series_id && r.series_title)
      .map((r) => ({
        ...r,
        url: `${SEARCH_SITE}/detail?series_id=${r.series_id}`,
      }));

    console.log(`[${label}] 命中 ${results.length} 部`);
    return { success: true, results, meta };
  };

  // 串行化
  const prev = searchWindowReady || Promise.resolve();
  const next = prev.then(task, task);
  searchWindowReady = next.catch(() => {});
  return next;
}

async function runSearchSniff(keyword) {
  return runSniffOnUrl(`${SEARCH_SITE}/search/${encodeURIComponent(keyword)}`, 'Search');
}

// ===== 浏览：分类页（含题材筛选与分页）=====
const BROWSE_CATEGORIES = [
  { slug: 'real-drama', label: '真人剧' },
  { slug: 'comic-drama', label: '漫剧' },
  { slug: 'ai-drama', label: 'AI剧' },
  { slug: 'comic', label: '漫画' },
];

ipcMain.handle('browse-categories', async () => BROWSE_CATEGORIES);

ipcMain.handle('browse-list', async (event, options) => {
  try {
    const { category = 'real-drama', genre = '', page = 1 } = options || {};
    const cat = String(category).replace(/[^a-z0-9-]/gi, '') || 'real-drama';
    const gen = String(genre).replace(/[^a-z0-9-]/gi, '');
    const pg = Math.max(1, parseInt(page, 10) || 1);

    let url = `${SEARCH_SITE}/category/${cat}`;
    if (gen) url += `/${gen}`;
    if (pg > 1) url += `?page=${pg}`;

    const res = await runSniffOnUrl(url, 'Browse');
    if (!res.success) return res;
    return {
      success: true,
      results: res.results,
      page: (res.meta && res.meta.page) || pg,
      totalPages: (res.meta && res.meta.totalPages) || 0,
      total: (res.meta && res.meta.total) || 0,
      genres: (res.meta && res.meta.genres) || [],
      pageTitle: res.pageTitle || '',
    };
  } catch (error) {
    console.error('[Browse] 失败:', error.message);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('search-series', async (event, keyword) => {
  const kw = String(keyword || '').trim();
  if (!kw) return { success: false, error: '请输入搜索关键词' };
  try {
    return await runSearchSniff(kw);
  } catch (error) {
    console.error('[Search] 失败:', error.message);
    return { success: false, error: error.message };
  }
});

// 搜索选中某部剧后，拉取完整分集并登记档案
ipcMain.handle('search-resolve', async (event, seriesId) => {
  try {
    if (!seriesId) return { success: false, error: '缺少 series_id' };
    const data = await hongguo.fetchEpisodeList(String(seriesId));
    upsertSeriesRegistry(data);
    return { success: true, data };
  } catch (error) {
    console.error('[Search] 拉取分集失败:', error.message);
    return { success: false, error: error.message };
  }
});

// 搜索窗口可见性（超时兜底：让用户自己操作）
ipcMain.handle('search-window-show', async (event, visible) => {
  const win = getSearchWindow();
  if (visible) {
    win.show();
    win.focus();
  } else {
    win.hide();
  }
  return { success: true };
});

// 已登记的短剧档案（不含被用户移除的）
ipcMain.handle('get-series-list', async () => visibleSeries());

/** 从列表移除一部短剧（只取消登记，不删本地文件） */
ipcMain.handle('remove-series', async (event, seriesId) => {
  const sid = String(seriesId);
  const entry = seriesRegistry.find((s) => String(s.series_id) === sid);
  if (!entry) return { success: false, error: '未找到该剧' };
  entry.dismissed = true;
  saveSeriesRegistry();
  return { success: true };
});

/** 批量移除没有下载过任何一集的短剧（清理浏览时留下的空档案） */
ipcMain.handle('purge-empty-series', async () => {
  let removed = 0;
  for (const s of seriesRegistry) {
    if (s.dismissed) continue;
    // 注意：必须同时检查「任务记录」和「磁盘上真实存在的文件」。
    // 只看任务记录会误判——任务记录可能被清空或跨会话缺失，而文件还在。
    const sid = String(s.series_id);
    const hasTaskFile = downloadTasks.some(
      (t) => t.hongguoInfo && String(t.hongguoInfo.series_id) === sid &&
        t.savePath && fs.existsSync(t.savePath) && fs.statSync(t.savePath).size > 1024 * 100
    );
    let hasDiskFile = false;
    if (!hasTaskFile) {
      try {
        hasDiskFile = seriesFilePaths(sid).some(
          (p) => fs.existsSync(p) && fs.statSync(p).size > 1024 * 100
        );
      } catch (_) {}
    }
    if (!hasTaskFile && !hasDiskFile) {
      s.dismissed = true;
      removed++;
    }
  }
  if (removed > 0) saveSeriesRegistry();
  return { success: true, count: removed };
});

/**
 * 从磁盘补回下载任务记录。
 * 用于任务记录丢失/被清空、或早期版本直接下载没登记的情况——
 * 只要磁盘上有文件且剧集档案里有对应集号，就重新登记为「已完成」。
 */
function rescanDownloadsFromDisk() {
  let added = 0;
  for (const s of seriesRegistry) {
    const sid = String(s.series_id);
    let scanned;
    try {
      scanned = collectSeriesEpisodeFiles(sid, s.series_title);
    } catch (_) {
      continue;
    }
    if (!scanned.dir || !scanned.ordered.length) continue;

    const existing = new Set(
      downloadTasks
        .filter((t) => t.hongguoInfo && String(t.hongguoInfo.series_id) === sid)
        .map((t) => Number(t.hongguoInfo.vid_index))
    );

    for (const f of scanned.ordered) {
      if (existing.has(f.vid_index)) continue;
      const ep = (s.episodes || []).find((e) => Number(e.vid_index) === f.vid_index);
      let size = 0;
      try { size = fs.statSync(f.path).size; } catch (_) {}
      downloadTasks.unshift({
        id: 'rescanned_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 6),
        batchId: 'rescanned',
        savePath: f.path,
        customDir: scanned.dir,
        filename: f.filename,
        title: `《${s.series_title}》第${String(f.vid_index).padStart(3, '0')}集`,
        platform: 'hongguo',
        type: 'hongguo',
        status: 'completed',
        progress: 100,
        receivedBytes: size,
        totalBytes: size,
        startTime: Date.now(),
        videoInfo: {
          author: s.series_title,
          title: `《${s.series_title}》第${String(f.vid_index).padStart(3, '0')}集`,
          cover: s.cover || '',
          aweme_id: ep ? ep.vid : '',
        },
        hongguoInfo: {
          vid: ep ? ep.vid : '',
          series_id: sid,
          series_title: s.series_title,
          vid_index: f.vid_index,
          ep_title: ep ? ep.title : '',
        },
      });
      existing.add(f.vid_index);
      added++;
    }
  }
  if (added > 0) saveDownloadTasks();
  console.log(`[Rescan] 从磁盘补回 ${added} 条下载记录`);
  return { success: true, count: added };
}

ipcMain.handle('rescan-downloads', async () => {
  try {
    return rescanDownloadsFromDisk();
  } catch (error) {
    console.error('[Rescan] 失败:', error.message);
    return { success: false, error: error.message };
  }
});

/** 恢复显示被移除的短剧 */
ipcMain.handle('restore-dismissed-series', async () => {
  let n = 0;
  for (const s of seriesRegistry) {
    if (s.dismissed) { s.dismissed = false; n++; }
  }
  if (n > 0) saveSeriesRegistry();
  return { success: true, count: n };
});

ipcMain.handle('dismissed-count', async () => seriesRegistry.filter((s) => s.dismissed).length);

// ===== 一键合并（ffmpeg concat 流复制，无损且快）=====
let mergeTasks = []; // { id, seriesId, seriesTitle, status, progress, output, total, done, error }

function resolveFfmpeg(name) {
  const candidates = [
    // 打包后：resources/bin（extraResources 不解压进 asar，exe 才能执行）
    process.resourcesPath ? path.join(process.resourcesPath, 'bin', `${name}.exe`) : null,
    // 开发态：仓库内 build/ffmpeg
    path.join(__dirname, 'build', 'ffmpeg', `${name}.exe`),
    // 系统 PATH
    name,
  ];
  for (const c of candidates) {
    if (!c) continue;
    if (c === name) return c; // 交给 PATH 解析
    try {
      if (fs.existsSync(c)) return c;
    } catch (_) {}
  }
  // 兜底：扫 winget 安装目录
  try {
    const base = path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Packages');
    if (base && fs.existsSync(base)) {
      for (const d of fs.readdirSync(base)) {
        if (!/ffmpeg/i.test(d)) continue;
        const exe = path.join(base, d);
        const found = findFileRecursive(exe, `${name}.exe`, 6);
        if (found) return found;
      }
    }
  } catch (_) {}
  return null;
}

function findFileRecursive(dir, fileName, depth) {
  if (depth < 0) return null;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (_) {
    return null;
  }
  for (const e of entries) {
    if (e.isFile() && e.name.toLowerCase() === fileName.toLowerCase()) return path.join(dir, e.name);
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const r = findFileRecursive(path.join(dir, e.name), fileName, depth - 1);
    if (r) return r;
  }
  return null;
}

function probeDuration(ffprobePath, file) {
  return new Promise((resolve) => {
    const { execFile } = require('child_process');
    execFile(ffprobePath, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file],
      { timeout: 30000 },
      (err, stdout) => {
        if (err) return resolve(0);
        const d = parseFloat(String(stdout).trim());
        resolve(Number.isFinite(d) ? d : 0);
      });
  });
}

function probeVideoInfo(ffprobePath, file) {
  return new Promise((resolve) => {
    const { execFile } = require('child_process');
    execFile(
      ffprobePath,
      ['-v', 'error', '-select_streams', 'v:0',
       '-show_entries', 'stream=codec_name,width,height', '-of', 'json', file],
      { timeout: 30000 },
      (err, stdout) => {
        if (err) return resolve(null);
        try {
          const j = JSON.parse(stdout);
          const s = (j.streams || [])[0];
          if (!s) return resolve(null);
          resolve({ codec: s.codec_name, w: s.width, h: s.height });
        } catch (_) {
          resolve(null);
        }
      }
    );
  });
}

ipcMain.handle('get-ffmpeg-status', async () => {
  const ff = resolveFfmpeg('ffmpeg');
  const fp = resolveFfmpeg('ffprobe');
  return { success: true, ffmpeg: ff, ffprobe: fp, available: !!ff && !!fp };
});

// 在文件管理器中定位文件
ipcMain.handle('show-in-folder', async (event, filePath) => {
  try {
    if (!filePath) return { success: false, error: '缺少路径' };
    if (fs.existsSync(filePath)) {
      shell.showItemInFolder(filePath);
      return { success: true };
    }
    const dir = path.dirname(filePath);
    if (fs.existsSync(dir)) {
      await shell.openPath(dir);
      return { success: true };
    }
    return { success: false, error: '路径不存在' };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('get-merge-tasks', async () => mergeTasks.map(({ child, ...rest }) => rest));

/** 找到某剧在磁盘上的目录（优先用任务记录，其次按标题推导） */
function resolveSeriesDir(seriesId, seriesTitle, covers) {
  const fromTask = covers.find((t) => t.customDir && fs.existsSync(t.customDir));
  if (fromTask) return fromTask.customDir;
  const settings = getCurrentSettings();
  const root = (settings.root && String(settings.root).trim()) ? String(settings.root).trim() : app.getPath('downloads');
  const guess = path.join(root, '红果短剧', sanitizeFolderName(seriesTitle) || '未命名短剧');
  return fs.existsSync(guess) ? guess : null;
}

/**
 * 组装合并顺序：只认磁盘上真实存在的文件（任务队列可能因为重复提交、
 * 手动删除、跨会话下载等原因与实际文件不一致）。
 * 有任务记录的按标题模板精确寻址；没有记录的按集号扫描目录兜底。
 */
function collectSeriesEpisodeFiles(seriesId, seriesTitle) {
  const sid = String(seriesId);
  const tasks = downloadTasks.filter(
    (t) => t.hongguoInfo && String(t.hongguoInfo.series_id) === sid && t.savePath
  );
  const dir = resolveSeriesDir(sid, seriesTitle, tasks);

  const byIndex = new Map();
  const exists = (p) => {
    try { return fs.existsSync(p) && fs.statSync(p).size > 1024 * 100; } catch (_) { return false; }
  };

  // 1) 任务记录优先（命名模板可能与默认不同）
  for (const t of tasks) {
    if (!exists(t.savePath)) continue;
    const idx = Number(t.hongguoInfo.vid_index) || 0;
    if (!idx) continue;
    const prev = byIndex.get(idx);
    if (!prev || (t.startTime || 0) > (prev.startTime || 0)) {
      byIndex.set(idx, { vid_index: idx, path: t.savePath, filename: t.filename || path.basename(t.savePath) });
    }
  }

  // 2) 目录扫描兜底：把目录里符合命名规律的剧集文件按集号补进来。
  //    不依赖「已登记的分集」——磁盘上可能存在没有任务记录的孤儿文件
  //    （跨会话下载、任务被清理等），这些同样应该合并进去。
  if (dir) {
    let names = [];
    try { names = fs.readdirSync(dir); } catch (_) {}
    for (const n of names) {
      if (!/\.mp4$/i.test(n) || n.includes('合集')) continue;
      // 形如「剧名 001.mp4」——取文件名末尾的数字作为集号
      const m = n.match(/(\d{1,4})\.mp4$/i);
      if (!m) continue;
      const idx = parseInt(m[1], 10);
      if (!idx || byIndex.has(idx)) continue;
      const full = path.join(dir, n);
      if (exists(full)) byIndex.set(idx, { vid_index: idx, path: full, filename: n });
    }
  }

  return {
    dir,
    ordered: [...byIndex.values()].sort((a, b) => a.vid_index - b.vid_index),
  };
}

ipcMain.handle('merge-series', async (event, seriesId, outputName, options) => {
  try {
    const sid = String(seriesId);
    const entry = seriesRegistry.find((s) => String(s.series_id) === sid);
    const seriesTitle =
      (entry && entry.series_title) ||
      ((downloadTasks.find((t) => t.hongguoInfo && String(t.hongguoInfo.series_id) === sid) || {}).hongguoInfo || {}).series_title ||
      '未命名短剧';
    const entries = (entry && entry.episodes) || [];

    const { dir, ordered } = collectSeriesEpisodeFiles(sid, seriesTitle);
    if (!ordered.length) return { success: false, error: '该剧还没有已下载完成的分集' };

    const ffmpegPath = resolveFfmpeg('ffmpeg');
    const ffprobePath = resolveFfmpeg('ffprobe');
    if (!ffmpegPath) {
      return { success: false, error: '未找到 ffmpeg，无法合并（请重装完整版本）' };
    }

    const outDir = dir || path.dirname(ordered[0].path);
    const baseName = outputName && String(outputName).trim()
      ? sanitizeFolderName(outputName)
      : `${sanitizeFolderName(seriesTitle)}_合集`;
    const output = path.join(outDir, `${baseName}.mp4`);

    if (fs.existsSync(output)) {
      return { success: false, error: `输出文件已存在：${baseName}.mp4，请先删除或换个名字` };
    }

    // 磁盘空间检查（输出约等于各集之和）
    const totalBytes = ordered.reduce((s, e) => s + fs.statSync(e.path).size, 0);
    try {
      const st = fs.statfsSync(outDir);
      const free = st.bavail * st.bsize;
      if (free < totalBytes * 1.1) {
        return {
          success: false,
          error: `磁盘空间不足：需要约 ${(totalBytes / 1073741824).toFixed(1)} GB，可用 ${(free / 1073741824).toFixed(1)} GB`,
        };
      }
    } catch (_) {}

    // 编码一致性抽检（首集 vs 后续抽样）
    let codecWarning = '';
    if (ffprobePath) {
      const first = await probeVideoInfo(ffprobePath, ordered[0].path);
      const sampleIdx = [Math.floor(ordered.length / 2), ordered.length - 1];
      for (const i of sampleIdx) {
        if (i <= 0 || i >= ordered.length) continue;
        const s = await probeVideoInfo(ffprobePath, ordered[i].path);
        if (first && s && (first.codec !== s.codec || first.w !== s.w || first.h !== s.h)) {
          codecWarning = `第 ${ordered[i].vid_index} 集编码与首集不一致（${s.codec} ${s.w}x${s.h} vs ${first.codec} ${first.w}x${first.h}），合并后可能出现花屏`;
          break;
        }
      }
    }

    // 写 concat 列表（UTF-8 无 BOM；绝对路径配 -safe 0，规避中文/空格转义问题）
    const listPath = path.join(outDir, `.${baseName}.ffconcat.txt`);
    const listBody = ordered.map((e) => `file '${e.path.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n');
    fs.writeFileSync(listPath, listBody + '\n', 'utf8');

    // 总时长（用于进度百分比）
    let totalDuration = 0;
    if (ffprobePath) {
      for (const e of ordered) totalDuration += await probeDuration(ffprobePath, e.path);
    }

    const id = 'merge_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
    const task = {
      id,
      seriesId: sid,
      seriesTitle,
      output,
      outputName: `${baseName}.mp4`,
      total: ordered.length,
      done: 0,
      progress: 0,
      status: 'running',
      totalBytes,
      totalDuration,
      codecWarning,
      error: '',
      startTime: Date.now(),
    };
    mergeTasks.unshift(task);
    sendToRenderer('merge-task-added', { ...task });

    const tmpOutput = output + '.part';
    const { spawn } = require('child_process');

    // 兼容格式：转码为 H.264，任何播放器/电脑都能播（慢，但通用）
    let videoArgs;
    if (options && options.compatible) {
      const encoder = await pickH264Encoder(ffmpegPath);
      videoArgs = encoder === 'libx264'
        ? ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-profile:v', 'high', '-level', '4.2']
        : encoder === 'h264_nvenc'
        ? ['-c:v', 'h264_nvenc', '-preset', 'p4', '-cq', '23', '-b:v', '0']
        : encoder === 'h264_qsv'
        ? ['-c:v', 'h264_qsv', '-global_quality', '23']
        : encoder === 'h264_amf'
        ? ['-c:v', 'h264_amf', '-quality', 'speed', '-rc', 'cqp', '-qp_i', '23', '-qp_p', '23']
        : ['-c:v', encoder, '-cq', '23'];
      videoArgs = [...videoArgs, '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k'];
      console.log('[Merge] 兼容格式合并，编码器:', encoder);
    } else {
      videoArgs = ['-c', 'copy'];
    }

    // 注意：.part 扩展名无法让 ffmpeg 推断封装格式，必须显式 -f mp4
    const args = [
      '-y', '-hide_banner',
      '-f', 'concat', '-safe', '0', '-i', listPath,
      ...videoArgs, '-movflags', '+faststart',
      '-progress', 'pipe:1', '-nostats',
      '-f', 'mp4',
      tmpOutput,
    ];
    console.log('[Merge] 开始合并', ordered.length, '集 ->', output);
    const child = spawn(ffmpegPath, args, { windowsHide: true });
    task.child = child;

    let stdoutBuf = '';
    child.stdout.on('data', (d) => {
      stdoutBuf += d.toString();
      const lines = stdoutBuf.split('\n');
      stdoutBuf = lines.pop() || '';
      for (const line of lines) {
        const m = line.match(/^out_time_us=(\d+)/);
        if (m && totalDuration > 0) {
          const sec = parseInt(m[1], 10) / 1e6;
          const pct = Math.max(0, Math.min(99, Math.floor((sec / totalDuration) * 100)));
          if (pct !== task.progress) {
            task.progress = pct;
            sendToRenderer('merge-progress', { id, progress: pct });
          }
        }
      }
    });

    let stderrTail = '';
    child.stderr.on('data', (d) => {
      stderrTail = (stderrTail + d.toString()).slice(-1200);
    });

    child.on('error', (err) => {
      task.status = 'failed';
      task.error = '无法启动 ffmpeg: ' + err.message;
      saveMergeTasks();
      sendToRenderer('merge-failed', { id, error: task.error });
    });

    child.on('close', (code) => {
      try { fs.unlinkSync(listPath); } catch (_) {}
      delete task.child;
      if (task.cancelled) {
        try { fs.existsSync(tmpOutput) && fs.unlinkSync(tmpOutput); } catch (_) {}
        task.status = 'stopped';
        task.error = '已取消';
      } else if (code === 0 && fs.existsSync(tmpOutput)) {
        try {
          fs.renameSync(tmpOutput, output);
          const size = fs.statSync(output).size;
          task.status = 'completed';
          task.progress = 100;
          task.done = ordered.length;
          task.outputBytes = size;
          console.log('[Merge] 完成:', output, (size / 1048576).toFixed(1) + 'MB');
          // 输出校验：确认能被正常解析（避免产出坏文件却报成功）
          if (ffprobePath) {
            probeVideoInfo(ffprobePath, output).then((info) => {
              if (!info) {
                task.error = '输出文件无法被解析，可能已损坏';
                task.status = 'failed';
                saveMergeTasks();
                sendToRenderer('merge-failed', { id, error: task.error });
              } else {
                task.verified = `${info.codec} ${info.w}x${info.h}`;
                saveMergeTasks();
                sendToRenderer('merge-completed', { id, path: output, verified: task.verified });
              }
            });
            return; // 校验后再发完成事件
          }
        } catch (e) {
          task.status = 'failed';
          task.error = '重命名输出失败: ' + e.message;
        }
      } else {
        task.status = 'failed';
        task.error = `ffmpeg 退出码 ${code}${stderrTail ? '：' + stderrTail.split('\n').filter(Boolean).slice(-2).join(' ') : ''}`;
        try { fs.existsSync(tmpOutput) && fs.unlinkSync(tmpOutput); } catch (_) {}
      }
      saveMergeTasks();
      if (task.status === 'completed') {
        sendToRenderer('merge-completed', { id, path: output, error: '' });
      } else {
        sendToRenderer('merge-failed', { id, path: output, error: task.error });
      }
    });

    return {
      success: true,
      id,
      output,
      outputName: `${baseName}.mp4`,
      count: ordered.length,
      totalBytes,
      totalDuration,
      codecWarning,
    };
  } catch (error) {
    console.error('[Merge] 失败:', error.message);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('cancel-merge', async (event, id) => {
  const t = mergeTasks.find((m) => m.id === id);
  if (!t) return { success: false, error: '任务不存在' };
  t.cancelled = true;
  if (t.child) {
    try { t.child.kill(); } catch (_) {}
  }
  return { success: true };
});

ipcMain.handle('delete-merge-task', async (event, id) => {
  mergeTasks = mergeTasks.filter((m) => m.id !== id);
  saveMergeTasks();
  return { success: true };
});

function saveMergeTasks() {
  try {
    store.saveMergeTasks(mergeTasks.map(({ child, ...rest }) => rest));
  } catch (_) {}
}

function loadMergeTasks() {
  try {
    mergeTasks = (store.getMergeTasks() || []).map((t) => {
      // 上次未跑完的合并任务标记为中断
      if (t.status === 'running') return { ...t, status: 'stopped', error: '应用关闭时中断' };
      return t;
    });
  } catch (_) {
    mergeTasks = [];
  }
}

/**
 * 播放页数据源：把「短剧档案」与「下载任务」合并成每集的可播放状态。
 * 判定可播的规则与下载跳过逻辑一致：文件存在且 > 100KB。
 * 由于解密文件是「先写 .enc.tmp、成功后改名 .mp4」，因此不会读到半成品。
 */
ipcMain.handle('get-series-episodes', async (event, seriesId) => {
  try {
    const sid = String(seriesId);
    const entry = seriesRegistry.find((s) => String(s.series_id) === sid);
    const tasks = downloadTasks.filter((t) => t.hongguoInfo && String(t.hongguoInfo.series_id) === sid);

    // 一集只保留一个任务（同 vid 重复提交时取最新的）
    const taskByIndex = new Map();
    for (const t of tasks) {
      const idx = Number(t.hongguoInfo.vid_index);
      const prev = taskByIndex.get(idx);
      if (!prev || (t.startTime || 0) > (prev.startTime || 0)) taskByIndex.set(idx, t);
    }

    const baseEpisodes =
      entry && entry.episodes.length
        ? entry.episodes
        : tasks.map((t) => ({
            vid: t.hongguoInfo.vid,
            vid_index: t.hongguoInfo.vid_index,
            title: t.hongguoInfo.ep_title || '',
          }));

    // 目录兜底：磁盘上可能存在没有任务记录的「孤儿」文件
    // （任务被清理、跨会话下载等），仅靠任务判断会把它们误报成「未下载」。
    const seriesTitle = (entry && entry.series_title) ||
      (tasks[0] && tasks[0].hongguoInfo.series_title) || '未命名短剧';
    let scannedByIndex = new Map();
    let seriesDir = null;
    try {
      const scanned = collectSeriesEpisodeFiles(sid, seriesTitle);
      seriesDir = scanned.dir;
      for (const e of scanned.ordered) scannedByIndex.set(Number(e.vid_index), e);
    } catch (_) {}

    const episodes = baseEpisodes
      .map((ep) => {
        const idx = Number(ep.vid_index);
        const t = taskByIndex.get(idx);
        let status = 'missing';
        let fileUrl = null;
        let progress = 0;
        let fileSize = 0;
        let savePath = null;

        if (t && t.savePath) {
          savePath = t.savePath;
          if (fs.existsSync(t.savePath)) {
            fileSize = fs.statSync(t.savePath).size;
          }
          if (fileSize > 1024 * 100) {
            status = 'completed';
            fileUrl = localPlayUrl(t.savePath);
          } else if (t.status === 'downloading') {
            status = 'downloading';
            progress = t.progress || 0;
          } else if (t.status === 'pending') {
            status = 'pending';
          } else {
            status = t.status; // failed / stopped
          }
        }

        // 任务缺失（或该任务没有可用文件）时，用磁盘扫描结果兜底
        if (status === 'missing') {
          const f = scannedByIndex.get(idx);
          if (f) {
            savePath = f.path;
            fileUrl = localPlayUrl(f.path);
            try { fileSize = fs.statSync(f.path).size; } catch (_) {}
            status = 'completed';
          }
        }

        return {
          vid: ep.vid,
          vid_index: idx,
          title: ep.title || '',
          taskId: t ? t.id : null,
          status,
          progress,
          fileSize,
          fileUrl,
          savePath,
        };
      })
      .sort((a, b) => a.vid_index - b.vid_index);

    const completedCount = episodes.filter((e) => e.status === 'completed').length;
    return {
      success: true,
      data: {
        series_id: sid,
        series_title: seriesTitle,
        cover: (entry && entry.cover) || '',
        seriesDir,
        total: episodes.length,
        completedCount,
        episodes,
      },
    };
  } catch (error) {
    console.error('[Player] 读取分集失败:', error.message);
    return { success: false, error: error.message };
  }
});

// 断点续播
ipcMain.handle('save-playback-position', async (event, seriesId, vidIndex, currentTime) => {  try {
    const map = store.getPlayback() || {};
    map[String(seriesId)] = {
      vid_index: Number(vidIndex) || 1,
      currentTime: Number(currentTime) || 0,
      updatedAt: Date.now(),
    };
    store.savePlayback(map);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-playback-position', async (event, seriesId) => {
  const map = store.getPlayback() || {};
  return map[String(seriesId)] || null;
});

/**
 * 从「浏览」页点播：切到播放页并选中该剧。
 * 主进程只负责发导航指令，具体的剧集状态由渲染层拉取，避免重复维护一份数据。
 */
ipcMain.handle('play-series', async (event, payload) => {
  const { seriesId, vidIndex } = payload || {};
  sendToRenderer('navigate', {
    page: 'player',
    payload: { seriesId: seriesId ? String(seriesId) : '', vidIndex: Number(vidIndex) || 0 },
  });
  return { success: true };
});

// ===== 在线播放 =====

/** 注册流协议：按 Range 从内存缓存供给播放器 */
function registerStreamProtocol() {
  protocol.handle(STREAM_SCHEME, async (request) => {
    try {
      const url = new URL(request.url);
      const vid = decodeURIComponent(url.pathname.replace(/^\/+/, '')) || url.hostname;
      const entry = onlineCache.get(vid);
      if (!entry) {
        return new Response('not ready', { status: 404, headers: { 'Content-Type': 'text/plain' } });
      }
      entry.lastUsed = Date.now();

      const buf = entry.buffer;
      const size = buf.length;
      const range = request.headers.get('range');

      if (range) {
        const m = /bytes=(\d*)-(\d*)/.exec(range);
        let start = m && m[1] ? parseInt(m[1], 10) : 0;
        let end = m && m[2] ? parseInt(m[2], 10) : size - 1;
        if (end >= size) end = size - 1;
        if (start > end || start >= size) start = 0;
        const chunk = buf.subarray(start, end + 1);
        return new Response(chunk, {
          status: 206,
          headers: {
            'Content-Type': 'video/mp4',
            'Accept-Ranges': 'bytes',
            'Content-Range': `bytes ${start}-${end}/${size}`,
            'Content-Length': String(end - start + 1),
          },
        });
      }

      return new Response(buf, {
        status: 200,
        headers: {
          'Content-Type': 'video/mp4',
          'Accept-Ranges': 'bytes',
          'Content-Length': String(size),
        },
      });
    } catch (e) {
      console.error('[Stream] 供给失败:', e.message);
      return new Response('error', { status: 500 });
    }
  });
}

/** 把本地文件路径转成可被渲染进程播放的 URL */
function localPlayUrl(filePath) {
  if (!filePath) return null;
  const p = path.resolve(String(filePath));
  return `${LOCAL_SCHEME}://f/${Buffer.from(p, 'utf8').toString('base64url')}`;
}

/**
 * 注册本地文件播放协议。
 * 改由主进程用 Node 读文件供给，而不是让 Chromium 读 file://：
 * 开发模式下渲染页面来自 http://localhost:5173，Chromium 会以
 * 「Not allowed to load local resource」拒绝 file:// 请求（表现为播放器黑屏、进度 0:00）。
 * 走自定义协议后开发/打包两种模式行为一致，并且支持 Range 拖动进度。
 */
function registerLocalProtocol() {
  protocol.handle(LOCAL_SCHEME, async (request) => {
    try {
      const url = new URL(request.url);
      const b64 = url.pathname.replace(/^\/+/, '');
      const filePath = Buffer.from(b64, 'base64url').toString('utf8');
      if (!filePath) {
        return new Response('bad path', { status: 400, headers: { 'Content-Type': 'text/plain' } });
      }
      // 只允许取视频文件，避免该协议被用来读取任意本地文件
      if (!/\.(mp4|m4v|mov|webm)$/i.test(filePath)) {
        return new Response('forbidden', { status: 403, headers: { 'Content-Type': 'text/plain' } });
      }

      let size = 0;
      try {
        size = (await fsp.stat(filePath)).size;
      } catch (_) {
        console.warn('[Local] 文件不存在:', filePath);
        return new Response('not found', { status: 404, headers: { 'Content-Type': 'text/plain' } });
      }

      const range = request.headers.get('range');
      if (range) {
        const m = /bytes=(\d*)-(\d*)/.exec(range);
        let start = m && m[1] ? parseInt(m[1], 10) : 0;
        let end = m && m[2] ? parseInt(m[2], 10) : size - 1;
        if (Number.isNaN(start) || start < 0) start = 0;
        if (Number.isNaN(end) || end >= size) end = size - 1;
        if (start > end) start = 0;
        return new Response(fs.createReadStream(filePath, { start, end }), {
          status: 206,
          headers: {
            'Content-Type': 'video/mp4',
            'Accept-Ranges': 'bytes',
            'Content-Range': `bytes ${start}-${end}/${size}`,
            'Content-Length': String(end - start + 1),
          },
        });
      }

      return new Response(fs.createReadStream(filePath), {
        status: 200,
        headers: {
          'Content-Type': 'video/mp4',
          'Accept-Ranges': 'bytes',
          'Content-Length': String(size),
        },
      });
    } catch (e) {
      console.error('[Local] 读取失败:', e.message);
      return new Response('error', { status: 500, headers: { 'Content-Type': 'text/plain' } });
    }
  });
}

/** 下载整集到内存并解密（官网兜底时直链为明文 MP4，跳过解密） */
async function fetchDecryptedEpisode(vid, onProgress, seriesId) {
  const playInfo = await hongguo.fetchPlayUrlSingle(vid, seriesId);
  if (!playInfo || !playInfo.url) throw new Error('未获取到有效播放地址');

  let headers = { 'User-Agent': hongguo.UA };
  let response;
  try {
    response = await axios({
      method: 'GET', url: playInfo.url, responseType: 'stream', headers, timeout: 90000,
    });
  } catch (err) {
    if (err.response && err.response.status === 403) {
      headers.Referer = hongguo.VIDEO_REFERER;
      response = await axios({
        method: 'GET', url: playInfo.url, responseType: 'stream', headers, timeout: 90000,
      });
    } else {
      throw err;
    }
  }

  const total = parseInt(response.headers['content-length'], 10) || 0;
  const chunks = [];
  let received = 0;
  await new Promise((resolve, reject) => {
    response.data.on('data', (c) => {
      chunks.push(c);
      received += c.length;
      if (onProgress) onProgress(received, total);
    });
    response.data.on('end', resolve);
    response.data.on('error', reject);
  });

  let buf = Buffer.concat(chunks);
  if (playInfo.spadeA) {
    if (onProgress) onProgress(buf.length, buf.length, 'decrypting');
    const key = hongguo.deriveKey(playInfo.spadeA);
    if (!key) throw new Error('密钥派生失败');
    buf = hongguo.decryptMp4Buffer(buf, key);
  }
  return buf;
}

/**
 * 准备在线播放：下载+解密到内存，返回可交给 <video> 的流地址。
 * 同一集重复请求会复用进行中的任务。
 */
ipcMain.handle('prepare-online-play', async (event, payload) => {
  try {
    const { vid, seriesId, vidIndex } = payload || {};
    if (!vid) return { success: false, error: '缺少 vid' };
    const key = String(vid);

    // 已在缓存
    if (onlineCache.has(key)) {
      const e = onlineCache.get(key);
      e.lastUsed = Date.now();
      return {
        success: true,
        url: `${STREAM_SCHEME}://play/${encodeURIComponent(key)}`,
        size: e.size,
        cached: true,
      };
    }

    // 去重
    if (onlinePreparing.has(key)) {
      const buf = await onlinePreparing.get(key);
      return {
        success: true,
        url: `${STREAM_SCHEME}://play/${encodeURIComponent(key)}`,
        size: buf.length,
        cached: true,
      };
    }

    const task = (async () => {
      console.log('[Online] 开始缓存第', vidIndex, '集:', key);
      const buf = await fetchDecryptedEpisode(key, (received, total, phase) => {
        sendToRenderer('online-play-progress', {
          vid: key, seriesId, vidIndex,
          received, total,
          percent: total ? Math.floor((received / total) * 100) : 0,
          phase: phase || 'downloading',
        });
      }, seriesId);
      onlineCache.set(key, {
        buffer: buf,
        size: buf.length,
        lastUsed: Date.now(),
        seriesId: seriesId ? String(seriesId) : '',
        vidIndex: Number(vidIndex) || 0,
      });
      trimOnlineCache();
      console.log('[Online] 缓存完成 第', vidIndex, '集', (buf.length / 1048576).toFixed(1) + 'MB',
        '当前内存占用', (onlineCacheTotal() / 1048576).toFixed(1) + 'MB');
      return buf;
    })();

    onlinePreparing.set(key, task);
    try {
      const buf = await task;
      return {
        success: true,
        url: `${STREAM_SCHEME}://play/${encodeURIComponent(key)}`,
        size: buf.length,
      };
    } finally {
      onlinePreparing.delete(key);
    }
  } catch (error) {
    console.error('[Online] 准备失败:', error.message);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('online-cache-status', async () => {
  const items = [...onlineCache.entries()].map(([vid, e]) => ({
    vid, size: e.size, vidIndex: e.vidIndex, seriesId: e.seriesId,
  }));
  return { success: true, count: items.length, bytes: onlineCacheTotal(), items };
});

ipcMain.handle('clear-online-cache', async () => {
  clearOnlineCache();
  return { success: true };
});

// ===== 兼容模式：把 HEVC 转成 H.264，解决「黑屏有声」=====
const COMPAT_MAX_BYTES = 4 * 1024 * 1024 * 1024; // 转码缓存上限
let compatDir = null;
let compatEncoder = null; // 探测到的最优 H.264 编码器

function getCompatDir() {
  if (!compatDir) {
    compatDir = path.join(app.getPath('userData'), 'compat-cache');
    try { fs.mkdirSync(compatDir, { recursive: true }); } catch (_) {}
  }
  return compatDir;
}

function compatFileName(seriesId, vidIndex) {
  return `${sanitizeFolderName(String(seriesId))}_${String(vidIndex).padStart(3, '0')}.mp4`;
}

function compatPathFor(seriesId, vidIndex) {
  return path.join(getCompatDir(), compatFileName(seriesId, vidIndex));
}

function compatCacheStatus() {
  const dir = getCompatDir();
  let files = 0;
  let bytes = 0;
  try {
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.mp4')) continue;
      try { bytes += fs.statSync(path.join(dir, f)).size; files++; } catch (_) {}
    }
  } catch (_) {}
  return { dir, files, bytes };
}

function trimCompatCache() {
  const dir = getCompatDir();
  let entries = [];
  try {
    entries = fs.readdirSync(dir)
      .filter((f) => f.endsWith('.mp4'))
      .map((f) => {
        const p = path.join(dir, f);
        const st = fs.statSync(p);
        return { p, size: st.size, at: st.atimeMs || st.mtimeMs };
      });
  } catch (_) { return; }
  let total = entries.reduce((s, e) => s + e.size, 0);
  if (total <= COMPAT_MAX_BYTES) return;
  entries.sort((a, b) => a.at - b.at); // 最早访问的先删
  for (const e of entries) {
    if (total <= COMPAT_MAX_BYTES) break;
    try { fs.unlinkSync(e.p); total -= e.size; } catch (_) {}
  }
}

/** 探测可用的 H.264 编码器：先看列表，再实际试编一帧（列表里有不代表能用，如无 N 卡时的 nvenc） */
async function pickH264Encoder(ffmpegPath) {
  if (compatEncoder) return compatEncoder;
  const { execFile } = require('child_process');

  const list = await new Promise((resolve) => {
    execFile(ffmpegPath, ['-hide_banner', '-encoders'], { timeout: 20000 }, (err, stdout) => {
      resolve(String(stdout || ''));
    });
  });

  const candidates = ['h264_nvenc', 'h264_qsv', 'h264_amf', 'h264_mf', 'libx264'].filter((e) =>
    list.includes(e)
  );
  if (!candidates.includes('libx264')) candidates.push('libx264'); // 软件兜底

  const works = (enc) =>
    new Promise((resolve) => {
      execFile(
        ffmpegPath,
        ['-hide_banner', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=64x64:d=0.1',
         '-frames:v', '1', '-c:v', enc, '-f', 'null', '-'],
        { timeout: 25000 },
        (err) => resolve(!err)
      );
    });

  for (const enc of candidates) {
    if (await works(enc)) {
      compatEncoder = enc;
      break;
    }
    console.log('[Compat] 编码器不可用，跳过:', enc);
  }
  if (!compatEncoder) compatEncoder = 'libx264';
  console.log('[Compat] 使用编码器:', compatEncoder);
  return compatEncoder;
}

/**
 * 转码为 H.264/AAC。
 * 返回 { success, path, size, elapsed }
 */
ipcMain.handle('transcode-for-playback', async (event, payload) => {
  try {
    const { seriesId, vidIndex, filePath, force } = payload || {};
    if (!seriesId || vidIndex == null) return { success: false, error: '缺少剧集信息' };

    const out = compatPathFor(seriesId, vidIndex);
    if (!force && fs.existsSync(out) && fs.statSync(out).size > 1024 * 100) {
      // 命中缓存
      try { fs.utimesSync(out, new Date(), new Date()); } catch (_) {}
      return { success: true, url: localPlayUrl(out), size: fs.statSync(out).size, cached: true };
    }

    const ffmpegPath = resolveFfmpeg('ffmpeg');
    const ffprobePath = resolveFfmpeg('ffprobe');
    if (!ffmpegPath) return { success: false, error: '未找到 ffmpeg，无法转码' };

    // 1) 解析输入文件：优先本地已下载；否则先取在线缓存并落临时文件
    let inputPath = filePath || null;
    let tmpInput = null;
    if (!inputPath || !fs.existsSync(inputPath)) {
      const vid = payload.vid;
      if (!vid) return { success: false, error: '既没有本地文件，也没有 vid' };
      let buf = onlineCache.has(String(vid)) ? onlineCache.get(String(vid)).buffer : null;
      if (!buf) {
        buf = await fetchDecryptedEpisode(String(vid), () => {});
      }
      tmpInput = path.join(getCompatDir(), `.tmp_${vid}.mp4`);
      fs.writeFileSync(tmpInput, buf);
      inputPath = tmpInput;
    }

    const duration = ffprobePath ? await probeDuration(ffprobePath, inputPath) : 0;
    const encoder = await pickH264Encoder(ffmpegPath);

    // 2) 转码（硬件编码器用各自推荐的参数）
    const encArgs = encoder === 'libx264'
      ? ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-profile:v', 'high', '-level', '4.2']
      : encoder === 'h264_nvenc'
      ? ['-c:v', 'h264_nvenc', '-preset', 'p4', '-cq', '23', '-b:v', '0']
      : encoder === 'h264_qsv'
      ? ['-c:v', 'h264_qsv', '-global_quality', '23']
      : encoder === 'h264_amf'
      ? ['-c:v', 'h264_amf', '-quality', 'speed', '-rc', 'cqp', '-qp_i', '23', '-qp_p', '23']
      : ['-c:v', encoder, '-cq', '23'];

    const tmpOut = out + '.part';
    try { fs.existsSync(tmpOut) && fs.unlinkSync(tmpOut); } catch (_) {}

    const { spawn } = require('child_process');
    const args = [
      '-y', '-hide_banner', '-i', inputPath,
      ...encArgs,
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '128k',
      '-movflags', '+faststart',
      '-progress', 'pipe:1', '-nostats',
      '-f', 'mp4', tmpOut,
    ];

    console.log(`[Compat] 转码 第${vidIndex}集  编码器=${encoder}  时长=${duration.toFixed(0)}s`);
    const started = Date.now();
    let stderrTail = '';
    const code = await new Promise((resolve) => {
      const child = spawn(ffmpegPath, args, { windowsHide: true });
      let buf = '';
      child.stdout.on('data', (d) => {
        buf += d.toString();
        const lines = buf.split('\n');
        buf = lines.pop() || '';
        for (const line of lines) {
          const m = line.match(/^out_time_us=(\d+)/);
          if (m && duration > 0) {
            const sec = parseInt(m[1], 10) / 1e6;
            const pct = Math.max(0, Math.min(99, Math.floor((sec / duration) * 100)));
            sendToRenderer('transcode-progress', { seriesId: String(seriesId), vidIndex: Number(vidIndex), percent: pct });
          }
        }
      });
      child.stderr.on('data', (d) => { stderrTail = (stderrTail + d.toString()).slice(-1500); });
      child.on('error', (e) => { stderrTail += ' | spawn: ' + e.message; resolve(-1); });
      child.on('close', (c) => resolve(c));
    });

    if (tmpInput) { try { fs.unlinkSync(tmpInput); } catch (_) {} }

    if (code !== 0 || !fs.existsSync(tmpOut)) {
      try { fs.existsSync(tmpOut) && fs.unlinkSync(tmpOut); } catch (_) {}
      const tail = stderrTail.split('\n').filter(Boolean).slice(-2).join(' ').slice(0, 300);
      console.warn('[Compat] 转码失败 code=', code, tail);
      return { success: false, error: `转码失败（ffmpeg 退出码 ${code}）${tail ? '：' + tail : ''}` };
    }

    fs.renameSync(tmpOut, out);
    trimCompatCache();
    const size = fs.statSync(out).size;
    const elapsed = ((Date.now() - started) / 1000).toFixed(1);
    console.log(`[Compat] 完成 ${(size / 1048576).toFixed(1)}MB  用时 ${elapsed}s`);

    sendToRenderer('transcode-progress', { seriesId: String(seriesId), vidIndex: Number(vidIndex), percent: 100, done: true });
    return { success: true, url: localPlayUrl(out), size, elapsed: Number(elapsed), encoder };
  } catch (error) {
    console.error('[Compat] 转码失败:', error.message);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('compat-cache-status', async () => {
  const st = compatCacheStatus();
  return { success: true, ...st, maxBytes: COMPAT_MAX_BYTES };
});

ipcMain.handle('clear-compat-cache', async () => {
  const dir = getCompatDir();
  let freed = 0;
  let count = 0;
  try {
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.mp4')) continue;
      const p = path.join(dir, f);
      try { freed += fs.statSync(p).size; fs.unlinkSync(p); count++; } catch (_) {}
    }
  } catch (_) {}
  return { success: true, count, freed };
});

/** 报告本机是否能解码 HEVC（供界面提前提示） */
ipcMain.handle('decode-capability', async () => ({
  ffmpegEncoder: compatEncoder || null,
  compatDir: getCompatDir(),
}));



/**
 * 把若干集加入下载队列（批量下载与播放器「下载本集」共用）。
 * 返回新建的任务数。
 */
function enqueueEpisodes({ seriesId, seriesTitle, episodes, cover }) {
  if (!Array.isArray(episodes) || episodes.length === 0) return 0;

  const settings = getCurrentSettings();
  const root = (settings.root && String(settings.root).trim()) ? String(settings.root).trim() : app.getPath('downloads');
  const cleanSeriesTitle = sanitizeFolderName(seriesTitle) || '红果短剧';
  const downloadDir = path.join(root, '红果短剧', cleanSeriesTitle);
  try { fs.mkdirSync(downloadDir, { recursive: true }); } catch (_) {}

  const batchId = 'hongguobatch_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
  const firstCover = cover || (episodes[0] && episodes[0].cover) || '';

  const batchInfo = {
    batchId,
    platform: 'hongguo',
    nickname: `《${cleanSeriesTitle}》`,
    avatar: firstCover,
    totalCount: episodes.length,
    createTime: Date.now(),
  };

  let created = 0;
  for (const ep of episodes) {
    const epIndexStr = String(ep.vid_index).padStart(3, '0');
    const namePart = renderName(settings.name_format, cleanSeriesTitle, ep.vid_index, ep.title);
    const baseName = namePart || `${cleanSeriesTitle}_第${epIndexStr}集`;
    const filename = `${baseName}.mp4`;
    const finalPath = path.join(downloadDir, filename);

    // 已有同一集在队列/已完成，避免重复建任务
    const dup = downloadTasks.find(
      (t) => t.hongguoInfo && String(t.hongguoInfo.vid) === String(ep.vid) && t.status !== 'failed'
    );
    if (dup) {
      // 已停止或失败的重新入队
      if (dup.status === 'stopped') {
        dup.status = 'pending';
        dup.cancelled = false;
        delete dup.error;
        if (!downloadQueue.some((t) => t.id === dup.id)) downloadQueue.push(dup);
        created++;
      }
      continue;
    }

    const task = {
      id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
      batchId,
      batchInfo,
      savePath: finalPath,
      customDir: downloadDir,
      title: `《${cleanSeriesTitle}》第${epIndexStr}集${ep.title ? ' ' + ep.title : ''}`,
      filename,
      platform: 'hongguo',
      type: 'hongguo',
      status: 'pending',
      progress: 0,
      receivedBytes: 0,
      totalBytes: 0,
      startTime: Date.now(),
      videoInfo: {
        author: cleanSeriesTitle,
        title: `《${cleanSeriesTitle}》第${epIndexStr}集`,
        cover: ep.cover || firstCover,
        aweme_id: ep.vid,
      },
      hongguoInfo: {
        vid: ep.vid,
        series_id: seriesId,
        series_title: cleanSeriesTitle,
        vid_index: ep.vid_index,
        ep_title: ep.title,
      },
    };

    downloadTasks.unshift(task);
    downloadQueue.push(task);
    sendToRenderer('download-task-added', task);
    created++;
  }

  saveDownloadTasks();
  pumpQueue();
  return created;
}

ipcMain.handle('hongguo-download-batch', async (event, payload) => {
  try {
    const { seriesId, seriesTitle, episodes } = payload || {};
    if (!Array.isArray(episodes) || episodes.length === 0) {
      return { success: false, error: '未选择集数' };
    }
    const count = enqueueEpisodes({ seriesId, seriesTitle, episodes });
    return { success: true, count, requested: episodes.length };
  } catch (error) {
    console.error('[Hongguo] 提交批量下载失败:', error.message);
    return { success: false, error: error.message };
  }
});

// 播放器里「下载本集」：按 series_id + vid_index 补单集
ipcMain.handle('download-single-episode', async (event, seriesId, vidIndex) => {
  try {
    const entry = seriesRegistry.find((s) => String(s.series_id) === String(seriesId));
    if (!entry) return { success: false, error: '未找到该剧档案，请先解析一次' };
    const ep = entry.episodes.find((e) => Number(e.vid_index) === Number(vidIndex));
    if (!ep) return { success: false, error: '未找到该集' };
    const count = enqueueEpisodes({
      seriesId: entry.series_id,
      seriesTitle: entry.series_title,
      episodes: [{ ...ep, cover: entry.cover }],
      cover: entry.cover,
    });
    return { success: true, count };
  } catch (error) {
    console.error('[Player] 下载单集失败:', error.message);
    return { success: false, error: error.message };
  }
});

// ===== IPC：设置 =====
ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
  if (result.canceled) return null;
  return result.filePaths[0];
});

ipcMain.handle('get-settings', async () => getCurrentSettings());

ipcMain.handle('save-settings', async (event, settings) => {
  try {
    const merged = { ...getDefaultSettings(), ...(settings || {}) };
    store.saveSettings(merged);
    getCurrentSettings(); // 刷新并发数
    await applyProxySettings(merged); // 立即生效，无需重启
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// ===== IPC：网络代理 =====
ipcMain.handle('get-proxy-status', async () => {
  const settings = getCurrentSettings();
  const resolved = resolveProxyConfig(settings);
  return {
    enabled: settings.proxy_enabled === true,
    mode: resolved.mode,
    url: resolved.url,
    effective: resolved.mode !== 'direct',
  };
});

// 用当前表单值实测代理是否连通（未保存也能测）
ipcMain.handle('test-proxy', async (event, draft) => {
  const settings = { ...getCurrentSettings(), ...(draft || {}) };
  const resolved = resolveProxyConfig(settings);
  if (resolved.mode === 'custom' && !resolved.url) {
    return { success: false, error: '请填写完整的代理地址与端口' };
  }

  // 按当前配置构造 axios 选项：custom 显式指定，system 交给环境变量，direct 关闭
  let proxyOption;
  if (resolved.mode === 'direct') {
    proxyOption = false;
  } else if (resolved.mode === 'custom') {
    proxyOption = { protocol: 'http', host: settings.proxy_host, port: parseInt(settings.proxy_port, 10) };
    if (settings.proxy_username) {
      proxyOption.auth = { username: settings.proxy_username, password: settings.proxy_password || '' };
    }
  } else {
    proxyOption = null; // 交给 proxy-from-env 读环境变量
  }

  const started = Date.now();
  try {
    const res = await axios.get('https://www.baidu.com', {
      timeout: 12000,
      proxy: proxyOption,
      headers: { 'User-Agent': 'Mozilla/5.0' },
      validateStatus: () => true,
    });
    const ms = Date.now() - started;
    if (res.status >= 200 && res.status < 400) {
      return {
        success: true,
        elapsed: ms,
        mode: resolved.mode,
        via: resolved.url || '(系统/环境变量代理)',
        message: `连通正常（HTTP ${res.status}，耗时 ${ms}ms）`,
      };
    }
    return { success: false, error: `请求返回 HTTP ${res.status}（耗时 ${ms}ms）` };
  } catch (error) {
    const ms = Date.now() - started;
    const code = (error && error.code) || '';
    let hint = error.message || '未知错误';
    if (code === 'ECONNREFUSED') hint = '代理端口拒绝连接，请确认代理软件已启动、端口填写正确';
    else if (code === 'ETIMEDOUT' || code === 'ECONNABORTED') hint = '连接超时，请检查代理地址/端口或代理是否可用';
    else if (code === 'ENOTFOUND') hint = '无法解析代理地址，请检查主机名';
    else if (/407/.test(hint)) hint = '代理需要认证，请填写用户名与密码';
    return { success: false, error: `${hint}（耗时 ${ms}ms）`, code };
  }
});

// ===== IPC：下载管理 =====
ipcMain.handle('get-download-tasks', () => {
  const STATUS_ORDER = {
    downloading: 0,
    pending: 1,
    failed: 2,
    stopped: 3,
    completed: 4,
  };
  const sorted = downloadTasks.slice().sort((a, b) => {
    const wa = STATUS_ORDER[a.status] ?? 99;
    const wb = STATUS_ORDER[b.status] ?? 99;
    if (wa !== wb) return wa - wb;
    if (wa <= 1) {
      return (a.hongguoInfo?.vid_index || 0) - (b.hongguoInfo?.vid_index || 0) || (a.startTime || 0) - (b.startTime || 0);
    }
    return (b.endTime || b.startTime || 0) - (a.endTime || a.startTime || 0);
  });
  return sorted.map((task) => {
    const { cancelSource, writer, ...serializableTask } = task;
    return serializableTask;
  });
});


// ===== 文件清理（删除已下载的本地文件）=====

/** 删除单个任务对应的本地文件（.mp4 及可能残留的 .enc.tmp），返回释放的字节数 */
function removeTaskFile(task) {
  if (!task || !task.savePath) return 0;
  let freed = 0;
  for (const p of [task.savePath, task.savePath + '.enc.tmp']) {
    try {
      if (fs.existsSync(p)) {
        const st = fs.statSync(p);
        fs.unlinkSync(p);
        freed += st.size;
      }
    } catch (e) {
      console.warn('[Clean] 删除失败:', p, e.message);
    }
  }
  return freed;
}

/** 删掉一组任务记录（从内存与队列中移除） */
function dropTaskRecords(ids) {
  const set = new Set(ids);
  downloadTasks = downloadTasks.filter((t) => !set.has(t.id));
  downloadQueue = downloadQueue.filter((t) => !set.has(t.id));
  saveDownloadTasks();
}

/** 某个 seriesId 下，磁盘上实际存在的文件（含没有任务记录的孤儿文件） */
function seriesFilePaths(seriesId) {
  const sid = String(seriesId);
  const entry = seriesRegistry.find((s) => String(s.series_id) === sid);
  const paths = new Set();
  try {
    const { ordered } = collectSeriesEpisodeFiles(sid, entry ? entry.series_title : '');
    for (const o of ordered) paths.add(o.path);
  } catch (_) {}
  for (const t of downloadTasks) {
    if (t.hongguoInfo && String(t.hongguoInfo.series_id) === sid && t.savePath) paths.add(t.savePath);
  }
  return [...paths];
}

ipcMain.handle('delete-task', async (event, taskId, options) => {
  const deleteFiles = !!(options && options.deleteFiles);
  const taskIndex = downloadTasks.findIndex((t) => t.id === taskId);
  if (taskIndex === -1) return { success: false, error: '任务不存在' };

  const task = downloadTasks[taskIndex];
  if (task.status === 'downloading') {
    task.cancelled = true;
    if (task.cancelSource) {
      try { task.cancelSource.cancel('用户删除任务'); } catch (_) {}
    }
    if (task.writer) {
      try { task.writer.end(); } catch (_) {}
    }
  }

  let freed = 0;
  if (deleteFiles) freed = removeTaskFile(task);

  downloadTasks.splice(taskIndex, 1);
  // 从队列移除
  const qIndex = downloadQueue.findIndex((t) => t.id === taskId);
  if (qIndex !== -1) downloadQueue.splice(qIndex, 1);

  saveDownloadTasks();
  return { success: true, freed };
});

ipcMain.handle('delete-tasks', async (event, taskIds, options) => {
  if (!Array.isArray(taskIds) || taskIds.length === 0) return { success: false, error: '没有要删除的任务' };
  const deleteFiles = !!(options && options.deleteFiles);
  let freed = 0;
  for (const id of taskIds) {
    const t = downloadTasks.find((x) => x.id === id);
    if (deleteFiles && t) freed += removeTaskFile(t);
    deleteOneTask(id);
  }
  saveDownloadTasks();
  return { success: true, count: taskIds.length, freed };
});

async function deleteOneTask(taskId) {
  const taskIndex = downloadTasks.findIndex((t) => t.id === taskId);
  if (taskIndex === -1) return;
  const task = downloadTasks[taskIndex];
  if (task.status === 'downloading') {
    task.cancelled = true;
    if (task.cancelSource) { try { task.cancelSource.cancel('用户删除任务'); } catch (_) {} }
    if (task.writer) { try { task.writer.end(); } catch (_) {} }
  }
  downloadTasks.splice(taskIndex, 1);
  const qIndex = downloadQueue.findIndex((t) => t.id === taskId);
  if (qIndex !== -1) downloadQueue.splice(qIndex, 1);
}

/**
 * 删除某一部剧的全部本地文件（含合并产物），并清理对应任务记录。
 * 剧集档案保留（仍能看到分集、可在线播放），只是变成「未下载」。
 */
ipcMain.handle('delete-series-files', async (event, seriesId, options) => {
  try {
    const sid = String(seriesId);
    const includeMerged = !(options && options.includeMerged === false);
    const entry = seriesRegistry.find((s) => String(s.series_id) === sid);
    const title = (entry && entry.series_title) || '';

    const paths = seriesFilePaths(sid);
    let count = 0;
    let freed = 0;
    let failed = 0;

    for (const p of paths) {
      try {
        if (fs.existsSync(p)) {
          freed += fs.statSync(p).size;
          fs.unlinkSync(p);
          count++;
        }
      } catch (e) {
        failed++;
        console.warn('[Clean] 删除失败:', p, e.message);
      }
      // 顺带清掉可能残留的临时文件
      try {
        const tmp = p + '.enc.tmp';
        if (fs.existsSync(tmp)) { freed += fs.statSync(tmp).size; fs.unlinkSync(tmp); }
      } catch (_) {}
    }

    // 合并产物（合集.mp4）与残留的 concat 列表
    const dir = (() => {
      try {
        const c = collectSeriesEpisodeFiles(sid, title);
        if (c.dir) return c.dir;
      } catch (_) {}
      return null;
    })();
    if (dir && fs.existsSync(dir)) {
      let names = [];
      try { names = fs.readdirSync(dir); } catch (_) {}
      for (const f of names) {
        const isMerged = includeMerged && f.endsWith('.mp4') && f.includes('合集');
        const isList = f.endsWith('.ffconcat.txt');
        if (!isMerged && !isList) continue;
        try {
          const p = path.join(dir, f);
          const st = fs.statSync(p);
          fs.unlinkSync(p);
          freed += st.size;
          count++;
        } catch (_) {}
      }
      // 目录空了就一并删掉
      try {
        if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
      } catch (_) {}
    }

    // 清理任务记录与在线缓存
    const ids = downloadTasks
      .filter((t) => t.hongguoInfo && String(t.hongguoInfo.series_id) === sid)
      .map((t) => t.id);
    if (ids.length) dropTaskRecords(ids);
    for (const [vid, e] of [...onlineCache]) {
      if (String(e.seriesId) === sid) onlineCache.delete(vid);
    }

    console.log(`[Clean] 删除《${title}》本地文件 ${count} 个，释放 ${(freed / 1048576).toFixed(1)}MB`);
    return { success: true, count, freed, failed };
  } catch (error) {
    console.error('[Clean] 删除剧集文件失败:', error.message);
    return { success: false, error: error.message };
  }
});

/** 删除单集本地文件（看完即删用） */
ipcMain.handle('delete-episode-file', async (event, seriesId, vidIndex) => {
  try {
    const sid = String(seriesId);
    const idx = Number(vidIndex);
    const paths = seriesFilePaths(sid).filter((p) => {
      const m = p.match(/(\d{1,4})\.mp4$/i);
      return m && parseInt(m[1], 10) === idx;
    });
    let freed = 0;
    let count = 0;
    for (const p of paths) {
      try {
        if (fs.existsSync(p)) { freed += fs.statSync(p).size; fs.unlinkSync(p); count++; }
      } catch (_) {}
    }
    const ids = downloadTasks
      .filter((t) => t.hongguoInfo && String(t.hongguoInfo.series_id) === sid && Number(t.hongguoInfo.vid_index) === idx)
      .map((t) => t.id);
    if (ids.length) dropTaskRecords(ids);
    return { success: true, count, freed };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

/** 各处磁盘占用统计（用于展示「可释放多少」） */
ipcMain.handle('get-storage-usage', async () => {
  try {
    const series = [];
    let totalBytes = 0;
    let totalFiles = 0;
    for (const s of seriesRegistry) {
      if (s.dismissed) continue;
      const paths = seriesFilePaths(s.series_id);
      let bytes = 0;
      let files = 0;
      for (const p of paths) {
        try {
          if (fs.existsSync(p)) { bytes += fs.statSync(p).size; files++; }
        } catch (_) {}
      }
      // 合并产物
      let merged = 0;
      let mergedBytes = 0;
      try {
        const c = collectSeriesEpisodeFiles(s.series_id, s.series_title);
        if (c.dir && fs.existsSync(c.dir)) {
          for (const f of fs.readdirSync(c.dir)) {
            if (f.endsWith('.mp4') && f.includes('合集')) {
              mergedBytes += fs.statSync(path.join(c.dir, f)).size;
              merged++;
            }
          }
        }
      } catch (_) {}
      bytes += mergedBytes;
      files += merged;
      totalBytes += bytes;
      totalFiles += files;
      series.push({
        series_id: String(s.series_id),
        series_title: s.series_title,
        total: (s.episodes || []).length,
        files,
        bytes,
        merged,
      });
    }
    series.sort((a, b) => b.bytes - a.bytes);
    return { success: true, totalBytes, totalFiles, series };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

/** 删除所有已下载的本地文件（剧集档案保留，之后仍可在线看） */
ipcMain.handle('delete-all-downloaded', async () => {
  try {
    let freed = 0;
    let count = 0;
    const targets = seriesRegistry.filter((s) => !s.dismissed).map((s) => s.series_id);
    for (const sid of targets) {
      const paths = seriesFilePaths(sid);
      for (const p of paths) {
        try {
          if (fs.existsSync(p)) { freed += fs.statSync(p).size; fs.unlinkSync(p); count++; }
        } catch (_) {}
      }
      try {
        const c = collectSeriesEpisodeFiles(sid, '');
        if (c.dir && fs.existsSync(c.dir)) {
          for (const f of fs.readdirSync(c.dir)) {
            if (f.endsWith('.mp4') && f.includes('合集')) {
              const p = path.join(c.dir, f);
              freed += fs.statSync(p).size; fs.unlinkSync(p); count++;
            }
          }
        }
      } catch (_) {}
    }
    // 记录全部清掉，并清空在线缓存
    dropTaskRecords(downloadTasks.map((t) => t.id));
    clearOnlineCache();
    return { success: true, count, freed };
  } catch (error) {
    return { success: false, error: error.message };
  }
});


ipcMain.handle('stop-download', async (event, taskId) => {
  const task = downloadTasks.find((t) => t.id === taskId);
  if (!task) return { success: false, error: '任务不存在' };

  task.cancelled = true;
  if (task.cancelSource) { try { task.cancelSource.cancel('用户停止下载'); } catch (_) {} }
  if (task.writer) { try { task.writer.end(); } catch (_) {} }

  task.status = 'stopped';
  task.error = '';
  task.endTime = Date.now();
  delete task.cancelSource;
  delete task.writer;

  saveDownloadTasks();
  sendToRenderer('download-stopped', { id: taskId, path: task.savePath });
  return { success: true };
});

ipcMain.handle('retry-task', async (event, taskId) => {
  const task = downloadTasks.find((t) => t.id === taskId);
  if (!task) return { success: false, error: '任务不存在' };

  if (task.savePath && fs.existsSync(task.savePath)) {
    try { fs.unlinkSync(task.savePath); } catch (_) {}
  }

  task.status = 'pending';
  task.progress = 0;
  task.receivedBytes = 0;
  task.totalBytes = 0;
  task.cancelled = false;
  delete task.error;
  delete task.cancelSource;
  delete task.writer;

  if (!downloadQueue.some((t) => t.id === taskId)) downloadQueue.push(task);
  saveDownloadTasks();
  processDownloadQueue();
  return { success: true };
});

ipcMain.handle('retry-tasks', async (event, taskIds) => {
  if (!Array.isArray(taskIds) || taskIds.length === 0) return { success: false, error: '没有要重试的任务' };
  let count = 0;
  for (const taskId of taskIds) {
    const task = downloadTasks.find((t) => t.id === taskId);
    if (task && (task.status === 'failed' || task.status === 'stopped')) {
      if (task.savePath && fs.existsSync(task.savePath)) {
        try { fs.unlinkSync(task.savePath); } catch (_) {}
      }
      task.status = 'pending';
      task.progress = 0;
      task.receivedBytes = 0;
      task.totalBytes = 0;
      task.cancelled = false;
      delete task.error;
      delete task.cancelSource;
      delete task.writer;
      if (!downloadQueue.some((t) => t.id === taskId)) downloadQueue.push(task);
      count++;
    }
  }
  if (count > 0) {
    saveDownloadTasks();
    processDownloadQueue();
  }
  return { success: true, count };
});

// ===== IPC：一键启动 / 一键暂停 =====
ipcMain.handle('pause-all', async () => ({ success: true, count: pauseAllTasks() }));

ipcMain.handle('resume-all', async () => ({ success: true, count: resumeAllTasks() }));

// 队列实时状态（供界面显示「进行中 x/并发上限」）
ipcMain.handle('get-queue-status', async () => ({
  active: activeDownloads,
  queued: downloadQueue.length,
  maxConcurrent: MAX_CONCURRENT_DOWNLOADS,
}));

ipcMain.handle('open-folder', async (event, taskId) => {
  const task = downloadTasks.find((t) => t.id === taskId);
  if (!task) return { success: false, error: '任务不存在' };

  if (task.customDir && fs.existsSync(task.customDir)) {
    await shell.openPath(task.customDir);
    return { success: true };
  }
  if (task.savePath && fs.existsSync(task.savePath)) {
    const isDir = fs.statSync(task.savePath).isDirectory();
    if (isDir) {
      await shell.openPath(task.savePath);
    } else {
      shell.showItemInFolder(task.savePath);
    }
    return { success: true };
  }
  if (task.savePath) {
    const parentDir = path.dirname(task.savePath);
    if (fs.existsSync(parentDir)) {
      await shell.openPath(parentDir);
      return { success: true };
    }
  }
  return { success: false, error: '文件夹不存在' };
});

// ===== 应用信息 =====
ipcMain.handle('get-app-info', async () => ({
  version: APP_VERSION,
  brand: APP_TITLE,
  appName: '红果短剧下载器',
}));

// 打开外部链接（保留给需要时调用）
ipcMain.handle('open-external-url', async (event, url) => {
  if (!url) return { success: false, error: '缺少链接' };
  try {
    await shell.openExternal(url);
    return { success: true };
  } catch (err) {
    console.error('[Shell] 打开链接失败:', err.message);
    return { success: false, error: err.message };
  }
});

// ===== 窗口创建 =====
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 900,
    minHeight: 620,
    title: APP_TITLE,
    autoHideMenuBar: true,
    backgroundColor: '#f5f6fa',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.setMenuBarVisibility(false);

  // 开发模式加载 vite dev server，生产模式加载打包产物
  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    mainWindow.loadURL(devUrl);
  } else {
    mainWindow.loadFile(path.join(__dirname, 'dist-react', 'index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ===== 应用生命周期 =====
app.whenReady().then(async () => {
  const dataFile = path.join(app.getPath('userData'), 'data.json');
  store.init(dataFile);
  loadDownloadTasks();
  loadSeriesRegistry();
  rebuildSeriesRegistryFromTasks();
  // 任务记录可能缺失（被清空/跨会话），从磁盘补回，保证下载列表与文件一致
  try { rescanDownloadsFromDisk(); } catch (e) { console.warn('[Rescan] 启动补登记失败:', e.message); }
  loadMergeTasks();
  registerStreamProtocol();
  registerLocalProtocol();
  const settings = getCurrentSettings();

  // 代理必须在创建窗口、发起任何请求之前生效
  await applyProxySettings(settings);

  // 启动后自动接着跑「等待中」的任务（上次未下完的队列），无需手动点启动
  const resumed = enqueuePendingTasks();
  if (resumed > 0) {
    console.log(`[Queue] 启动自动续跑 ${resumed} 个等待中任务，并发 ${MAX_CONCURRENT_DOWNLOADS}`);
    pumpQueue();
  }

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
