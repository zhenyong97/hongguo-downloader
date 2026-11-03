/**
 * setup-ffmpeg.js —— bước chuẩn bị trước khi đóng gói: tải và đặt sẵn ffmpeg tích hợp
 *
 * Vì sao cần:
 *   tính năng gộp một chạm cần ffmpeg, nhưng nó khá nặng (khoảng 167MB) nên không đưa vào quản lý phiên bản.
 *   Sau khi clone repo, chạy script này một lần là ffmpeg.exe / ffprobe.exe được đặt vào
 *   build/ffmpeg/, sau đó `npm run build` sẽ đóng chúng vào bộ cài qua extraResources.
 *
 * Nếu tải thất bại, cũng có thể tự tải bản essentials từ https://www.gyan.dev/ffmpeg/builds/,
 * rồi chép ffmpeg.exe và ffprobe.exe trong thư mục bin vào
 * build/ffmpeg/ là xong.
 *
 * Cách dùng: node scripts/setup-ffmpeg.js
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const DEST = path.join(ROOT, 'build', 'ffmpeg');
const ZIP = path.join(ROOT, 'build', 'ffmpeg-essentials.zip');
const TMP = path.join(ROOT, 'build', '_ffmpeg_tmp');

const URL =
  process.env.FFMPEG_ZIP_URL ||
  'https://github.com/GyanD/codexffmpeg/releases/download/7.1/ffmpeg-7.1-essentials_build.zip';

function exists(p) {
  try { return fs.existsSync(p) && fs.statSync(p).size > 1024 * 1024; } catch (_) { return false; }
}

function download(url, dest, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 8) return reject(new Error('Quá nhiều lần chuyển hướng'));
    https
      .get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          return download(res.headers.location, dest, redirects + 1).then(resolve, reject);
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error('HTTP ' + res.statusCode));
        }
        const total = parseInt(res.headers['content-length'] || '0', 10);
        let got = 0;
        let lastPct = -1;
        const ws = fs.createWriteStream(dest);
        res.on('data', (c) => {
          got += c.length;
          if (total) {
            const pct = Math.floor((got / total) * 100);
            if (pct >= lastPct + 10) { lastPct = pct; console.log(`  Đang tải ${pct}%`); }
          }
        });
        res.pipe(ws);
        ws.on('finish', () => resolve());
        ws.on('error', reject);
      })
      .on('error', reject);
  });
}

(async () => {
  const ffmpegExe = path.join(DEST, 'ffmpeg.exe');
  const ffprobeExe = path.join(DEST, 'ffprobe.exe');

  // Văn bản giấy phép được commit cùng mã nguồn, ở đây chỉ kiểm tra xem có tồn tại không (yêu cầu tuân thủ giấy phép)
  const requiredLicenses = ['COPYING.GPLv3', 'COPYING.GPLv2', 'COPYING.LGPLv2.1', 'LICENSE.md', 'FFMPEG-NOTICE.txt'];
  const missing = requiredLicenses.filter((f) => !fs.existsSync(path.join(DEST, f)));
  if (missing.length) {
    console.warn('Cảnh báo: build/ffmpeg/ thiếu các file giấy phép sau, hãy bổ sung trước khi phân phối:');
    missing.forEach((f) => console.warn('  - ' + f));
  }

  if (exists(ffmpegExe) && exists(ffprobeExe)) {
    console.log('ffmpeg đã sẵn sàng: ' + DEST);
    return;
  }

  fs.mkdirSync(DEST, { recursive: true });
  fs.mkdirSync(path.dirname(ZIP), { recursive: true });

  console.log('Đang tải ffmpeg essentials (khoảng 88MB)…');
  await download(URL, ZIP);
  console.log('Tải xong: ' + (fs.statSync(ZIP).size / 1048576).toFixed(1) + 'MB');

  console.log('Đang giải nén…');
  fs.rmSync(TMP, { recursive: true, force: true });
  // Trên Windows giải nén bằng PowerShell có sẵn; khi đóng gói chéo trên macOS/Linux thì dùng unzip của hệ thống
  if (process.platform === 'win32') {
    execFileSync('powershell', [
      '-NoProfile', '-Command',
      `Expand-Archive -LiteralPath '${ZIP}' -DestinationPath '${TMP}' -Force`,
    ], { stdio: 'inherit' });
  } else {
    execFileSync('unzip', ['-q', '-o', ZIP, '-d', TMP], { stdio: 'inherit' });
  }

  const find = (dir, name) => {
    let out = null;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isFile() && e.name.toLowerCase() === name) return p;
      if (e.isDirectory()) { const r = find(p, name); if (r) return r; }
    }
    return out;
  };

  const srcFf = find(TMP, 'ffmpeg.exe');
  const srcFp = find(TMP, 'ffprobe.exe');
  if (!srcFf || !srcFp) throw new Error('Không tìm thấy ffmpeg.exe / ffprobe.exe trong file nén');

  fs.copyFileSync(srcFf, ffmpegExe);
  fs.copyFileSync(srcFp, ffprobeExe);

  fs.rmSync(TMP, { recursive: true, force: true });
  fs.rmSync(ZIP, { force: true });

  console.log('Hoàn tất:');
  console.log('  ' + ffmpegExe + '  ' + (fs.statSync(ffmpegExe).size / 1048576).toFixed(1) + 'MB');
  console.log('  ' + ffprobeExe + '  ' + (fs.statSync(ffprobeExe).size / 1048576).toFixed(1) + 'MB');
})().catch((e) => {
  console.error('Thất bại: ' + e.message);
  console.error('Có thể tải thủ công ffmpeg essentials rồi đặt ffmpeg.exe / ffprobe.exe vào build/ffmpeg/');
  process.exit(1);
});
