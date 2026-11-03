/**
 * setup-ytdlp.js —— bước chuẩn bị trước khi đóng gói: tải bản phát hành chính thức của yt-dlp vào build/yt-dlp/
 *
 * yt-dlp lo việc tải Bilibili / Ixigua (src/native/ytdlp.js). Không đưa vào quản lý phiên bản;
 * `npm run build` đóng nó vào resources/bin qua extraResources, cạnh ffmpeg.
 * Mặc định lấy yt-dlp.exe (bản Windows để đóng gói); đang phát triển trên macOS/Linux thì lấy thêm bản của máy.
 * Trang web hay đổi cấu trúc, nên khi Bilibili/Ixigua lỗi thì chạy lại script với --force để lấy bản mới nhất.
 *
 * Cách dùng: node scripts/setup-ytdlp.js [--force]
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const DEST = path.resolve(__dirname, '..', 'build', 'yt-dlp');
const BASE = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/';
const LOCAL = { darwin: 'yt-dlp_macos', linux: 'yt-dlp_linux' }[process.platform];
const targets = [['yt-dlp.exe', 'yt-dlp.exe'], ...(LOCAL ? [[LOCAL, 'yt-dlp']] : [])];
const force = process.argv.includes('--force');

function download(url, dest, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 8) return reject(new Error('Quá nhiều lần chuyển hướng'));
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return download(res.headers.location, dest, redirects + 1).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error('HTTP ' + res.statusCode));
      }
      const ws = fs.createWriteStream(dest);
      res.pipe(ws);
      ws.on('finish', resolve);
      ws.on('error', reject);
    }).on('error', reject);
  });
}

(async () => {
  fs.mkdirSync(DEST, { recursive: true });
  for (const [asset, name] of targets) {
    const out = path.join(DEST, name);
    if (!force && fs.existsSync(out)) { console.log('Đã có: ' + out); continue; }
    console.log('Đang tải ' + asset + '…');
    await download(BASE + asset, out + '.tmp');
    fs.renameSync(out + '.tmp', out);
    fs.chmodSync(out, 0o755);
    console.log('  ' + out + '  ' + (fs.statSync(out).size / 1048576).toFixed(1) + 'MB');
  }
})().catch((e) => {
  console.error('Thất bại: ' + e.message);
  console.error('Có thể tự tải yt-dlp.exe từ https://github.com/yt-dlp/yt-dlp/releases rồi đặt vào build/yt-dlp/');
  process.exit(1);
});
