/**
 * Kiểm tra toàn bộ luồng nguồn yt-dlp: phân tích link -> danh sách tập -> tải một tập Bilibili ra MP4 (có gộp hình + tiếng)
 * Cần build/yt-dlp (node scripts/setup-ytdlp.js) và ffmpeg (trong PATH hoặc truyền đường dẫn qua FFMPEG=...)
 * Cách dùng: node scripts/verify-ytdlp.js [link Bilibili]
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ytdlp = require('../src/native/ytdlp');

const URL = process.argv[2] || 'https://www.bilibili.com/en/video/BV1GrxW6XEw7/?trackid=web_pegasus_0';

(async () => {
  // Phần offline: phân tích ID / link
  assert.ok(ytdlp.owns('yt-bili-BV1GrxW6XEw7') && !ytdlp.owns('rf-pinedrama-1') && !ytdlp.owns('7645222653694856254'));
  assert.strictEqual(await ytdlp.seriesIdFromUrl('https://www.bilibili.com/en/video/BV1GrxW6XEw7/?x=1'), 'yt-bili-BV1GrxW6XEw7');
  assert.strictEqual(await ytdlp.seriesIdFromUrl('https://www.ixigua.com/6996881461559165471?logTag=1'), 'yt-ixigua-6996881461559165471');
  assert.strictEqual(await ytdlp.seriesIdFromUrl('https://novelquickapp.com/s/WGPClz6sw10/'), null);
  // Link rút gọn: cần mạng
  assert.strictEqual(await ytdlp.seriesIdFromUrl('xem nè https://b23.tv/BV1GrxW6XEw7'), 'yt-bili-BV1GrxW6XEw7');

  const sid = await ytdlp.seriesIdFromUrl(URL);
  const data = await ytdlp.fetchEpisodeList(sid);
  assert.ok(data.total > 0 && data.episodes[0].vid === `${sid}-1`);
  console.log(`fetchEpisodeList: «${data.series_title}» ${data.total} tập`);

  ytdlp.options.ffmpeg = process.env.FFMPEG || null;
  const out = path.join(os.tmpdir(), `verify-ytdlp-${Date.now()}.mp4`);
  let last = 0;
  await ytdlp.downloadTo(data.episodes[0].vid, out, {
    onProgress: (got, total) => {
      assert.ok(got >= last, 'tiến độ nhảy lùi');
      last = got;
      if (total) assert.ok(got <= total * 1.05, 'đã tải vượt tổng');
    },
  });
  const head = Buffer.alloc(8);
  const fd = fs.openSync(out, 'r');
  fs.readSync(fd, head, 0, 8, 0);
  fs.closeSync(fd);
  assert.strictEqual(head.subarray(4, 8).toString('latin1'), 'ftyp', 'không phải MP4');
  console.log(`tải xong ${(fs.statSync(out).size / 1048576).toFixed(1)}MB, MP4 OK: ${out}`);
  fs.unlinkSync(out);
  console.log('OK');
})().catch((e) => {
  console.error('FAIL:', e.message);
  process.exit(1);
});
