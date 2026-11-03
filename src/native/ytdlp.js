/**
 * ytdlp.js - nguồn dữ liệu thứ ba: Bilibili và Ixigua qua yt-dlp (https://github.com/yt-dlp/yt-dlp, giấy phép Unlicense)
 *
 * Không tự viết trình phân tích cho hai trang này: yt-dlp đã lo phần chống bot, chọn chất lượng cao nhất
 * và gộp luồng hình + tiếng riêng (DASH) bằng ffmpeg. Thứ yt-dlp tải về là MP4 hoàn chỉnh, không mã hóa.
 *   Bilibili: không cần đăng nhập vẫn tải được tới 1080p (đo thực tế 2026-11-03, yt-dlp 2026.10.26)
 *   Ixigua / Douyin: yt-dlp cần cookie trình duyệt (không cần đăng nhập), chọn trình duyệt trong Cài đặt
 *
 * ID nội bộ (dùng thẳng được làm tên file):
 *   series_id = yt-<site>-<id>      vid = yt-<site>-<id>-<số phần>
 *   site: bili (id là BV...) | ixigua | douyin (id toàn số). Video nhiều phần (P1, P2...) của Bilibili mỗi phần là một tập.
 */
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { spawn } = require('child_process');

const PREFIX = 'yt-';
const SITES = {
  bili: { re: /bilibili\.com\/(?:[a-z]{2}\/)?video\/(BV[0-9A-Za-z]{10})/i, url: (id) => `https://www.bilibili.com/video/${id}/` },
  ixigua: { re: /ixigua\.com\/(?:video\/)?(\d{8,})/i, url: (id) => `https://www.ixigua.com/${id}` },
  // Link chia sẻ trong app (v.douyin.com) chuyển về iesdouyin.com/share/video/<id>
  douyin: { re: /(?:douyin\.com\/video|iesdouyin\.com\/share\/video)\/(\d{8,})/i, url: (id) => `https://www.douyin.com/video/${id}` },
};

const owns = (id) => String(id || '').startsWith(PREFIX);

function parseId(id) {
  const m = String(id).match(/^yt-([a-z]+)-([0-9A-Za-z]+)(?:-(\d+))?$/);
  if (!m || !SITES[m[1]]) throw new Error('ID yt-dlp không hợp lệ: ' + id);
  return { site: m[1], id: m[2], part: m[3] ? Number(m[3]) : 0 };
}

const SHORT_RE = /https?:\/\/(?:b23\.tv|v\.ixigua\.com|v\.douyin\.com)\/[^\s]+/i;

/** Link rút gọn chỉ là một bước chuyển hướng 302: đọc Location, không tải trang đích */
async function expandShortUrl(input) {
  const m = String(input || '').match(SHORT_RE);
  if (!m) return input;
  const res = await axios.get(m[0], { maxRedirects: 0, validateStatus: (s) => s >= 300 && s < 400, timeout: 15000 });
  return res.headers.location || input;
}

/** Dán link: Bilibili (kể cả bản /en/, link rút gọn b23.tv), Ixigua hoặc Douyin (kể cả v.douyin.com) */
async function seriesIdFromUrl(input) {
  const url = await expandShortUrl(input);
  for (const [site, s] of Object.entries(SITES)) {
    const m = String(url || '').match(s.re);
    if (m) return `${PREFIX}${site}-${m[1]}`;
  }
  // Link rút gọn trỏ tới thứ không phải video (ví dụ v.ixigua.com giờ chuyển sang trang người dùng Douyin): báo rõ thay vì rơi xuống nhánh Hongguo
  if (url !== input) throw new Error('Link rút gọn không trỏ tới một video: ' + String(url).split('?')[0]);
  return null;
}

function resolveBin() {
  const bin = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
  const candidates = [
    // Sau khi đóng gói: resources/bin (cùng chỗ với ffmpeg)
    process.resourcesPath ? path.join(process.resourcesPath, 'bin', bin) : null,
    // Chế độ phát triển: build/yt-dlp trong repo (node scripts/setup-ytdlp.js)
    path.join(__dirname, '..', '..', 'build', 'yt-dlp', bin),
  ];
  return candidates.find((c) => c && fs.existsSync(c)) || 'yt-dlp'; // Cuối cùng để PATH tự phân giải
}

// Do main.js gán từ cài đặt: { ffmpeg, cookiesBrowser }
const options = { ffmpeg: null, cookiesBrowser: '' };

function baseArgs() {
  const a = ['--no-warnings'];
  if (options.cookiesBrowser) a.push('--cookies-from-browser', options.cookiesBrowser);
  return a;
}

/** Chạy yt-dlp, trả về stdout; onLine nhận từng dòng stdout (dùng cho tiến độ) */
function run(args, { onLine, onSpawn } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(resolveBin(), [...baseArgs(), ...args], { windowsHide: true });
    if (onSpawn) onSpawn(child);
    let out = '';
    let err = '';
    let buf = '';
    child.stdout.on('data', (d) => {
      const s = d.toString();
      out += s;
      if (!onLine) return;
      buf += s;
      const lines = buf.split(/\r?\n|\r/);
      buf = lines.pop();
      lines.forEach(onLine);
    });
    child.stderr.on('data', (d) => { err += d.toString(); });
    child.on('error', (e) => reject(new Error(e.code === 'ENOENT' ? 'Không tìm thấy yt-dlp, hãy chạy node scripts/setup-ytdlp.js' : e.message)));
    child.on('close', (code, signal) => {
      if (code === 0) return resolve(out);
      if (signal) return reject(new Error('yt-dlp đã bị dừng'));
      let msg = (err.match(/ERROR: (.*)/) || [])[1] || err.trim().split('\n').pop() || 'mã thoát ' + code;
      msg = msg.replace(/;?\s*please report this issue.*$/i, '');
      if (/cookies/i.test(msg)) {
        msg += options.cookiesBrowser
          ? ` — mở video này trên ${options.cookiesBrowser} (giải captcha nếu có, nên đăng nhập) rồi thử lại ngay`
          : ' — chọn trình duyệt lấy cookie trong Cài đặt';
      }
      reject(new Error('yt-dlp: ' + msg));
    });
  });
}

/** --flat-playlist: video một phần trả về _type=video, nhiều phần trả về playlist với entries ?p=N (không có tiêu đề từng phần) */
async function fetchEpisodeList(seriesId) {
  const sid = String(seriesId);
  const { site, id } = parseId(sid);
  const j = JSON.parse(await run(['-J', '--flat-playlist', SITES[site].url(id)]));
  const title = j.title || 'Phim chưa đặt tên';
  const cover = j.thumbnail || ((j.thumbnails || []).slice(-1)[0] || {}).url || '';
  const total = j._type === 'playlist' ? (j.entries || []).length || 1 : 1;
  const episodes = Array.from({ length: total }, (_, i) => ({
    vid: `${sid}-${i + 1}`,
    vid_index: i + 1,
    title: (j.entries && j.entries[i] && j.entries[i].title) || '',
    series_id: sid,
    series_title: title,
    cover,
  }));
  return { series_id: sid, series_title: title, cover, total, episodes, source: 'ytdlp' };
}

function episodeUrl(vid) {
  const { site, id, part } = parseId(vid);
  const url = SITES[site].url(id);
  return site === 'bili' && part > 1 ? `${url}?p=${part}` : url;
}

/**
 * Tải một tập thẳng ra outPath (yt-dlp tự gộp hình + tiếng bằng ffmpeg).
 * onProgress(received, total); onSpawn(child) để bên gọi có thể dừng tiến trình.
 */
async function downloadTo(vid, outPath, { onProgress, onSpawn } = {}) {
  const args = [
    '-f', 'bv*[vcodec^=avc1]+ba/bv*+ba/b', // Ưu tiên H.264 để máy không có bộ giải mã HEVC/AV1 vẫn phát được
    '--merge-output-format', 'mp4',
    '--force-overwrites', '--newline',
    '--no-playlist', // Phần 1 của video nhiều phần dùng link không có ?p=, thiếu cờ này yt-dlp sẽ tải cả tuyển tập vào một tệp
    '--progress-template', 'download:PROG %(progress.downloaded_bytes)s %(progress.total_bytes,progress.total_bytes_estimate)s',
    '-o', outPath,
  ];
  if (options.ffmpeg) args.push('--ffmpeg-location', options.ffmpeg);
  args.push(episodeUrl(vid));
  // Luồng hình và luồng tiếng tải lần lượt, mỗi luồng đếm lại từ 0: cộng dồn để tiến độ không bị nhảy lùi
  let base = 0;
  let last = { got: 0, total: 0 };
  await run(args, {
    onSpawn,
    onLine: (line) => {
      const m = line.match(/^PROG (\d+) (\d+(?:\.\d+)?|NA)/);
      if (!m || !onProgress) return;
      const cur = { got: Number(m[1]), total: m[2] === 'NA' ? 0 : Math.round(Number(m[2])) };
      if (cur.got < last.got) base += last.total || last.got;
      last = cur;
      onProgress(base + cur.got, cur.total ? base + cur.total : 0);
    },
  });
  if (fs.existsSync(outPath)) return;
  // Không có ffmpeg thì yt-dlp vẫn thoát 0 nhưng để lại hai luồng rời <tên>.f<mã>.mp4/.m4a: dọn đi và báo rõ
  const dir = path.dirname(outPath);
  const stem = path.basename(outPath).replace(/\.mp4$/i, '') + '.f';
  for (const f of fs.readdirSync(dir)) {
    if (f.startsWith(stem)) try { fs.unlinkSync(path.join(dir, f)); } catch (_) {}
  }
  throw new Error('yt-dlp không gộp được hình và tiếng: thiếu ffmpeg');
}

module.exports = { owns, seriesIdFromUrl, fetchEpisodeList, downloadTo, options };
