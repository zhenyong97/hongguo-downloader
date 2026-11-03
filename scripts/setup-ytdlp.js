/**
 * setup-ytdlp.js —— bước chuẩn bị trước khi đóng gói: tải bản phát hành chính thức của yt-dlp vào build/yt-dlp/<os>/
 *
 * yt-dlp lo việc tải Bilibili / Ixigua (src/native/ytdlp.js). Không đưa vào quản lý phiên bản;
 * `npm run build` đóng thư mục build/yt-dlp/win vào resources/bin/yt-dlp qua extraResources, cạnh ffmpeg.
 * Dùng bản dạng thư mục (*.zip), không dùng bản một tệp: bản một tệp phải tự giải nén mỗi lần chạy và bị
 * trình quét virus (Windows Defender / macOS) quét lại, khởi động mất 13-21 giây mỗi tập; bản thư mục ~0,2 giây.
 * Mặc định lấy bản Windows (để đóng gói); đang phát triển trên macOS/Linux thì lấy thêm bản của máy.
 * Trang web hay đổi cấu trúc, nên khi Bilibili/Ixigua lỗi thì chạy lại script với --force để lấy bản mới nhất.
 *
 * Cách dùng: node scripts/setup-ytdlp.js [--force]
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const { execFileSync } = require('child_process');

const DEST = path.resolve(__dirname, '..', 'build', 'yt-dlp');
const BASE = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/';
// Thư mục con đặt theo macro ${os} của electron-builder (win/mac/linux); [tệp phát hành, tệp chạy] phải khớp src/native/ytdlp.js
const BUILDS = {
  win: ['yt-dlp_win.zip', 'yt-dlp.exe'],
  mac: ['yt-dlp_macos.zip', 'yt-dlp_macos'],
  linux: ['yt-dlp_linux.zip', 'yt-dlp_linux'],
};
const LOCAL = { darwin: 'mac', linux: 'linux' }[process.platform];
const targets = ['win', ...(LOCAL ? [LOCAL] : [])];
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
  for (const os of targets) {
    const [asset, exe] = BUILDS[os];
    const dir = path.join(DEST, os);
    if (!force && fs.existsSync(path.join(dir, exe))) { console.log('Đã có: ' + path.join(dir, exe)); continue; }
    console.log('Đang tải ' + asset + '…');
    const zip = path.join(DEST, asset);
    await download(BASE + asset, zip + '.tmp');
    fs.renameSync(zip + '.tmp', zip);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir);
    // tar của macOS và Windows 10+ là bsdtar, đọc được zip; tar GNU trên Linux thì không, nên dùng unzip
    if (process.platform === 'linux') execFileSync('unzip', ['-q', zip, '-d', dir]);
    else execFileSync('tar', ['-xf', zip, '-C', dir]);
    fs.unlinkSync(zip);
    fs.chmodSync(path.join(dir, exe), 0o755);
    console.log('  ' + path.join(dir, exe));
  }
})().catch((e) => {
  console.error('Thất bại: ' + e.message);
  console.error('Có thể tự tải yt-dlp_win.zip từ https://github.com/yt-dlp/yt-dlp/releases rồi giải nén vào build/yt-dlp/win/');
  process.exit(1);
});
