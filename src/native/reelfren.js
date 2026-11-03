/**
 * reelfren.js - nguồn dữ liệu thứ hai: lấy phim ngắn PineDrama (do TikTok sản xuất) qua API của reelfren
 *
 * API (đối chiếu plugin ReelFren của TJ-Plugins, đo thực tế 2026-11-03):
 *   Danh sách: /api/home?provider=pinedrama&category=0|1&offset=0&lang=vi -> { data: [{ id, title, cover, intro, episodes }] }
 *   Tìm kiếm : /api/search?provider=pinedrama&q=Q&lang=vi&offset=0        -> { data, hasMore } (mỗi trang 20 phim)
 *   Phát     : /api/video?provider=P&id=ID&ep=N&lang=vi&server=1&cv=v21
 *          -> { title, totalEpisodes, locked, videoUrl, qualityList, kid? }, link trực tiếp là MP4 không mã hóa, không cần giải mã
 * Trang web reelfren.net bị thử thách Cloudflare chặn, nhưng API trên các host dưới đây vẫn lấy thẳng được JSON.
 *
 * ID nội bộ (phân biệt với ID toàn số của Hongguo, và dùng thẳng được làm tên file):
 *   series_id = rf-<provider>-<id>      vid = rf-<provider>-<id>-<số tập>
 */
const axios = require('axios');

const HOSTS = ['https://www.reelfren.com', 'https://api.reelfren.net'];
const PROVIDER = 'pinedrama';
const LANG = 'vi';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const PREFIX = 'rf-';

// Ảnh bìa đã thấy trong danh sách (/api/video không trả về ảnh bìa)
const coverCache = new Map();

const owns = (id) => String(id || '').startsWith(PREFIX);

function parseId(id) {
  const m = String(id).match(/^rf-([a-z0-9]+)-([^-]+)(?:-(\d+))?$/);
  if (!m) throw new Error('ID reelfren không hợp lệ: ' + id);
  return { provider: m[1], id: m[2], ep: m[3] ? Number(m[3]) : 0 };
}

/** Thử lần lượt từng host; lỗi mạng / không phải 200 / không phải JSON (như trang Cloudflare) thì chuyển sang host kế tiếp */
async function getJson(pathAndQuery) {
  let lastErr;
  for (const host of HOSTS) {
    try {
      const { data } = await axios.get(host + pathAndQuery, {
        headers: { 'User-Agent': UA, Accept: 'application/json', Referer: host + '/' },
        timeout: 20000,
      });
      if (data && typeof data === 'object') return data;
      lastErr = new Error('phản hồi không phải JSON');
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error('reelfren không phản hồi: ' + (lastErr && lastErr.message));
}

function toCard(d) {
  const series_id = `${PREFIX}${d.provider || PROVIDER}-${d.id}`;
  if (d.cover) coverCache.set(series_id, d.cover);
  return {
    series_id,
    series_title: d.title || '',
    cover: d.cover || '',
    episode_count: Number(d.episodes) || 0,
    tags: String(d.intro || '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 4),
  };
}

const uniqueCards = (items) => [...new Map(items.map((d) => [String(d.id), d])).values()].map(toCard);

/** Trang chủ PineDrama chỉ có hai mục (category 0/1), offset không có tác dụng nên chỉ có một trang */
async function listHome() {
  const pages = await Promise.all(['0', '1'].map((c) =>
    getJson(`/api/home?provider=${PROVIDER}&category=${c}&offset=0&lang=${LANG}`).catch(() => null)));
  if (pages.every((p) => !p)) throw new Error('reelfren không phản hồi');
  return uniqueCards(pages.flatMap((p) => (p && p.data) || []));
}

async function search(keyword) {
  const j = await getJson(`/api/search?provider=${PROVIDER}&q=${encodeURIComponent(keyword)}&lang=${LANG}&offset=0`);
  return uniqueCards(j.data || []);
}

async function videoInfo(provider, id, ep) {
  const j = await getJson(`/api/video?provider=${provider}&id=${encodeURIComponent(id)}&ep=${ep}&lang=${LANG}&server=1&cv=v21`);
  if (j.error) throw new Error(String(j.error));
  return j;
}

/**
 * Danh sách tập: /api/video trả về tổng số tập. Tên phim cũng lấy ở đây — nó ổn định giữa các tập,
 * còn tên phim trong danh sách đôi khi là một bản dịch khác, dùng nó sẽ khiến tên thư mục tải về không thống nhất.
 * Tập 1 đôi khi bị 502 tạm thời; nếu lỗi thì lấy lại bằng tập 2.
 */
async function fetchEpisodeList(seriesId) {
  const sid = String(seriesId);
  const { provider, id } = parseId(sid);
  let info;
  try {
    info = await videoInfo(provider, id, 1);
  } catch (e) {
    info = await videoInfo(provider, id, 2);
  }
  const total = Number(info.totalEpisodes) || 1;
  const title = info.title || 'Phim chưa đặt tên';
  const cover = coverCache.get(sid) || '';
  const episodes = Array.from({ length: total }, (_, i) => ({
    vid: `${sid}-${i + 1}`,
    vid_index: i + 1,
    title: '',
    series_id: sid,
    series_title: title,
    cover,
  }));
  return { series_id: sid, series_title: title, cover, total, episodes, source: 'reelfren' };
}

/** Cùng dạng với hongguo.fetchPlayUrlSingle: spadeA rỗng nghĩa là MP4 không mã hóa, bên gọi bỏ qua bước giải mã */
async function fetchPlayUrlSingle(vid) {
  try {
    const { provider, id, ep } = parseId(vid);
    const info = await videoInfo(provider, id, ep || 1);
    // File mã hóa kiểu Melolo chỉ giải mã để phát được trên web, tải về sẽ là file hỏng
    if (info.kid) return { url: null, spadeA: null, codec: null, error: 'tập này bị mã hóa, chỉ phát được trên web' };
    if (info.locked) return { url: null, spadeA: null, codec: null, error: 'tập này bị khóa' };
    const url = info.videoUrl || ((info.qualityList || []).find((q) => q && q.url) || {}).url;
    if (!url) return { url: null, spadeA: null, codec: null, error: 'reelfren không trả về liên kết video' };
    return { url, spadeA: null, codec: '', source: 'reelfren' };
  } catch (e) {
    return { url: null, spadeA: null, codec: null, error: e.message };
  }
}

/** Dán link reelfren: /drama/<provider>/<id>-slug hoặc /watch/<provider>/<id>-slug */
function seriesIdFromUrl(input) {
  const m = String(input || '').match(/reelfren\.[a-z]+\/(?:drama|watch)\/([a-z0-9]+)\/([^?#/-]+)/i);
  return m ? `${PREFIX}${m[1].toLowerCase()}-${m[2]}` : null;
}

module.exports = { owns, listHome, search, fetchEpisodeList, fetchPlayUrlSingle, seriesIdFromUrl };
