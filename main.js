/**
 * main.js - tiến trình chính của trình tải phim ngắn Hongguo (bản độc lập)
 *
 * Chức năng:
 *   1. Phân tích phim ngắn Hongguo (link chia sẻ / series_id -> danh sách toàn bộ tập)
 *   2. Gửi hàng loạt tác vụ tải vào hàng đợi tải xuống
 *   3. Tải song song: tải dạng stream từ link phát trực tiếp -> dẫn xuất AES Key từ spade_a -> giải mã CENC-AES-CTR -> xuất mp4
 *   4. Quản lý tải: đẩy tiến độ, tạm dừng/hủy, thử lại, xóa, mở thư mục chứa tệp
 *   5. Cài đặt: thư mục tải, quy tắc đặt tên, số luồng song song (lưu bằng tệp JSON)
 */
const { app, BrowserWindow, ipcMain, dialog, shell, session, protocol } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const axios = require('axios');

const hongguo = require('./src/native/hongguo');
const reelfren = require('./src/native/reelfren');
// Chọn nguồn dữ liệu theo ID: ID của reelfren có tiền tố rf-, còn lại đều là Hongguo
const sourceFor = (id) => (reelfren.owns(id) ? reelfren : hongguo);
const store = require('./src/store');
const APP_VERSION = app.getVersion() || '1.0.0';

// Thư mục userData đi theo productName; bản cũ dùng tên tiếng Trung. Chuyển dữ liệu cũ (cài đặt, lịch sử tải,
// hồ sơ phim) sang tên mới trước khi dùng — đổi tên thất bại thì dùng luôn thư mục cũ để không mất dữ liệu.
const LEGACY_USER_DATA = path.join(app.getPath('appData'), '红果短剧下载器');
if (!fs.existsSync(app.getPath('userData')) && fs.existsSync(LEGACY_USER_DATA)) {
  try {
    fs.renameSync(LEGACY_USER_DATA, app.getPath('userData'));
  } catch (e) {
    app.setPath('userData', LEGACY_USER_DATA);
  }
}

const APP_TITLE = 'Trình tải phim ngắn Hongguo';
const DOWNLOAD_SUBDIR = 'PhimNganHongguo';
// Tên thư mục tải của bản trước (có dấu, có khoảng trắng). Máy đã có thư mục này thì tải tiếp vào đó,
// để các tập của cùng một phim không bị tách làm hai nơi (gộp sẽ thiếu tập)
const LEGACY_DOWNLOAD_SUBDIR = 'Phim ngắn Hongguo';
const downloadSubdir = (root) =>
  !fs.existsSync(path.join(root, DOWNLOAD_SUBDIR)) && fs.existsSync(path.join(root, LEGACY_DOWNLOAD_SUBDIR))
    ? LEGACY_DOWNLOAD_SUBDIR
    : DOWNLOAD_SUBDIR;
const MERGED_SUFFIX = 'Bản gộp';
// Nhận diện tệp đã gộp: tương thích hậu tố tiếng Trung của bản cũ và "Bản gộp" của bản mới (tên tệp trên macOS có thể là NFD, nên chuẩn hóa trước). Giữ nguyên chuỗi tiếng Trung bên dưới để nhận ra tệp gộp từ bản cũ
const isMergedName = (n) => { const s = String(n).normalize('NFC'); return s.includes('合集') || s.includes(MERGED_SUFFIX); };
// Lấy số tập từ cuối tên tệp: tương thích "Tên phim 001.mp4", "X_Tập 001.mp4" và định dạng tiếng Trung của bản cũ ("X_Thứ 001 tập" viết bằng chữ Hán) — giữ nguyên chữ Hán "tập" trong regex
const EP_FILE_RE = /(\d{1,4})(?:\s*集)?\.mp4$/i;

let mainWindow = null;

// ===== Tương thích giải mã video =====
// Video của nền tảng là HEVC(bytevc1), Chromium trên Windows chỉ giải mã được HEVC bằng phần cứng.
// Nếu card đồ họa không hỗ trợ, hoặc bị danh sách đen GPU của Chromium chặn, sẽ xảy ra lỗi "màn hình đen nhưng có tiếng".
// Ở đây chủ động bật giải mã HEVC của nền tảng và nới lỏng danh sách đen, cứu được khá nhiều máy;
// máy nào vẫn không được thì dự phòng bằng "chuyển mã ở chế độ tương thích" (xem transcodeForPlayback).
app.commandLine.appendSwitch('enable-features', 'PlatformHEVCDecoderSupport,PlatformHEVCEncoderSupport');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
// Cho phép cố gắng dùng bộ giải mã của nền tảng kể cả khi không có giải mã phần cứng
app.commandLine.appendSwitch('disable-features', 'UseChromeOSDirectVideoDecoder');


// ===== Phát trực tuyến: giao thức stream tùy chỉnh (bộ nhớ đệm trong RAM + hỗ trợ Range) =====
// Video được mã hóa CENC, không thể đưa thẳng địa chỉ CDN cho <video> phát,
// vì vậy ở đây "tải + giải mã" xong trong bộ nhớ trước, rồi dùng giao thức tùy chỉnh cấp dữ liệu cho trình phát theo Range.
// Lợi ích: không ghi ra đĩa (không chiếm thư mục tải của người dùng), và hỗ trợ tua.
const STREAM_SCHEME = 'hongguo-stream';
// Giao thức phát cho các tệp đã tải về máy.
// Không thể dùng trực tiếp file:// ở chế độ phát triển — trang renderer được tải từ http://localhost:5173,
// Chromium sẽ từ chối với lỗi "Not allowed to load local resource" (biểu hiện: trình phát màn hình đen, 0:00).
// Vì vậy chuyển sang để tiến trình chính đọc tệp bằng Node và cấp qua giao thức tùy chỉnh, có hỗ trợ Range để tua được.
//
// Lưu ý: hai scheme này cố ý không bật bypassCSP — video có tải được hay không do danh sách trắng CSP trong index.html
// quyết định (media-src / connect-src phải liệt kê rõ hongguo-stream: và hongguo-local:).
// Dùng bypassCSP để né CSP của chính mình là bỏ phí một lớp bảo vệ, chỉ che giấu lỗi cấu hình, đừng thêm lại.
const LOCAL_SCHEME = 'hongguo-local';
protocol.registerSchemesAsPrivileged([
  {
    scheme: STREAM_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
  {
    scheme: LOCAL_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
]);

/** vid -> { buffer, size, lastUsed, seriesId, vidIndex } */
const onlineCache = new Map();
const ONLINE_MAX_BYTES = 300 * 1024 * 1024; // Giới hạn bộ nhớ đệm trong RAM
let onlinePreparing = new Map(); // vid -> Promise, tránh tải trùng cùng một tập

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



// ===== Quản lý tác vụ tải =====
let downloadTasks = [];
let downloadQueue = [];
let activeDownloads = 0;
let MAX_CONCURRENT_DOWNLOADS = 3;

// ===== Cài đặt =====
function getDefaultSettings() {
  return {
    root: app.getPath('downloads'),
    // Mẫu đặt tên tệp: biến dùng được Tên phim(series_title) Số tập(vid_index) Tiêu đề(ep_title)
    name_format: 'Tên phim Số tập',
    max_concurrent: 3,
    // Xem xong một tập thì tự xóa tệp trên máy (vừa xem vừa dọn, tránh chiếm ổ đĩa)
    auto_delete_watched: false,
    // Chế độ tương thích: tự chuyển mã sang H.264 khi máy không giải mã được HEVC (khắc phục lỗi "màn hình đen có tiếng")
    compat_mode: true,
    // Tự gộp thành một tệp sau khi mọi tác vụ của một phim tải xong; compatible=chuyển mã sang H.264
    auto_merge: false,
    auto_merge_compatible: false,
    // ===== Proxy mạng =====
    // proxy_enabled: có bật proxy không (khi tắt thì bỏ qua proxy hệ thống, kết nối trực tiếp)
    // proxy_mode:    system=theo hệ thống/biến môi trường · custom=chỉ định thủ công · direct=bắt buộc kết nối trực tiếp
    proxy_enabled: false,
    proxy_mode: 'system',
    proxy_host: '127.0.0.1',
    proxy_port: 7890,
    proxy_username: '',
    proxy_password: '',
  };
}

/**
 * Tính URL proxy đang có hiệu lực.
 * Trả về { mode, url }:
 *   mode='direct'  kết nối trực tiếp
 *   mode='system'  theo hệ thống/biến môi trường (url có thể là proxy lấy từ biến môi trường, dùng để hiển thị)
 *   mode='custom'  chỉ định thủ công
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
    // Chịu lỗi: người dùng có thể dán thẳng http://host:port, thậm chí kèm tài khoản mật khẩu
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
  // system: lấy biến môi trường làm chuẩn
  const envUrl =
    process.env.HTTPS_PROXY || process.env.https_proxy ||
    process.env.HTTP_PROXY || process.env.http_proxy || null;
  return { mode: 'system', url: envUrl };
}

/**
 * Ghi proxy vào biến môi trường, axios sẽ tự đọc (proxy-from-env),
 * nhờ vậy cả việc phân tích API Hongguo lẫn tải video đều đi qua proxy, không cần sửa code nghiệp vụ.
 */
function applyProxyToEnv(resolved) {
  const keys = ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy'];
  for (const k of keys) {
    if (resolved.url) process.env[k] = resolved.url;
    else delete process.env[k];
  }
}

/** Cho các request của chính cửa sổ Electron (như ảnh bìa) cũng đi qua proxy */
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
    console.error('[Proxy] Thiết lập proxy cho cửa sổ thất bại:', e.message);
  }
}

/** Điểm vào chung: gọi khi cài đặt thay đổi hoặc lúc khởi động */
async function applyProxySettings(settings) {
  const resolved = resolveProxyConfig(settings);
  applyProxyToEnv(resolved);
  await applyProxyToSession(resolved);
  console.log(`[Proxy] mode=${resolved.mode} url=${resolved.url || '(kết nối trực tiếp)'}`);
  return resolved;
}

function getCurrentSettings() {
  const saved = store.getSettings() || {};
  const merged = { ...getDefaultSettings(), ...saved };
  // Đảm bảo số luồng song song hợp lệ
  const mc = parseInt(merged.max_concurrent, 10);
  MAX_CONCURRENT_DOWNLOADS = Number.isInteger(mc) && mc >= 1 && mc <= 10 ? mc : 3;
  return { ...merged, max_concurrent: MAX_CONCURRENT_DOWNLOADS };
}

// Làm sạch tên thư mục/tệp (bỏ ký tự không hợp lệ, dấu chấm và khoảng trắng ở cuối)
function sanitizeFolderName(name) {
  return String(name || '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
    .replace(/[. ]+$/g, '')
    .trim()
    .slice(0, 80) || '';
}

// Tạo tên tệp theo mẫu đặt tên, trả về tên (không kèm phần mở rộng) hoặc null
function renderName(format, seriesTitle, vidIndex, epTitle) {
  const fmt = String(format || '').trim();
  if (!fmt) return null;
  const vars = {
    'series_title': String(seriesTitle || '').trim(),
    'vid_index': String(vidIndex).padStart(3, '0'),
    'ep_title': String(epTitle || '').trim(),
  };
  // Thay bí danh thành tên biến tiếng Anh trước, rồi mới thay biến [A-Za-z]+; giữ bí danh tiếng Trung để tương thích mẫu đã lưu từ bản cũ
  const aliasMap = {
    '剧名': 'series_title',
    '集数': 'vid_index',
    '标题': 'ep_title',
    'Tên phim': 'series_title',
    'Số tập': 'vid_index',
    'Tiêu đề': 'ep_title',
  };
  const aliasRe = /剧名|集数|标题|Tên phim|Số tập|Tiêu đề/g;
  let name = fmt.normalize('NFC')
    .replace(aliasRe, (w) => aliasMap[w] || w)
    .replace(/([A-Za-z]+(?:_[A-Za-z]+)*)/g, (tok) => (vars[tok] !== undefined ? (vars[tok] || '') : tok));
  name = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/\s+/g, ' ').trim();
  return name || null;
}

// ===== Tải/lưu tác vụ tải xuống =====
function loadDownloadTasks() {
  const saved = store.getTasks() || [];
  saved.sort((a, b) => (b.startTime || 0) - (a.startTime || 0));
  downloadTasks = saved.map((task) => {
    const inProgress = task.status === 'downloading' || task.status === 'pending';
    return {
      ...task,
      status: inProgress ? 'failed' : task.status,
      error: inProgress ? 'Tác vụ bị gián đoạn do ứng dụng đóng' : task.error,
    };
  });
}

/**
 * Điền bù hồ sơ phim ngắn từ các tác vụ tải đã có.
 * Người dùng có thể đã tải khá nhiều tập trước khi tính năng này ra mắt; không có hồ sơ thì trang phát sẽ không thấy chúng.
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
        series_title: info.series_title || 'Phim chưa đặt tên',
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
        updatedAt: 0, // Mục điền bù xếp sau các mục có từ tìm kiếm/phân tích
        dismissed: false,
      });
      added++;
    } else if (!existing.dismissed && (!existing.episodes || existing.episodes.length < list.length)) {
      // Khi danh sách tập trong hồ sơ chưa đủ, bổ sung bằng những gì gom được từ tác vụ
      existing.episodes = list;
      existing.total = list.length;
      added++;
    }
  }
  if (added > 0) {
    saveSeriesRegistry();
    console.log(`[Series] Đã khôi phục ${added} hồ sơ phim ngắn từ tác vụ tải xuống`);
  }
}

function saveDownloadTasks() {
  const serializable = downloadTasks.map((task) => {
    const { cancelSource, writer, ...rest } = task;
    return rest;
  });
  store.saveTasks(serializable);
}

// ===== Hồ sơ phim ngắn (trang phát dựa vào đây để liệt kê đủ các tập) =====
let seriesRegistry = [];

function loadSeriesRegistry() {
  seriesRegistry = store.getSeries() || [];
}

function saveSeriesRegistry() {
  store.saveSeries(seriesRegistry);
}

/**
 * Đăng ký/cập nhật một phim ngắn. data cần có series_id và episodes.
 * Nếu đã có thì không ghi đè episodes (tránh xóa mất dữ liệu tốt khi API lỗi), chỉ bổ sung tiêu đề và ảnh bìa.
 */
function upsertSeriesRegistry(data) {
  if (!data || !data.series_id || !Array.isArray(data.episodes) || data.episodes.length === 0) return;
  const sid = String(data.series_id);
  const idx = seriesRegistry.findIndex((s) => String(s.series_id) === sid);
  const entry = {
    series_id: sid,
    series_title: data.series_title || 'Phim chưa đặt tên',
    cover: data.cover || '',
    total: data.episodes.length,
    episodes: data.episodes.map((e) => ({
      vid: String(e.vid),
      vid_index: e.vid_index || 0,
      title: e.title || '',
      cover: e.cover || '',
    })),
    updatedAt: Date.now(),
    dismissed: false, // Người dùng đã chủ động gỡ; khi đăng ký lại sẽ tự hiển thị lại
  };
  if (idx === -1) seriesRegistry.unshift(entry);
  else seriesRegistry[idx] = { ...seriesRegistry[idx], ...entry, dismissed: false };
  saveSeriesRegistry();
}

/** Các phim ngắn hiển thị ở trang phát/bộ chọn gộp (lọc bỏ phim người dùng đã gỡ) */
function visibleSeries() {
  return seriesRegistry.filter((s) => !s.dismissed);
}

// ===== Điều phối hàng đợi tải =====
// Ghi chú: ở đây bắt buộc phải "trả về ngay". Bản cài đặt ban đầu viết `await executeDownload(task)`,
// khiến mỗi lần gọi chỉ khởi chạy một tác vụ và bị chặn cho đến khi tác vụ đó xong,
// dẫn đến số luồng song song luôn là 1 (bất kể max_concurrent đặt bao nhiêu).
// Giờ runTask tự gọi lại pumpQueue khi kết thúc, bộ điều phối chỉ lo phân phát theo giới hạn song song.
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
    console.error('[Download Queue] Tải xuống thất bại:', error);
  } finally {
    activeDownloads--;
    pumpQueue();
  }
  maybeAutoMerge(task);
}

// Các series_id đang được tự động gộp (tránh gộp trùng khi nhiều tập xong cùng lúc)
const autoMerging = new Set();

/**
 * Khi mọi tác vụ của một phim đã kết thúc (không còn chờ/đang tải), tự gộp các tập đã tải theo cài đặt.
 * Chỉ gộp khi các tập đã tải liên tiếp (không đứt quãng); nếu không phải cả phim thì tên tệp kèm khoảng số tập.
 */
async function maybeAutoMerge(task) {
  if ((task.status !== 'completed' && task.status !== 'failed') || !task.hongguoInfo) return;
  const settings = getCurrentSettings();
  if (!settings.auto_merge) return;
  const sid = String(task.hongguoInfo.series_id);
  if (autoMerging.has(sid)) return;
  const siblings = downloadTasks.filter((t) => t.hongguoInfo && String(t.hongguoInfo.series_id) === sid);
  if (siblings.some((t) => t.status === 'pending' || t.status === 'downloading')) return;
  if (mergeTasks.some((m) => m.seriesId === sid && m.status === 'running')) return;

  const entry = seriesRegistry.find((s) => String(s.series_id) === sid);
  const title = (entry && entry.series_title) || task.hongguoInfo.series_title || '';
  const { ordered } = collectSeriesEpisodeFiles(sid, title);
  const range = autoMergeRange(ordered.map((e) => e.vid_index), entry ? entry.episodes.length : 0);
  if (!range.ok) {
    console.log('[AutoMerge] Bỏ qua:', range.reason);
    return;
  }

  autoMerging.add(sid);
  try {
    const name = range.full ? '' : `${sanitizeFolderName(title)}_${MERGED_SUFFIX} Tập ${range.from}-${range.to}`;
    const res = await startMerge(sid, name, { compatible: !!settings.auto_merge_compatible });
    if (!res.success) console.warn('[AutoMerge] Bỏ qua:', res.error);
  } finally {
    autoMerging.delete(sid);
  }
}

/** Các số tập đã tải (tăng dần) có tạo thành khoảng liên tiếp không; full=phủ cả phim (1..total) */
function autoMergeRange(indexes, total) {
  if (indexes.length < 2) return { ok: false, reason: 'chưa đủ 2 tập' };
  const from = indexes[0];
  const to = indexes[indexes.length - 1];
  if (to - from + 1 !== indexes.length) return { ok: false, reason: `các tập không liên tiếp (${indexes.join(',')})` };
  return { ok: true, from, to, full: from === 1 && total > 0 && to === total };
}

// Giữ tên cũ, logic bên trong không đổi (nhiều chỗ gọi vẫn đang dùng)
function processDownloadQueue() {
  pumpQueue();
}

/** Đưa lại các tác vụ đang chờ vào hàng đợi (dùng khi tự chạy tiếp lúc khởi động / Bắt đầu tất cả) */
function enqueuePendingTasks() {
  const pending = downloadTasks.filter(
    (t) => t.status === 'pending' && !downloadQueue.some((q) => q.id === t.id)
  );
  for (const t of pending) downloadQueue.push(t);
  return pending.length;
}

/**
 * Tạm dừng tất cả: hủy các tác vụ đang chạy, xóa hàng đợi chờ, đánh dấu các tác vụ đang chờ là đã dừng.
 * Trả về số tác vụ bị tạm dừng.
 */
function pauseAllTasks() {
  let stopped = 0;
  for (const task of downloadTasks) {
    if (task.status === 'pending') {
      task.status = 'stopped';
      task.error = 'Đã tạm dừng thủ công';
      task.endTime = Date.now();
      stopped++;
    } else if (task.status === 'downloading') {
      task.cancelled = true;
      if (task.cancelSource) {
        try { task.cancelSource.cancel('Người dùng tạm dừng tất cả'); } catch (_) {}
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
 * Bắt đầu tất cả: đưa mọi tác vụ chưa xong (đã dừng / thất bại / đang chờ) vào hàng đợi chạy lại.
 * Trả về số tác vụ được xếp hàng lại.
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

// ===== Phân phát tải xuống =====
async function executeDownload(task) {
  if (task.type === 'hongguo') {
    await executeHongguoDownload(task);
    return;
  }
  throw new Error('Loại tác vụ không xác định: ' + task.type);
}

// ===== Tải phim ngắn Hongguo =====
async function executeHongguoDownload(task) {
  const { id, hongguoInfo, filename } = task;
  const { vid, series_title, vid_index } = hongguoInfo || {};

  try {
    console.log(`[Hongguo] Bắt đầu tải xuống 《${series_title}》 Tập ${vid_index}:`, vid);
    task.status = 'downloading';
    task.progress = 0;
    sendToRenderer('download-progress', { id, progress: 0, receivedBytes: 0, totalBytes: 0 });

    // 1. Lấy link phát trực tiếp và thông tin mã hóa spade_a (khi dự phòng qua trang chính thức thì spadeA rỗng, link là MP4 không mã hóa)
    const playInfo = await sourceFor(vid).fetchPlayUrlSingle(vid, hongguoInfo && hongguoInfo.series_id);
    if (!playInfo || !playInfo.url) {
      throw new Error('Không lấy được địa chỉ phát hợp lệ' + (playInfo && playInfo.error ? ' (' + playInfo.error + ')' : ''));
    }

    // 2. Thư mục tải
    const settings = getCurrentSettings();
    const root = (settings.root && String(settings.root).trim()) ? String(settings.root).trim() : app.getPath('downloads');
    const seriesFolder = sanitizeFolderName(series_title) || 'Phim chưa đặt tên';
    const downloadDir = task.customDir || path.join(root, downloadSubdir(root), seriesFolder);
    fs.mkdirSync(downloadDir, { recursive: true });

    const finalPath = task.savePath || path.join(downloadDir, filename);
    task.savePath = finalPath;

    // Tệp đích đã tồn tại và đủ kích thước thì bỏ qua, không tải lại
    if (fs.existsSync(finalPath) && fs.statSync(finalPath).size > 1024 * 100) {
      console.log('[Hongguo] Tệp đã tồn tại, hoàn tất ngay:', finalPath);
      task.status = 'completed';
      task.progress = 100;
      task.endTime = Date.now();
      saveDownloadTasks();
      sendToRenderer('download-completed', { id, path: finalPath });
      return;
    }

    const tmpPath = finalPath + '.enc.tmp';

    // 3. Tải dạng stream qua HTTP
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

    // 4. Giải mã CENC-AES-CTR
    if (playInfo.spadeA) {
      console.log('[Hongguo] Đang tạo AES Key và giải mã MP4...');
      const key = hongguo.deriveKey(playInfo.spadeA);
      if (!key) {
        throw new Error('Tạo key thất bại');
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

    console.log('[Hongguo] Tải xuống hoàn tất:', finalPath);
    sendToRenderer('download-completed', { id, path: finalPath });
  } catch (error) {
    console.error('[Hongguo] Tải xuống thất bại:', error.message);
    delete task.cancelSource;
    delete task.writer;
    task.status = 'failed';
    task.error = error.message;
    saveDownloadTasks();
    sendToRenderer('download-failed', { id, error: error.message });
  }
}

// Gửi sự kiện tới tiến trình renderer
function sendToRenderer(channel, payload) {
  if (mainWindow && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

// ===== IPC: phân tích Hongguo và tải hàng loạt =====
ipcMain.handle('hongguo-resolve', async (event, input) => {
  try {
    const seriesId = reelfren.seriesIdFromUrl(input) || await hongguo.resolveSeriesId(input);
    const data = await sourceFor(seriesId).fetchEpisodeList(seriesId);
    upsertSeriesRegistry(data);
    return { success: true, data };
  } catch (error) {
    console.error('[Hongguo] Phân tích thất bại:', error.message);
    return { success: false, error: error.message };
  }
});

// ===== Tìm kiếm: dùng trình duyệt nhúng để dò hongguoduanju.com =====
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
    title: 'Tìm kiếm - Phim ngắn Hongguo',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  // Điều hướng trong site giữ nguyên trong cùng cửa sổ, tránh bật cửa sổ mới
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
 * Script trích xuất thẻ phim dùng chung (trang danh mục / trang tìm kiếm).
 * Chỉ dựa vào series_id trong link (không dựa vào tên class dạng hash), tên phim ưu tiên lấy img[alt],
 * nhờ vậy khi site đổi giao diện thì ít bị hỏng hơn.
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

    // Ảnh bìa: ưu tiên picture>source[srcset] (trang danh mục dùng picture), dự phòng img[src]
    let cover = '';
    const pic = a.querySelector('picture');
    if (pic) {
      const src = pic.querySelector('source[srcset]');
      if (src) cover = (src.getAttribute('srcset') || '').split(' ')[0];
    }
    if (!cover && img) cover = img.getAttribute('src') || img.getAttribute('data-src') || '';

    // Tổng số tập: trên trang là chữ Hán dạng "Toàn bộ 86 tập"
    let episode_count = 0;
    const epEl = a.querySelector('[class*="episode"]');
    if (epEl) {
      const em = (epEl.textContent || '').match(/(\\d+)\\s*集/);
      if (em) episode_count = parseInt(em[1], 10);
    }

    // Thẻ
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
 * Thông tin bổ sung của trang danh mục: metadata phân trang + các bộ lọc thể loại có sẵn.
 * Thể loại được trích từ các link /category/<cat>/<genre> trong trang, tránh hardcode.
 */
const BROWSE_META_JS = `(() => {
  const out = { page: 1, totalPages: 0, total: 0, genres: [] };

  // 1) Ưu tiên đọc dữ liệu phân trang nhúng trong trang
  try {
    const html = document.documentElement.innerHTML;
    const m = html.match(/"pagination":\\s*\\{[^}]*"total":(\\d+)[^}]*"pageNum":(\\d+)[^}]*"pageSize":(\\d+)[^}]*"totalPages":(\\d+)/);
    if (m) {
      out.total = parseInt(m[1], 10);
      out.page = parseInt(m[2], 10);
      out.totalPages = parseInt(m[4], 10);
    }
  } catch (e) {}

  // 2) Dự phòng: suy ra tổng số trang từ các link phân trang
  if (!out.totalPages) {
    let maxPage = 0;
    document.querySelectorAll('a[href*="page="]').forEach((a) => {
      const m = (a.getAttribute('href') || '').match(/[?&]page=(\\d+)/);
      if (m) maxPage = Math.max(maxPage, parseInt(m[1], 10));
    });
    out.totalPages = maxPage;
  }

  // 3) Bộ lọc thể loại: /category/<cat>/<genre>
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

/** Cấu trúc trang giống trang tìm kiếm, trang danh mục dùng lại cùng bộ dò + hàng đợi tuần tự */
async function runSniffOnUrl(url, label) {
  const win = getSearchWindow();

  // Chạy tuần tự trong cùng một cửa sổ, tránh các lần điều hướng song song cắt ngang nhau
  const task = async () => {
    console.log(`[${label}] Mở:`, url);
    try {
      await win.loadURL(url, { userAgent: SEARCH_UA });
    } catch (e) {
      // loadURL có thể reject khi trang có chuyển hướng/bị ngắt, ở đây vẫn tiếp tục thử đọc DOM
      console.warn(`[${label}] loadURL trả về lỗi (vẫn tiếp tục đọc):`, e.message);
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
      // Dự phòng: trả kèm tiêu đề trang để người dùng biết là "không có kết quả" hay "bị chặn"
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

    console.log(`[${label}] Tìm thấy ${results.length} phim`);
    return { success: true, results, meta };
  };

  // Tuần tự hóa
  const prev = searchWindowReady || Promise.resolve();
  const next = prev.then(task, task);
  searchWindowReady = next.catch(() => {});
  return next;
}

async function runSearchSniff(keyword) {
  return runSniffOnUrl(`${SEARCH_SITE}/search/${encodeURIComponent(keyword)}`, 'Search');
}

// ===== Duyệt: trang danh mục (kèm lọc thể loại và phân trang) =====
const BROWSE_CATEGORIES = [
  { slug: 'real-drama', label: 'Phim người đóng' },
  { slug: 'comic-drama', label: 'Phim hoạt hình' },
  { slug: 'ai-drama', label: 'Phim AI' },
  { slug: 'comic', label: 'Truyện tranh' },
  { slug: 'pinedrama', label: 'PineDrama' }, // Dùng API reelfren, không qua trình duyệt nhúng
];

ipcMain.handle('browse-categories', async () => BROWSE_CATEGORIES);

ipcMain.handle('browse-list', async (event, options) => {
  try {
    const { category = 'real-drama', genre = '', page = 1 } = options || {};
    const cat = String(category).replace(/[^a-z0-9-]/gi, '') || 'real-drama';
    const gen = String(genre).replace(/[^a-z0-9-]/gi, '');
    const pg = Math.max(1, parseInt(page, 10) || 1);

    if (cat === 'pinedrama') {
      const results = await reelfren.listHome();
      return { success: true, results, page: 1, totalPages: 1, total: results.length, genres: [], pageTitle: '' };
    }

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
    console.error('[Browse] Thất bại:', error.message);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('search-series', async (event, keyword) => {
  const kw = String(keyword || '').trim();
  if (!kw) return { success: false, error: 'Vui lòng nhập từ khóa tìm kiếm' };
  try {
    // Tìm song song trên Hongguo và PineDrama, một bên lỗi không ảnh hưởng bên kia
    const [hg, pd] = await Promise.allSettled([runSearchSniff(kw), reelfren.search(kw)]);
    const hgRes = hg.status === 'fulfilled' ? hg.value : { success: false, error: hg.reason && hg.reason.message };
    const pdList = pd.status === 'fulfilled' ? pd.value : [];
    if (pd.status === 'rejected') console.warn('[Search] PineDrama thất bại:', pd.reason && pd.reason.message);
    if (!hgRes.success && !pdList.length) return hgRes;
    return { ...hgRes, success: true, results: [...(hgRes.results || []), ...pdList] };
  } catch (error) {
    console.error('[Search] Thất bại:', error.message);
    return { success: false, error: error.message };
  }
});

// Sau khi chọn một phim từ kết quả tìm kiếm, lấy đủ danh sách tập và đăng ký hồ sơ
ipcMain.handle('search-resolve', async (event, seriesId) => {
  try {
    if (!seriesId) return { success: false, error: 'Thiếu series_id' };
    const data = await sourceFor(seriesId).fetchEpisodeList(String(seriesId));
    upsertSeriesRegistry(data);
    return { success: true, data };
  } catch (error) {
    console.error('[Search] Lấy danh sách tập thất bại:', error.message);
    return { success: false, error: error.message };
  }
});

// Hiển thị cửa sổ tìm kiếm (dự phòng khi quá thời gian: để người dùng tự thao tác)
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

// Hồ sơ phim ngắn đã đăng ký (không gồm phim người dùng đã gỡ)
ipcMain.handle('get-series-list', async () => visibleSeries());

/** Gỡ một phim ngắn khỏi danh sách (chỉ hủy đăng ký, không xóa tệp trên máy) */
ipcMain.handle('remove-series', async (event, seriesId) => {
  const sid = String(seriesId);
  const entry = seriesRegistry.find((s) => String(s.series_id) === sid);
  if (!entry) return { success: false, error: 'Không tìm thấy phim này' };
  entry.dismissed = true;
  saveSeriesRegistry();
  return { success: true };
});

/** Gỡ hàng loạt các phim chưa tải tập nào (dọn hồ sơ trống còn lại khi duyệt) */
ipcMain.handle('purge-empty-series', async () => {
  let removed = 0;
  for (const s of seriesRegistry) {
    if (s.dismissed) continue;
    // Lưu ý: phải kiểm tra cả "bản ghi tác vụ" lẫn "tệp thực sự có trên đĩa".
    // Chỉ xem bản ghi tác vụ sẽ đánh giá sai — bản ghi có thể bị xóa hoặc thiếu giữa các phiên, trong khi tệp vẫn còn.
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
 * Khôi phục bản ghi tác vụ tải từ đĩa.
 * Dùng khi bản ghi tác vụ bị mất/bị xóa, hoặc khi bản cũ tải thẳng mà không đăng ký —
 * chỉ cần trên đĩa có tệp và hồ sơ phim có số tập tương ứng thì đăng ký lại là "Đã hoàn tất".
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
        title: `《${s.series_title}》 Tập ${String(f.vid_index).padStart(3, '0')}`,
        platform: 'hongguo',
        type: 'hongguo',
        status: 'completed',
        progress: 100,
        receivedBytes: size,
        totalBytes: size,
        startTime: Date.now(),
        videoInfo: {
          author: s.series_title,
          title: `《${s.series_title}》 Tập ${String(f.vid_index).padStart(3, '0')}`,
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
  console.log(`[Rescan] Đã khôi phục ${added} bản ghi tải xuống từ ổ đĩa`);
  return { success: true, count: added };
}

ipcMain.handle('rescan-downloads', async () => {
  try {
    return rescanDownloadsFromDisk();
  } catch (error) {
    console.error('[Rescan] Thất bại:', error.message);
    return { success: false, error: error.message };
  }
});

/** Hiển thị lại phim ngắn đã bị gỡ */
ipcMain.handle('restore-dismissed-series', async () => {
  let n = 0;
  for (const s of seriesRegistry) {
    if (s.dismissed) { s.dismissed = false; n++; }
  }
  if (n > 0) saveSeriesRegistry();
  return { success: true, count: n };
});

ipcMain.handle('dismissed-count', async () => seriesRegistry.filter((s) => s.dismissed).length);

// ===== Gộp một chạm (ffmpeg concat sao chép luồng, không giảm chất lượng và nhanh) =====
let mergeTasks = []; // { id, seriesId, seriesTitle, status, progress, output, total, done, error }

function resolveFfmpeg(name) {
  // build/ffmpeg chứa exe bản Windows; khi phát triển hoặc đóng gói chéo trên macOS/Linux thì không thể chạy nó
  const bin = process.platform === 'win32' ? `${name}.exe` : name;
  const candidates = [
    // Sau khi đóng gói: resources/bin (extraResources không bị đưa vào asar nên exe mới chạy được)
    process.resourcesPath ? path.join(process.resourcesPath, 'bin', bin) : null,
    // Chế độ phát triển: build/ffmpeg trong repo
    path.join(__dirname, 'build', 'ffmpeg', bin),
    // PATH hệ thống
    name,
  ];
  for (const c of candidates) {
    if (!c) continue;
    if (c === name) return c; // Để PATH tự phân giải
    try {
      if (fs.existsSync(c)) return c;
    } catch (_) {}
  }
  // Dự phòng: quét thư mục cài đặt của winget
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

// Hiển thị tệp trong trình quản lý tệp
ipcMain.handle('show-in-folder', async (event, filePath) => {
  try {
    if (!filePath) return { success: false, error: 'Thiếu đường dẫn' };
    if (fs.existsSync(filePath)) {
      shell.showItemInFolder(filePath);
      return { success: true };
    }
    const dir = path.dirname(filePath);
    if (fs.existsSync(dir)) {
      await shell.openPath(dir);
      return { success: true };
    }
    return { success: false, error: 'Đường dẫn không tồn tại' };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('get-merge-tasks', async () => mergeTasks.map(({ child, ...rest }) => rest));

/** Tìm thư mục của một phim trên đĩa (ưu tiên bản ghi tác vụ, sau đó suy ra từ tiêu đề) */
function resolveSeriesDir(seriesId, seriesTitle, covers) {
  const fromTask = covers.find((t) => t.customDir && fs.existsSync(t.customDir));
  if (fromTask) return fromTask.customDir;
  const settings = getCurrentSettings();
  const root = (settings.root && String(settings.root).trim()) ? String(settings.root).trim() : app.getPath('downloads');
  const folder = sanitizeFolderName(seriesTitle);
  // Thư mục tên tiếng Trung của bản cũ cũng phải tìm được, để tương thích tệp tải trước khi nâng cấp (giữ nguyên chuỗi tiếng Trung bên dưới)
  const guesses = [
    path.join(root, DOWNLOAD_SUBDIR, folder || 'Phim chưa đặt tên'),
    path.join(root, LEGACY_DOWNLOAD_SUBDIR, folder || 'Phim chưa đặt tên'),
    path.join(root, '红果短剧', folder || '未命名短剧'),
  ];
  return guesses.find((g) => fs.existsSync(g)) || null;
}

/**
 * Sắp xếp thứ tự gộp: chỉ tính các tệp thực sự có trên đĩa (hàng đợi tác vụ có thể lệch với tệp thực tế do gửi trùng,
 * xóa thủ công, tải qua nhiều phiên, v.v.).
 * Tập có bản ghi tác vụ thì định vị chính xác theo mẫu tên; không có bản ghi thì dự phòng bằng cách quét thư mục theo số tập.
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

  // 1) Ưu tiên bản ghi tác vụ (mẫu đặt tên có thể khác mặc định)
  for (const t of tasks) {
    if (!exists(t.savePath)) continue;
    const idx = Number(t.hongguoInfo.vid_index) || 0;
    if (!idx) continue;
    const prev = byIndex.get(idx);
    if (!prev || (t.startTime || 0) > (prev.startTime || 0)) {
      byIndex.set(idx, { vid_index: idx, path: t.savePath, filename: t.filename || path.basename(t.savePath) });
    }
  }

  // 2) Dự phòng quét thư mục: bổ sung các tệp tập phim khớp quy tắc đặt tên trong thư mục theo số tập.
  //    Không dựa vào "các tập đã đăng ký" — trên đĩa có thể có tệp mồ côi không có bản ghi tác vụ
  //    (tải qua nhiều phiên, tác vụ bị dọn, v.v.), những tệp này cũng cần được gộp vào.
  if (dir) {
    let names = [];
    try { names = fs.readdirSync(dir); } catch (_) {}
    for (const n of names) {
      if (!/\.mp4$/i.test(n) || isMergedName(n)) continue;
      // Dạng "Tên phim 001.mp4" — lấy số ở cuối tên tệp làm số tập
      const m = n.match(EP_FILE_RE);
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

ipcMain.handle('merge-series', (event, ...args) => startMerge(...args));

async function startMerge(seriesId, outputName, options) {
  try {
    const sid = String(seriesId);
    const entry = seriesRegistry.find((s) => String(s.series_id) === sid);
    const seriesTitle =
      (entry && entry.series_title) ||
      ((downloadTasks.find((t) => t.hongguoInfo && String(t.hongguoInfo.series_id) === sid) || {}).hongguoInfo || {}).series_title ||
      'Phim chưa đặt tên';
    const entries = (entry && entry.episodes) || [];

    const { dir, ordered } = collectSeriesEpisodeFiles(sid, seriesTitle);
    if (!ordered.length) return { success: false, error: 'Phim này chưa có tập nào tải xuống hoàn tất' };

    const ffmpegPath = resolveFfmpeg('ffmpeg');
    const ffprobePath = resolveFfmpeg('ffprobe');
    if (!ffmpegPath) {
      return { success: false, error: 'Không tìm thấy ffmpeg, không thể gộp (vui lòng cài lại bản đầy đủ)' };
    }

    const outDir = dir || path.dirname(ordered[0].path);
    const baseName = outputName && String(outputName).trim()
      ? sanitizeFolderName(outputName)
      : `${sanitizeFolderName(seriesTitle)}_${MERGED_SUFFIX}`;
    const output = path.join(outDir, `${baseName}.mp4`);

    if (fs.existsSync(output)) {
      return { success: false, error: `Tệp đầu ra đã tồn tại: ${baseName}.mp4, vui lòng xóa trước hoặc đổi tên khác` };
    }

    // Kiểm tra dung lượng đĩa (đầu ra xấp xỉ tổng các tập)
    const totalBytes = ordered.reduce((s, e) => s + fs.statSync(e.path).size, 0);
    try {
      const st = fs.statfsSync(outDir);
      const free = st.bavail * st.bsize;
      if (free < totalBytes * 1.1) {
        return {
          success: false,
          error: `Không đủ dung lượng ổ đĩa: cần khoảng ${(totalBytes / 1073741824).toFixed(1)} GB, còn trống ${(free / 1073741824).toFixed(1)} GB`,
        };
      }
    } catch (_) {}

    // Kiểm tra mẫu tính đồng nhất mã hóa (tập đầu so với các tập lấy mẫu phía sau)
    let codecWarning = '';
    if (ffprobePath) {
      const first = await probeVideoInfo(ffprobePath, ordered[0].path);
      const sampleIdx = [Math.floor(ordered.length / 2), ordered.length - 1];
      for (const i of sampleIdx) {
        if (i <= 0 || i >= ordered.length) continue;
        const s = await probeVideoInfo(ffprobePath, ordered[i].path);
        if (first && s && (first.codec !== s.codec || first.w !== s.w || first.h !== s.h)) {
          codecWarning = `Tập ${ordered[i].vid_index} có mã hóa khác tập đầu (${s.codec} ${s.w}x${s.h} so với ${first.codec} ${first.w}x${first.h}), bản gộp có thể bị lỗi hình`;
          break;
        }
      }
    }

    // Ghi danh sách concat (UTF-8 không BOM; đường dẫn tuyệt đối kèm -safe 0, tránh lỗi escape ký tự Unicode/khoảng trắng)
    const listPath = path.join(outDir, `.${baseName}.ffconcat.txt`);
    const listBody = ordered.map((e) => `file '${e.path.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n');
    fs.writeFileSync(listPath, listBody + '\n', 'utf8');

    // Tổng thời lượng (dùng tính phần trăm tiến độ)
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

    // Định dạng tương thích: chuyển mã sang H.264, mọi trình phát/máy tính đều phát được (chậm nhưng phổ biến)
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
      console.log('[Merge] Gộp ở định dạng tương thích, bộ mã hóa:', encoder);
    } else {
      videoArgs = ['-c', 'copy'];
    }

    // Lưu ý: phần mở rộng .part không giúp ffmpeg đoán được định dạng container, phải chỉ rõ -f mp4
    const args = [
      '-y', '-hide_banner',
      '-f', 'concat', '-safe', '0', '-i', listPath,
      ...videoArgs, '-movflags', '+faststart',
      '-progress', 'pipe:1', '-nostats',
      '-f', 'mp4',
      tmpOutput,
    ];
    console.log('[Merge] Bắt đầu gộp', ordered.length, 'tập ->', output);
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
      task.error = 'Không thể khởi động ffmpeg: ' + err.message;
      saveMergeTasks();
      sendToRenderer('merge-failed', { id, error: task.error });
    });

    child.on('close', (code) => {
      try { fs.unlinkSync(listPath); } catch (_) {}
      delete task.child;
      if (task.cancelled) {
        try { fs.existsSync(tmpOutput) && fs.unlinkSync(tmpOutput); } catch (_) {}
        task.status = 'stopped';
        task.error = 'Đã hủy';
      } else if (code === 0 && fs.existsSync(tmpOutput)) {
        try {
          fs.renameSync(tmpOutput, output);
          const size = fs.statSync(output).size;
          task.status = 'completed';
          task.progress = 100;
          task.done = ordered.length;
          task.outputBytes = size;
          console.log('[Merge] Hoàn tất:', output, (size / 1048576).toFixed(1) + 'MB');
          // Kiểm tra đầu ra: xác nhận đọc được bình thường (tránh tạo tệp hỏng mà vẫn báo thành công)
          if (ffprobePath) {
            probeVideoInfo(ffprobePath, output).then((info) => {
              if (!info) {
                task.error = 'Không thể đọc tệp đầu ra, có thể đã bị hỏng';
                task.status = 'failed';
                saveMergeTasks();
                sendToRenderer('merge-failed', { id, error: task.error });
              } else {
                task.verified = `${info.codec} ${info.w}x${info.h}`;
                saveMergeTasks();
                sendToRenderer('merge-completed', { id, path: output, verified: task.verified });
              }
            });
            return; // Kiểm tra xong mới gửi sự kiện hoàn tất
          }
        } catch (e) {
          task.status = 'failed';
          task.error = 'Đổi tên tệp đầu ra thất bại: ' + e.message;
        }
      } else {
        task.status = 'failed';
        task.error = `ffmpeg thoát với mã ${code}${stderrTail ? ': ' + stderrTail.split('\n').filter(Boolean).slice(-2).join(' ') : ''}`;
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
    console.error('[Merge] Thất bại:', error.message);
    return { success: false, error: error.message };
  }
}

ipcMain.handle('cancel-merge', async (event, id) => {
  const t = mergeTasks.find((m) => m.id === id);
  if (!t) return { success: false, error: 'Tác vụ không tồn tại' };
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
      // Đánh dấu các tác vụ gộp chưa chạy xong từ lần trước là bị gián đoạn
      if (t.status === 'running') return { ...t, status: 'stopped', error: 'Bị gián đoạn do ứng dụng đóng' };
      return t;
    });
  } catch (_) {
    mergeTasks = [];
  }
}

/**
 * Nguồn dữ liệu trang phát: kết hợp "hồ sơ phim ngắn" và "tác vụ tải" thành trạng thái phát được của từng tập.
 * Quy tắc xác định phát được giống logic bỏ qua khi tải: tệp tồn tại và > 100KB.
 * Vì tệp giải mã được "ghi ra .enc.tmp trước, thành công mới đổi tên thành .mp4", nên sẽ không đọc phải tệp dở dang.
 */
ipcMain.handle('get-series-episodes', async (event, seriesId) => {
  try {
    const sid = String(seriesId);
    const entry = seriesRegistry.find((s) => String(s.series_id) === sid);
    const tasks = downloadTasks.filter((t) => t.hongguoInfo && String(t.hongguoInfo.series_id) === sid);

    // Mỗi tập chỉ giữ một tác vụ (nếu cùng vid bị gửi trùng thì lấy cái mới nhất)
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

    // Dự phòng theo thư mục: trên đĩa có thể có tệp "mồ côi" không có bản ghi tác vụ
    // (tác vụ bị dọn, tải qua nhiều phiên, v.v.), chỉ dựa vào tác vụ sẽ báo nhầm chúng là "chưa tải".
    const seriesTitle = (entry && entry.series_title) ||
      (tasks[0] && tasks[0].hongguoInfo.series_title) || 'Phim chưa đặt tên';
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

        // Khi thiếu tác vụ (hoặc tác vụ đó không có tệp dùng được), dự phòng bằng kết quả quét đĩa
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
    console.error('[Player] Đọc danh sách tập thất bại:', error.message);
    return { success: false, error: error.message };
  }
});

// Xem tiếp từ chỗ dừng
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
 * Phát từ trang "Duyệt": chuyển sang trang phát và chọn phim đó.
 * Tiến trình chính chỉ gửi lệnh điều hướng, trạng thái tập cụ thể do lớp renderer tự lấy, tránh phải duy trì hai bản dữ liệu.
 */
ipcMain.handle('play-series', async (event, payload) => {
  const { seriesId, vidIndex } = payload || {};
  sendToRenderer('navigate', {
    page: 'player',
    payload: { seriesId: seriesId ? String(seriesId) : '', vidIndex: Number(vidIndex) || 0 },
  });
  return { success: true };
});

// ===== Phát trực tuyến =====

/** Đăng ký giao thức stream: cấp dữ liệu cho trình phát từ bộ nhớ đệm trong RAM theo Range */
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
      console.error('[Stream] Cung cấp dữ liệu thất bại:', e.message);
      return new Response('error', { status: 500 });
    }
  });
}

/** Chuyển đường dẫn tệp trên máy thành URL mà tiến trình renderer phát được */
function localPlayUrl(filePath) {
  if (!filePath) return null;
  const p = path.resolve(String(filePath));
  return `${LOCAL_SCHEME}://f/${Buffer.from(p, 'utf8').toString('base64url')}`;
}

/**
 * Đăng ký giao thức phát tệp trên máy.
 * Chuyển sang để tiến trình chính đọc tệp bằng Node rồi cấp dữ liệu, thay vì để Chromium đọc file://:
 * ở chế độ phát triển trang renderer được tải từ http://localhost:5173, Chromium sẽ
 * từ chối request file:// với lỗi "Not allowed to load local resource" (biểu hiện: trình phát màn hình đen, tiến độ 0:00).
 * Dùng giao thức tùy chỉnh thì hai chế độ phát triển/đóng gói hoạt động giống nhau, và hỗ trợ tua bằng Range.
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
      // Chỉ cho phép lấy tệp video, tránh giao thức này bị lợi dụng để đọc tệp bất kỳ trên máy
      if (!/\.(mp4|m4v|mov|webm)$/i.test(filePath)) {
        return new Response('forbidden', { status: 403, headers: { 'Content-Type': 'text/plain' } });
      }

      let size = 0;
      try {
        size = (await fsp.stat(filePath)).size;
      } catch (_) {
        console.warn('[Local] Tệp không tồn tại:', filePath);
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
      console.error('[Local] Đọc tệp thất bại:', e.message);
      return new Response('error', { status: 500, headers: { 'Content-Type': 'text/plain' } });
    }
  });
}

/** Tải cả tập vào bộ nhớ rồi giải mã (khi dự phòng qua trang chính thức thì link là MP4 không mã hóa, bỏ qua giải mã) */
async function fetchDecryptedEpisode(vid, onProgress, seriesId) {
  const playInfo = await sourceFor(vid).fetchPlayUrlSingle(vid, seriesId);
  if (!playInfo || !playInfo.url) throw new Error('Không lấy được địa chỉ phát hợp lệ' + (playInfo && playInfo.error ? ' (' + playInfo.error + ')' : ''));

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
    if (!key) throw new Error('Tạo khóa giải mã thất bại');
    buf = hongguo.decryptMp4Buffer(buf, key);
  }
  return buf;
}

/**
 * Chuẩn bị phát trực tuyến: tải + giải mã vào bộ nhớ, trả về địa chỉ stream đưa được cho <video>.
 * Yêu cầu lặp lại cho cùng một tập sẽ dùng lại tác vụ đang chạy.
 */
ipcMain.handle('prepare-online-play', async (event, payload) => {
  try {
    const { vid, seriesId, vidIndex } = payload || {};
    if (!vid) return { success: false, error: 'Thiếu vid' };
    const key = String(vid);

    // Đã có trong bộ nhớ đệm
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

    // Chống trùng lặp
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
      console.log('[Online] Bắt đầu lưu đệm tập', vidIndex, ':', key);
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
      console.log('[Online] Lưu đệm xong tập', vidIndex, (buf.length / 1048576).toFixed(1) + 'MB',
        'bộ nhớ đang dùng', (onlineCacheTotal() / 1048576).toFixed(1) + 'MB');
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
    console.error('[Online] Chuẩn bị thất bại:', error.message);
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

// ===== Chế độ tương thích: chuyển HEVC sang H.264, khắc phục lỗi "màn hình đen có tiếng" =====
const COMPAT_MAX_BYTES = 4 * 1024 * 1024 * 1024; // Giới hạn bộ nhớ đệm chuyển mã
let compatDir = null;
let compatEncoder = null; // Bộ mã hóa H.264 tốt nhất dò được

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
  entries.sort((a, b) => a.at - b.at); // Xóa mục truy cập sớm nhất trước
  for (const e of entries) {
    if (total <= COMPAT_MAX_BYTES) break;
    try { fs.unlinkSync(e.p); total -= e.size; } catch (_) {}
  }
}

/** Dò bộ mã hóa H.264 dùng được: xem danh sách trước, rồi thử mã hóa thật một khung hình (có trong danh sách chưa chắc dùng được, ví dụ nvenc khi không có card NVIDIA) */
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
  if (!candidates.includes('libx264')) candidates.push('libx264'); // Dự phòng bằng phần mềm

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
    console.log('[Compat] Bộ mã hóa không khả dụng, bỏ qua:', enc);
  }
  if (!compatEncoder) compatEncoder = 'libx264';
  console.log('[Compat] Sử dụng bộ mã hóa:', compatEncoder);
  return compatEncoder;
}

/**
 * Chuyển mã sang H.264/AAC.
 * Trả về { success, path, size, elapsed }
 */
ipcMain.handle('transcode-for-playback', async (event, payload) => {
  try {
    const { seriesId, vidIndex, filePath, force } = payload || {};
    if (!seriesId || vidIndex == null) return { success: false, error: 'Thiếu thông tin tập phim' };

    const out = compatPathFor(seriesId, vidIndex);
    if (!force && fs.existsSync(out) && fs.statSync(out).size > 1024 * 100) {
      // Có sẵn trong bộ nhớ đệm
      try { fs.utimesSync(out, new Date(), new Date()); } catch (_) {}
      return { success: true, url: localPlayUrl(out), size: fs.statSync(out).size, cached: true };
    }

    const ffmpegPath = resolveFfmpeg('ffmpeg');
    const ffprobePath = resolveFfmpeg('ffprobe');
    if (!ffmpegPath) return { success: false, error: 'Không tìm thấy ffmpeg, không thể chuyển mã' };

    // 1) Xác định tệp đầu vào: ưu tiên tệp đã tải về máy; nếu không thì lấy từ bộ nhớ đệm trực tuyến và ghi ra tệp tạm
    let inputPath = filePath || null;
    let tmpInput = null;
    if (!inputPath || !fs.existsSync(inputPath)) {
      const vid = payload.vid;
      if (!vid) return { success: false, error: 'Không có tệp cục bộ lẫn vid' };
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

    // 2) Chuyển mã (bộ mã hóa phần cứng dùng tham số khuyến nghị riêng)
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

    console.log(`[Compat] Chuyển mã tập ${vidIndex}  bộ mã hóa=${encoder}  thời lượng=${duration.toFixed(0)}s`);
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
      console.warn('[Compat] Chuyển mã thất bại code=', code, tail);
      return { success: false, error: `Chuyển mã thất bại (ffmpeg thoát với mã ${code})${tail ? ': ' + tail : ''}` };
    }

    fs.renameSync(tmpOut, out);
    trimCompatCache();
    const size = fs.statSync(out).size;
    const elapsed = ((Date.now() - started) / 1000).toFixed(1);
    console.log(`[Compat] Hoàn tất ${(size / 1048576).toFixed(1)}MB  mất ${elapsed}s`);

    sendToRenderer('transcode-progress', { seriesId: String(seriesId), vidIndex: Number(vidIndex), percent: 100, done: true });
    return { success: true, url: localPlayUrl(out), size, elapsed: Number(elapsed), encoder };
  } catch (error) {
    console.error('[Compat] Chuyển mã thất bại:', error.message);
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

/** Báo máy này có giải mã được HEVC không (để giao diện cảnh báo trước) */
ipcMain.handle('decode-capability', async () => ({
  ffmpegEncoder: compatEncoder || null,
  compatDir: getCompatDir(),
}));



/**
 * Thêm một số tập vào hàng đợi tải (dùng chung cho tải hàng loạt và nút "Tải tập này" trong trình phát).
 * Trả về số tác vụ mới tạo.
 */
function enqueueEpisodes({ seriesId, seriesTitle, episodes, cover }) {
  if (!Array.isArray(episodes) || episodes.length === 0) return 0;

  const settings = getCurrentSettings();
  const root = (settings.root && String(settings.root).trim()) ? String(settings.root).trim() : app.getPath('downloads');
  const cleanSeriesTitle = sanitizeFolderName(seriesTitle) || 'Phim ngắn Hongguo';
  const downloadDir = path.join(root, downloadSubdir(root), cleanSeriesTitle);
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
    const baseName = namePart || `${cleanSeriesTitle}_Tập ${epIndexStr}`;
    const filename = `${baseName}.mp4`;
    const finalPath = path.join(downloadDir, filename);

    // Tập này đã có trong hàng đợi/đã xong, tránh tạo tác vụ trùng
    const dup = downloadTasks.find(
      (t) => t.hongguoInfo && String(t.hongguoInfo.vid) === String(ep.vid) && t.status !== 'failed'
    );
    if (dup) {
      // Tác vụ đã dừng hoặc thất bại thì đưa lại vào hàng đợi
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
      title: `《${cleanSeriesTitle}》 Tập ${epIndexStr}${ep.title ? ' ' + ep.title : ''}`,
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
        title: `《${cleanSeriesTitle}》 Tập ${epIndexStr}`,
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
      return { success: false, error: 'Chưa chọn tập nào' };
    }
    const count = enqueueEpisodes({ seriesId, seriesTitle, episodes });
    return { success: true, count, requested: episodes.length };
  } catch (error) {
    console.error('[Hongguo] Gửi yêu cầu tải xuống hàng loạt thất bại:', error.message);
    return { success: false, error: error.message };
  }
});

// Tải toàn bộ tập của nhiều phim một lần (nút "tải tất cả trang này" ở trang Duyệt / "tải tất cả" ở kết quả tìm kiếm)
ipcMain.handle('download-series-list', async (event, seriesIds) => {
  const ids = Array.isArray(seriesIds) ? seriesIds.map(String).filter(Boolean) : [];
  if (!ids.length) return { success: false, error: 'Không có phim nào để tải' };
  let seriesCount = 0;
  let episodeCount = 0;
  const failed = [];
  // Lấy danh sách tập với 4 luồng song song (việc xếp hàng vẫn tuần tự từng phim, enqueueEpisodes là đồng bộ)
  let next = 0;
  const worker = async () => {
    while (next < ids.length) {
      const sid = ids[next++];
      try {
        const data = await sourceFor(sid).fetchEpisodeList(sid);
        upsertSeriesRegistry(data);
        episodeCount += enqueueEpisodes({
          seriesId: data.series_id,
          seriesTitle: data.series_title,
          episodes: data.episodes,
          cover: data.cover,
        });
        seriesCount++;
      } catch (error) {
        console.error('[BulkDownload] Lấy danh sách tập thất bại:', sid, error.message);
        failed.push(sid);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, ids.length) }, worker));
  return { success: true, seriesCount, episodeCount, failed };
});

// Nút "Tải tập này" trong trình phát: bổ sung một tập theo series_id + vid_index
ipcMain.handle('download-single-episode', async (event, seriesId, vidIndex) => {
  try {
    const entry = seriesRegistry.find((s) => String(s.series_id) === String(seriesId));
    if (!entry) return { success: false, error: 'Không tìm thấy hồ sơ phim này, vui lòng phân tích một lần trước' };
    const ep = entry.episodes.find((e) => Number(e.vid_index) === Number(vidIndex));
    if (!ep) return { success: false, error: 'Không tìm thấy tập này' };
    const count = enqueueEpisodes({
      seriesId: entry.series_id,
      seriesTitle: entry.series_title,
      episodes: [{ ...ep, cover: entry.cover }],
      cover: entry.cover,
    });
    return { success: true, count };
  } catch (error) {
    console.error('[Player] Tải xuống tập thất bại:', error.message);
    return { success: false, error: error.message };
  }
});

// ===== IPC: cài đặt =====
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
    getCurrentSettings(); // Làm mới số luồng song song
    await applyProxySettings(merged); // Có hiệu lực ngay, không cần khởi động lại
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// ===== IPC: proxy mạng =====
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

// Dùng giá trị hiện tại của form để thử proxy có kết nối được không (chưa lưu cũng thử được)
ipcMain.handle('test-proxy', async (event, draft) => {
  const settings = { ...getCurrentSettings(), ...(draft || {}) };
  const resolved = resolveProxyConfig(settings);
  if (resolved.mode === 'custom' && !resolved.url) {
    return { success: false, error: 'Vui lòng điền đầy đủ địa chỉ và cổng proxy' };
  }

  // Tạo tùy chọn axios theo cấu hình hiện tại: custom thì chỉ định rõ, system thì để biến môi trường lo, direct thì tắt
  let proxyOption;
  if (resolved.mode === 'direct') {
    proxyOption = false;
  } else if (resolved.mode === 'custom') {
    proxyOption = { protocol: 'http', host: settings.proxy_host, port: parseInt(settings.proxy_port, 10) };
    if (settings.proxy_username) {
      proxyOption.auth = { username: settings.proxy_username, password: settings.proxy_password || '' };
    }
  } else {
    proxyOption = null; // Để proxy-from-env đọc biến môi trường
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
        via: resolved.url || '(proxy hệ thống/biến môi trường)',
        message: `Kết nối bình thường (HTTP ${res.status}, mất ${ms}ms)`,
      };
    }
    return { success: false, error: `Yêu cầu trả về HTTP ${res.status} (mất ${ms}ms)` };
  } catch (error) {
    const ms = Date.now() - started;
    const code = (error && error.code) || '';
    let hint = error.message || 'Lỗi không xác định';
    if (code === 'ECONNREFUSED') hint = 'Cổng proxy từ chối kết nối, vui lòng kiểm tra phần mềm proxy đã chạy và cổng đã điền đúng';
    else if (code === 'ETIMEDOUT' || code === 'ECONNABORTED') hint = 'Hết thời gian kết nối, vui lòng kiểm tra địa chỉ/cổng proxy hoặc proxy có hoạt động không';
    else if (code === 'ENOTFOUND') hint = 'Không thể phân giải địa chỉ proxy, vui lòng kiểm tra tên máy chủ';
    else if (/407/.test(hint)) hint = 'Proxy yêu cầu xác thực, vui lòng điền tên người dùng và mật khẩu';
    return { success: false, error: `${hint} (mất ${ms}ms)`, code };
  }
});

// ===== IPC: quản lý tải xuống =====
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


// ===== Dọn tệp (xóa các tệp đã tải về máy) =====

/** Xóa tệp trên máy của một tác vụ (.mp4 và .enc.tmp có thể còn sót), trả về số byte được giải phóng */
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
      console.warn('[Clean] Xóa thất bại:', p, e.message);
    }
  }
  return freed;
}

/** Xóa một nhóm bản ghi tác vụ (gỡ khỏi bộ nhớ và hàng đợi) */
function dropTaskRecords(ids) {
  const set = new Set(ids);
  downloadTasks = downloadTasks.filter((t) => !set.has(t.id));
  downloadQueue = downloadQueue.filter((t) => !set.has(t.id));
  saveDownloadTasks();
}

/** Các tệp thực sự có trên đĩa thuộc một seriesId (gồm cả tệp mồ côi không có bản ghi tác vụ) */
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
  if (taskIndex === -1) return { success: false, error: 'Tác vụ không tồn tại' };

  const task = downloadTasks[taskIndex];
  if (task.status === 'downloading') {
    task.cancelled = true;
    if (task.cancelSource) {
      try { task.cancelSource.cancel('Người dùng xóa tác vụ'); } catch (_) {}
    }
    if (task.writer) {
      try { task.writer.end(); } catch (_) {}
    }
  }

  let freed = 0;
  if (deleteFiles) freed = removeTaskFile(task);

  downloadTasks.splice(taskIndex, 1);
  // Gỡ khỏi hàng đợi
  const qIndex = downloadQueue.findIndex((t) => t.id === taskId);
  if (qIndex !== -1) downloadQueue.splice(qIndex, 1);

  saveDownloadTasks();
  return { success: true, freed };
});

ipcMain.handle('delete-tasks', async (event, taskIds, options) => {
  if (!Array.isArray(taskIds) || taskIds.length === 0) return { success: false, error: 'Không có tác vụ nào cần xóa' };
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
    if (task.cancelSource) { try { task.cancelSource.cancel('Người dùng xóa tác vụ'); } catch (_) {} }
    if (task.writer) { try { task.writer.end(); } catch (_) {} }
  }
  downloadTasks.splice(taskIndex, 1);
  const qIndex = downloadQueue.findIndex((t) => t.id === taskId);
  if (qIndex !== -1) downloadQueue.splice(qIndex, 1);
}

/**
 * Xóa toàn bộ tệp trên máy của một phim (kể cả tệp đã gộp), và dọn bản ghi tác vụ tương ứng.
 * Hồ sơ phim vẫn được giữ (vẫn thấy danh sách tập, vẫn phát trực tuyến được), chỉ chuyển thành "chưa tải".
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
        console.warn('[Clean] Xóa thất bại:', p, e.message);
      }
      // Tiện thể dọn các tệp tạm có thể còn sót
      try {
        const tmp = p + '.enc.tmp';
        if (fs.existsSync(tmp)) { freed += fs.statSync(tmp).size; fs.unlinkSync(tmp); }
      } catch (_) {}
    }

    // Tệp đã gộp (Bản gộp.mp4, kể cả tên bản cũ) và danh sách concat còn sót
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
        const isMerged = includeMerged && f.endsWith('.mp4') && isMergedName(f);
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
      // Thư mục trống thì xóa luôn
      try {
        if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
      } catch (_) {}
    }

    // Dọn bản ghi tác vụ và bộ nhớ đệm trực tuyến
    const ids = downloadTasks
      .filter((t) => t.hongguoInfo && String(t.hongguoInfo.series_id) === sid)
      .map((t) => t.id);
    if (ids.length) dropTaskRecords(ids);
    for (const [vid, e] of [...onlineCache]) {
      if (String(e.seriesId) === sid) onlineCache.delete(vid);
    }

    console.log(`[Clean] Đã xóa ${count} tệp cục bộ của 《${title}》, giải phóng ${(freed / 1048576).toFixed(1)}MB`);
    return { success: true, count, freed, failed };
  } catch (error) {
    console.error('[Clean] Xóa tệp phim thất bại:', error.message);
    return { success: false, error: error.message };
  }
});

/** Xóa tệp trên máy của một tập (dùng cho tính năng xem xong thì xóa) */
ipcMain.handle('delete-episode-file', async (event, seriesId, vidIndex) => {
  try {
    const sid = String(seriesId);
    const idx = Number(vidIndex);
    const paths = seriesFilePaths(sid).filter((p) => {
      const m = p.match(EP_FILE_RE);
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

/** Thống kê dung lượng đĩa đang dùng ở các nơi (để hiển thị "giải phóng được bao nhiêu") */
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
      // Tệp đã gộp
      let merged = 0;
      let mergedBytes = 0;
      try {
        const c = collectSeriesEpisodeFiles(s.series_id, s.series_title);
        if (c.dir && fs.existsSync(c.dir)) {
          for (const f of fs.readdirSync(c.dir)) {
            if (f.endsWith('.mp4') && isMergedName(f)) {
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

/** Xóa mọi tệp đã tải về máy (giữ hồ sơ phim, sau này vẫn xem trực tuyến được) */
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
            if (f.endsWith('.mp4') && isMergedName(f)) {
              const p = path.join(c.dir, f);
              freed += fs.statSync(p).size; fs.unlinkSync(p); count++;
            }
          }
        }
      } catch (_) {}
    }
    // Xóa hết bản ghi, và làm trống bộ nhớ đệm trực tuyến
    dropTaskRecords(downloadTasks.map((t) => t.id));
    clearOnlineCache();
    return { success: true, count, freed };
  } catch (error) {
    return { success: false, error: error.message };
  }
});


ipcMain.handle('stop-download', async (event, taskId) => {
  const task = downloadTasks.find((t) => t.id === taskId);
  if (!task) return { success: false, error: 'Tác vụ không tồn tại' };

  task.cancelled = true;
  if (task.cancelSource) { try { task.cancelSource.cancel('Người dùng dừng tải xuống'); } catch (_) {} }
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
  if (!task) return { success: false, error: 'Tác vụ không tồn tại' };

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
  if (!Array.isArray(taskIds) || taskIds.length === 0) return { success: false, error: 'Không có tác vụ nào cần thử lại' };
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

// ===== IPC: Bắt đầu tất cả / Tạm dừng tất cả =====
ipcMain.handle('pause-all', async () => ({ success: true, count: pauseAllTasks() }));

ipcMain.handle('resume-all', async () => ({ success: true, count: resumeAllTasks() }));

// Trạng thái hàng đợi theo thời gian thực (để giao diện hiển thị "đang chạy x/giới hạn song song")
ipcMain.handle('get-queue-status', async () => ({
  active: activeDownloads,
  queued: downloadQueue.length,
  maxConcurrent: MAX_CONCURRENT_DOWNLOADS,
}));

ipcMain.handle('open-folder', async (event, taskId) => {
  const task = downloadTasks.find((t) => t.id === taskId);
  if (!task) return { success: false, error: 'Tác vụ không tồn tại' };

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
  return { success: false, error: 'Thư mục không tồn tại' };
});

// ===== Thông tin ứng dụng =====
ipcMain.handle('get-app-info', async () => ({
  version: APP_VERSION,
  brand: APP_TITLE,
  appName: 'Trình tải phim ngắn Hongguo',
}));

// Mở link bên ngoài (để dành gọi khi cần)
ipcMain.handle('open-external-url', async (event, url) => {
  if (!url) return { success: false, error: 'Thiếu liên kết' };
  try {
    await shell.openExternal(url);
    return { success: true };
  } catch (err) {
    console.error('[Shell] Mở liên kết thất bại:', err.message);
    return { success: false, error: err.message };
  }
});

// ===== Tạo cửa sổ =====
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

  // Chế độ phát triển tải vite dev server, chế độ production tải bản đã đóng gói
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

// ===== Vòng đời ứng dụng =====
app.whenReady().then(async () => {
  const dataFile = path.join(app.getPath('userData'), 'data.json');
  store.init(dataFile);
  loadDownloadTasks();
  loadSeriesRegistry();
  rebuildSeriesRegistryFromTasks();
  // Bản ghi tác vụ có thể bị thiếu (bị xóa/giữa các phiên), khôi phục từ đĩa để danh sách tải khớp với tệp
  try { rescanDownloadsFromDisk(); } catch (e) { console.warn('[Rescan] Khôi phục bản ghi khi khởi động thất bại:', e.message); }
  loadMergeTasks();
  registerStreamProtocol();
  registerLocalProtocol();
  const settings = getCurrentSettings();

  // Proxy phải có hiệu lực trước khi tạo cửa sổ và gửi bất kỳ request nào
  await applyProxySettings(settings);

  // Sau khi khởi động tự chạy tiếp các tác vụ "đang chờ" (hàng đợi chưa tải xong lần trước), không cần bấm Bắt đầu thủ công
  const resumed = enqueuePendingTasks();
  if (resumed > 0) {
    console.log(`[Queue] Tự động tiếp tục ${resumed} tác vụ đang chờ khi khởi động, số luồng đồng thời ${MAX_CONCURRENT_DOWNLOADS}`);
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
