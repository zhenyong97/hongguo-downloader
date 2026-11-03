/**
 * scripts/dev.js - trình khởi chạy chế độ phát triển
 *
 * Trước khi khởi chạy, kiểm tra cổng có bị chiếm không:
 *   - Cổng trống: dùng luôn
 *   - Cổng bị chiếm: tự động chuyển sang cổng trống kế tiếp (và thông báo rõ)
 * Sau đó khởi chạy server phát triển Vite, đợi sẵn sàng rồi mở cửa sổ Electron.
 */
const { spawn } = require('child_process');
const net = require('net');
const path = require('path');

const PREFERRED_PORT = 5173; // Giữ khớp với vite.config.js

// Kiểm tra cổng có bị chiếm không (trả về true = bị chiếm)
function checkPort(port) {
  return new Promise((resolve) => {
    const s = net.createConnection({ port, host: '127.0.0.1' });
    s.on('connect', () => { s.destroy(); resolve(true); });
    s.on('error', () => resolve(false));
  });
}

// Tìm cổng trống kế tiếp, bắt đầu từ start
async function findFreePort(start) {
  let port = start;
  while (await checkPort(port)) port++;
  return port;
}

// Đợi cổng sẵn sàng (Vite khởi chạy xong)
function waitPortReady(port, timeoutMs = 30000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      checkPort(port).then((busy) => {
        if (busy) {
          clearInterval(timer);
          resolve();
        } else if (Date.now() - start > timeoutMs) {
          clearInterval(timer);
          reject(new Error('Hết thời gian chờ Vite khởi chạy'));
        }
      });
    }, 300);
  });
}

async function main() {
  const occupied = await checkPort(PREFERRED_PORT);
  const port = occupied ? await findFreePort(PREFERRED_PORT + 1) : PREFERRED_PORT;

  if (occupied) {
    console.log(`\n[Kiểm tra khởi chạy] Cổng ${PREFERRED_PORT} đã bị chiếm, tự động chuyển sang cổng ${port}\n`);
  } else {
    console.log(`\n[Kiểm tra khởi chạy] Cổng ${PREFERRED_PORT} đang trống, khởi chạy bình thường\n`);
  }

  // 1. Khởi chạy server phát triển Vite (strictPort đảm bảo dùng đúng cổng đã chọn)
  const vite = spawn('npx', ['vite', '--port', String(port), '--strictPort', '--host', '127.0.0.1'], {
    shell: true,
    stdio: 'inherit',
    env: { ...process.env },
  });

  vite.on('error', (e) => {
    console.error('[Khởi chạy thất bại] Không thể khởi chạy Vite:', e.message);
    process.exit(1);
  });

  // 2. Đợi Vite sẵn sàng rồi khởi chạy Electron
  try {
    await waitPortReady(port);
  } catch (e) {
    console.error('[Khởi chạy thất bại]', e.message);
    vite.kill();
    process.exit(1);
  }

  const electron = spawn('npx', ['electron', '.'], {
    shell: true,
    stdio: 'inherit',
    env: { ...process.env, VITE_DEV_SERVER_URL: `http://localhost:${port}` },
  });

  const cleanup = () => {
    try { vite.kill(); } catch (_) {}
    try { electron.kill(); } catch (_) {}
    process.exit(0);
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  electron.on('exit', () => cleanup());
}

main().catch((e) => {
  console.error('[Khởi chạy thất bại]', e);
  process.exit(1);
});
