/**
 * 验证 reelfren 数据源全链路：列表 -> 搜索 -> 分集 -> 播放直链 -> 直链能下到 MP4
 * 用法: node scripts/verify-reelfren.js
 */
const assert = require('assert');
const axios = require('axios');
const reelfren = require('../src/native/reelfren');
const hongguo = require('../src/native/hongguo');

(async () => {
  // 离线部分：ID / 链接解析
  assert.ok(reelfren.owns('rf-pinedrama-123') && !reelfren.owns('7645222653694856254'));
  assert.strictEqual(
    reelfren.seriesIdFromUrl('https://reelfren.net/drama/pinedrama/7643719580606632977-khac-tinh?lang=vi'),
    'rf-pinedrama-7643719580606632977'
  );
  assert.strictEqual(reelfren.seriesIdFromUrl('https://hongguoduanju.com/detail?series_id=1'), null);

  const list = await reelfren.listHome();
  assert.ok(list.length > 0, 'danh sách trống');
  console.log(`listHome: ${list.length} phim, ví dụ «${list[0].series_title}» ${list[0].episode_count} tập`);

  const found = await reelfren.search('Tổng tài');
  assert.ok(found.length > 0, 'tìm kiếm trống');
  console.log(`search: ${found.length} phim`);

  const data = await reelfren.fetchEpisodeList(list[0].series_id);
  assert.ok(data.total > 0 && data.episodes[0].vid === `${data.series_id}-1`);
  console.log(`fetchEpisodeList: «${data.series_title}» ${data.total} tập`);

  const vid = data.episodes[Math.min(1, data.total - 1)].vid;
  const play = await reelfren.fetchPlayUrlSingle(vid);
  assert.ok(play.url, 'không có link: ' + play.error);
  assert.strictEqual(play.spadeA, null);

  // 用下载器实际用的 UA 取前 2KB，确认是 MP4（ftyp）
  const res = await axios.get(play.url, {
    headers: { 'User-Agent': hongguo.UA, Range: 'bytes=0-2047' },
    responseType: 'arraybuffer',
    timeout: 30000,
  });
  const head = Buffer.from(res.data);
  assert.strictEqual(head.subarray(4, 8).toString('latin1'), 'ftyp', 'không phải MP4');
  console.log(`video ${vid}: HTTP ${res.status}, ${res.headers['content-range'] || res.headers['content-length']}, MP4 OK`);
  console.log('OK');
})().catch((e) => {
  console.error('FAIL:', e.message);
  process.exit(1);
});
