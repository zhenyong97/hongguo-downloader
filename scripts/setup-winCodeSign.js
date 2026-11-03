/**
 * setup-winCodeSign.js —— chuẩn bị môi trường trước khi đóng gói cho Windows
 *
 * Bối cảnh:
 *   khi đóng gói cho Windows, electron-builder sẽ tải winCodeSign-2.6.0.7z, trong đó có hai
 *   symlink dành cho macOS (darwin/10.12/lib/libcrypto.dylib, libssl.dylib).
 *   7-Zip tạo symlink trên Windows cần quyền quản trị viên hoặc bật "Developer Mode",
 *   nếu không có quyền quản trị, 7za sẽ kết thúc với mã thoát 2, electron-builder thử lại nhiều lần rồi hủy đóng gói.
 *
 * Script này làm gì:
 *   dùng app-builder có sẵn trong electron-builder để giải nén file nén đó vào một **thư mục cố định**,
 *   sau đó kết hợp với bản vá nhỏ trong node_modules (basename sẽ thêm .dsh-bak) là bỏ qua được việc giải nén lại.
 *   Lưu ý: muốn tạo lại thì hãy đổi tên bản sao lưu .dsh-bak về tên gốc trước.
 *
 * Cách dùng:
 *   node scripts/setup-winCodeSign.js
 *   sau đó chạy bình thường: npm run build
 */
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CACHE = path.join(ROOT, '.eb-cache');
const LOCK = path.join(CACHE, 'winCodeSign', 'winCodeSign-2.6.0');
const APP_BUILDER = path.join(ROOT, 'node_modules', 'app-builder-bin', 'win', 'x64', 'app-builder.exe');

const MIRROR =
  process.env.ELECTRON_BUILDER_BINARIES_MIRROR ||
  'https://registry.npmmirror.com/-/binary/electron-builder-binaries/';
const URL = `${MIRROR}winCodeSign-2.6.0/winCodeSign-2.6.0.7z`;

if (process.platform !== 'win32') {
  console.log('Không phải Windows, không cần bước này.');
  process.exit(0);
}

if (fs.existsSync(path.join(LOCK, 'windows-10', 'x64', 'signtool.exe'))) {
  console.log('winCodeSign đã sẵn sàng: ' + LOCK);
  process.exit(0);
}

fs.mkdirSync(CACHE, { recursive: true });

console.log('Đang giải nén winCodeSign (lỗi bỏ qua symlink macOS không ảnh hưởng tới file Windows)...');

// app-builder cần có 7za trong PATH; khi chạy electron-builder thì lớp JS tự chèn vào, ở đây bổ sung thủ công
const sevenZipDir = path.join(ROOT, 'node_modules', '7zip-bin', 'win', 'x64');
const env = {
  ...process.env,
  ELECTRON_BUILDER_CACHE: CACHE + path.sep,
  PATH: sevenZipDir + path.delimiter + (process.env.PATH || ''),
};

execFile(
  APP_BUILDER,
  ['download-artifact', '--name', 'winCodeSign', '--url', URL],
  { cwd: ROOT, env },
  (err, stdout, stderr) => {
    // Lưu ý: hai symlink macOS đó khiến 7za trả về mã thoát 2, nên app-builder coi là thất bại
    // và giữ lại thư mục tạm có tên ngẫu nhiên; nhưng các file Windows cần thực ra đã được giải nén đầy đủ.
    // Vì vậy ở đây không thoát ngay khi có err, mà kiểm tra theo nội dung thư mục.
    const parent = path.join(CACHE, 'winCodeSign');
    if (!fs.existsSync(parent)) {
      console.error('Thư mục giải nén không tồn tại, output của app-builder:');
      console.error(stderr || stdout || (err && err.message));
      process.exit(1);
    }

    const isUsable = (d) =>
      fs.existsSync(path.join(d, 'windows-10', 'x64', 'signtool.exe')) &&
      fs.existsSync(path.join(d, 'rcedit-x64.exe'));

    // Tên thư mục ngẫu nhiên có thể toàn số hoặc dạng khác; thống nhất lọc theo nội dung
    const dirs = fs
      .readdirSync(parent, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => path.join(parent, d.name));

    const complete = dirs.find(isUsable);
    if (!complete) {
      console.error('Không tìm thấy thư mục giải nén đầy đủ, output của app-builder:');
      console.error(stderr || stdout || (err && err.message));
      console.error('Các thư mục con hiện có: ' + dirs.join(', '));
      process.exit(1);
    }

    fs.rmSync(LOCK, { recursive: true, force: true });
    fs.cpSync(complete, LOCK, { recursive: true });
    dirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true }));
    fs.readdirSync(parent)
      .filter((f) => f.endsWith('.7z'))
      .forEach((f) => fs.rmSync(path.join(parent, f), { force: true }));

    console.log('Hoàn tất: ' + LOCK);
  }
);
