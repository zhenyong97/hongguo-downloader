/**
 * prepare-release-assets.js —— chuẩn bị asset có tên file ASCII cho GitHub Release
 *
 * Vì sao cần:
 *   tên file sản phẩm đóng gói cục bộ có thể chứa ký tự không phải ASCII (lấy theo build.productName trong package.json),
 *   nhưng API asset của GitHub Release sẽ lọc bỏ thẳng các ký tự không phải ASCII trong tên file,
 *   làm tên file bị hỏng, ví dụ tên toàn chữ Hán thành "-1.0.0-win-x64.zip" (cả gh CLI lẫn gọi API trực tiếp đều vậy).
 *   Vì vậy trước khi upload, chép sản phẩm sang tên file ASCII.
 *
 * Đầu ra: dist/release/<tên file ascii>
 * Cách dùng:
 *   node scripts/prepare-release-assets.js
 *   gh release create v1.0.0 --title "..." --notes-file notes.md dist/release/*
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const OUT = path.join(DIST, 'release');

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const VERSION = pkg.version;
const SLUG = pkg.name; // hongguo-downloader
const BUILD = pkg.build || {};
const PRODUCT = BUILD.productName || pkg.name;
// Tên file do electron-builder sinh ra theo artifactName trong package.json
const artifact = (tpl) => tpl.replace('${productName}', PRODUCT).replace('${version}', VERSION).replace('${ext}', 'exe');

// Tên file cục bộ (theo productName, có thể không phải ASCII) -> tên asset Release (ASCII)
const MAP = [
  { from: `${PRODUCT}-${VERSION}-win-x64.zip`, to: `${SLUG}-${VERSION}-win-x64.zip`, desc: 'zip bản không cần cài đặt (khuyên dùng)' },
  { from: artifact(BUILD.nsis.artifactName), to: `${SLUG}-${VERSION}-Setup.exe`, desc: 'Bộ cài NSIS' },
  { from: artifact(BUILD.portable.artifactName), to: `${SLUG}-${VERSION}-portable.exe`, desc: 'Bản di động một file' },
];

function findInDist(name) {
  const p = path.join(DIST, name);
  if (fs.existsSync(p)) return p;
  return null;
}

function main() {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  const done = [];
  const missing = [];

  for (const m of MAP) {
    const src = findInDist(m.from);
    if (!src) { missing.push(m.from); continue; }
    const dst = path.join(OUT, m.to);
    fs.copyFileSync(src, dst); // Sao chép chứ không đổi tên, giữ nguyên sản phẩm gốc trong dist
    done.push({ ...m, size: fs.statSync(dst).size });
  }

  console.log('Đã chuẩn bị asset Release → ' + OUT);
  for (const d of done) {
    console.log(`  ${d.to}`);
    console.log(`      ${(d.size / 1048576).toFixed(1)} MB   (${d.desc})`);
  }
  if (missing.length) {
    console.log('\nKhông tìm thấy các sản phẩm cục bộ sau, hãy đóng gói trước:');
    missing.forEach((m) => console.log('  ' + m));
    console.log('  Có thể chạy: npm run build && npm run build:zip && npm run build:portable');
  }

  console.log('\nBước tiếp theo (ví dụ):');
  console.log(`  gh release create v${VERSION} --title "${PRODUCT} v${VERSION}" \\`);
  console.log(`    --notes-file release-notes.md dist/release/*`);
  console.log('  Hoặc upload bổ sung: gh release upload v' + VERSION + ' dist/release/* --clobber');
}

try { main(); } catch (e) {
  console.error('Thất bại: ' + e.message);
  process.exit(1);
}
