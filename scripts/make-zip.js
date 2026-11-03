/**
 * make-zip.js —— đóng thư mục bản không cần cài đặt thành một file zip "giải nén là dùng"
 *
 * Vì sao không dùng zip target có sẵn của electron-builder:
 *   nó trải thẳng 75 file ra thư mục gốc của file nén, người dùng chọn "giải nén vào thư mục hiện tại"
 *   là file vương vãi khắp nơi. Ở đây bọc thêm một thư mục cấp trên đặt theo tên sản phẩm.
 *
 * Cách làm: tạm đổi tên win-unpacked thành tên thư mục đích -> nén -> đổi lại như cũ.
 *   Đổi tên diễn ra tức thì, không phải chép 400MB, cũng không tốn thêm dung lượng đĩa.
 *
 * Đầu ra: dist/<tên sản phẩm>-<phiên bản>-win-x64.zip
 *   └── <tên sản phẩm>-<phiên bản>/  ← giải nén ra là một thư mục hoàn chỉnh, nhấp đúp file exe bên trong là dùng
 *
 * Lưu ý (lỗi đã gặp khi chạy thực tế):
 *   trên Node 24 ở máy này, gọi fs.rmSync(file, {force:true}) với file zip ~158MB đó
 *   sẽ làm tiến trình sập ngay (exit 0xC0000409), không bắt được lỗi và finally không chạy.
 *   Vì vậy ở đây xóa file luôn dùng fs.unlinkSync, xóa thư mục thì dùng PowerShell ở tiến trình riêng,
 *   và ngay đầu script tự khắc phục "phần sót lại từ lần sập trước".
 *
 * Cách dùng:
 *   node scripts/make-zip.js                (cần có sẵn dist/win-unpacked)
 *   npm run build:zip                       (tự build trước rồi đóng gói)
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const SRC = path.join(DIST, 'win-unpacked');

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const PRODUCT = (pkg.build && pkg.build.productName) || pkg.name;
const VERSION = pkg.version;

const FOLDER_NAME = `${PRODUCT}-${VERSION}`;
const ZIP_PATH = path.join(DIST, `${PRODUCT}-${VERSION}-win-x64.zip`);
const STAGED = path.join(DIST, FOLDER_NAME);

function find7za() {
  const candidates = [
    path.join(ROOT, 'node_modules', '7zip-bin', 'win', 'x64', '7za.exe'),
    path.join(ROOT, 'node_modules', '7zip-bin', 'win', 'ia32', '7za.exe'),
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  return null;
}

/** Xóa file: dùng unlinkSync (rmSync làm sập tiến trình trên máy này) */
function safeUnlink(p) {
  try {
    if (fs.existsSync(p)) fs.unlinkSync(p);
    return true;
  } catch (e) {
    console.warn('[zip] Xóa file thất bại: ' + p + ' — ' + e.message);
    return false;
  }
}

/** Xóa thư mục: giao cho PowerShell ở tiến trình riêng để tránh sập tiến trình chính */
function safeRemoveDir(dir) {
  if (!fs.existsSync(dir)) return true;
  try {
    execFileSync('powershell', [
      '-NoProfile', '-Command',
      `Remove-Item -LiteralPath '${dir}' -Recurse -Force -ErrorAction SilentlyContinue`,
    ], { stdio: 'ignore' });
    return !fs.existsSync(dir);
  } catch (e) {
    console.warn('[zip] Xóa thư mục thất bại: ' + dir + ' — ' + e.message);
    return false;
  }
}

function main() {
  // ---- Tự khắc phục: nếu lần trước sập sau khi đổi tên, tên thư mục sẽ kẹt ở PRODUCT-VERSION ----
  if (!fs.existsSync(SRC) && fs.existsSync(STAGED)) {
    console.log('[zip] Phát hiện thư mục sót lại do lần trước thoát bất thường, đang đổi lại thành win-unpacked…');
    fs.renameSync(STAGED, SRC);
  }
  // Nếu thực sự là thư mục sót lại trùng tên (cả hai cùng tồn tại) thì xóa thư mục sót lại
  if (fs.existsSync(SRC) && fs.existsSync(STAGED)) {
    console.log('[zip] Dọn thư mục sót lại trùng tên: ' + FOLDER_NAME);
    safeRemoveDir(STAGED);
  }

  if (!fs.existsSync(SRC)) {
    console.error('[zip] Không tìm thấy ' + SRC);
    console.error('[zip] Hãy chạy trước: npx electron-builder --win --dir');
    process.exit(1);
  }

  console.log('[zip] Chuẩn bị đóng gói: ' + PRODUCT + ' ' + VERSION);

  let renamed = false;
  try {
    // Xóa zip cũ (unlinkSync, tránh rmSync làm sập)
    if (fs.existsSync(ZIP_PATH)) {
      console.log('[zip] Đang xóa file zip cũ…');
      if (!safeUnlink(ZIP_PATH)) throw new Error('Xóa zip cũ thất bại (có thể file đang bị chiếm dụng)');
    }

    fs.renameSync(SRC, STAGED); // Xong tức thì
    renamed = true;
    console.log('[zip] Đã tạm đổi tên win-unpacked thành ' + FOLDER_NAME);

    const sevenZip = find7za();
    if (sevenZip) {
      console.log('[zip] Đang nén (7-Zip)…');
      // Chạy trong thư mục dist để file nén chứa luôn thư mục cấp trên
      execFileSync(sevenZip, ['a', '-tzip', '-mx=5', '-bso0', '-bsp0', ZIP_PATH, FOLDER_NAME], {
        cwd: DIST,
        stdio: 'inherit',
      });
    } else {
      console.log('[zip] Đang nén (PowerShell Compress-Archive)…');
      execFileSync(
        'powershell',
        ['-NoProfile', '-Command',
         `Compress-Archive -LiteralPath '${STAGED}' -DestinationPath '${ZIP_PATH}' -Force`],
        { stdio: 'inherit' }
      );
    }

    if (!fs.existsSync(ZIP_PATH)) throw new Error('Nén xong nhưng không tạo ra file');

    const size = fs.statSync(ZIP_PATH).size;
    console.log('[zip] Hoàn tất: ' + ZIP_PATH);
    console.log('[zip]   Dung lượng: ' + (size / 1048576).toFixed(1) + ' MB');
    console.log('[zip]   Thư mục cấp trên sau khi giải nén: ' + FOLDER_NAME + '/ (nhấp đúp file exe bên trong là dùng)');
  } finally {
    // Dù thành công hay thất bại đều đổi tên thư mục lại, tránh ảnh hưởng các lần build --dir sau
    if (renamed && fs.existsSync(STAGED) && !fs.existsSync(SRC)) {
      try {
        fs.renameSync(STAGED, SRC);
        console.log('[zip] Đã khôi phục tên thư mục thành win-unpacked');
      } catch (e) {
        console.warn('[zip] Khôi phục tên thư mục thất bại (lần chạy sau sẽ tự sửa): ' + e.message);
      }
    }
  }
}

try {
  main();
} catch (e) {
  console.error('[zip] Đóng gói thất bại: ' + (e && e.message ? e.message : e));
  process.exit(1);
}
