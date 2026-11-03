/**
 * reelfren.js - 第二数据源：经 reelfren 的 API 获取 PineDrama（TikTok 出品）短剧
 *
 * 接口（对照 TJ-Plugins 的 ReelFren 插件，2026-11-03 实测）：
 *   列表 : /api/home?provider=pinedrama&category=0|1&offset=0&lang=vi -> { data: [{ id, title, cover, intro, episodes }] }
 *   搜索 : /api/search?provider=pinedrama&q=Q&lang=vi&offset=0        -> { data, hasMore }（每页 20 部）
 *   播放 : /api/video?provider=P&id=ID&ep=N&lang=vi&server=1&cv=v21
 *          -> { title, totalEpisodes, locked, videoUrl, qualityList, kid? }，直链为明文 MP4，无需解密
 * reelfren.net 网页被 Cloudflare 挑战拦住，但下面这些主机上的 API 可以直接拿到 JSON。
 *
 * 内部 ID（与红果的纯数字 ID 区分，且可直接用于文件名）：
 *   series_id = rf-<provider>-<id>      vid = rf-<provider>-<id>-<集号>
 */
const axios = require('axios');

const HOSTS = ['https://www.reelfren.com', 'https://api.reelfren.net'];
const PROVIDER = 'pinedrama';
const LANG = 'vi';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const PREFIX = 'rf-';

// 列表里见过的封面（/api/video 不返回封面）
const coverCache = new Map();

const owns = (id) => String(id || '').startsWith(PREFIX);

function parseId(id) {
  const m = String(id).match(/^rf-([a-z0-9]+)-([^-]+)(?:-(\d+))?$/);
  if (!m) throw new Error('ID reelfren không hợp lệ: ' + id);
  return { provider: m[1], id: m[2], ep: m[3] ? Number(m[3]) : 0 };
}

/** 依次尝试各主机；网络错误 / 非 200 / 非 JSON（如 Cloudflare 页面）都换下一个 */
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

/** PineDrama 首页只有两栏（category 0/1），offset 不起作用，所以只有一页 */
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
 * 分集列表：/api/video 返回总集数。剧名也取这里——它在各集之间稳定，
 * 而列表里的剧名偶尔是另一种译名，用它会让下载目录名前后不一。
 * 第 1 集偶尔临时 502，失败时改用第 2 集再取一次。
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

/** 与 hongguo.fetchPlayUrlSingle 同形：spadeA 为空表示明文 MP4，调用方跳过解密 */
async function fetchPlayUrlSingle(vid) {
  try {
    const { provider, id, ep } = parseId(vid);
    const info = await videoInfo(provider, id, ep || 1);
    // Melolo 一类的加密文件只能在网页里解密播放，下载下来是坏文件
    if (info.kid) return { url: null, spadeA: null, codec: null, error: 'tập này bị mã hóa, chỉ phát được trên web' };
    if (info.locked) return { url: null, spadeA: null, codec: null, error: 'tập này bị khóa' };
    const url = info.videoUrl || ((info.qualityList || []).find((q) => q && q.url) || {}).url;
    if (!url) return { url: null, spadeA: null, codec: null, error: 'reelfren không trả về liên kết video' };
    return { url, spadeA: null, codec: '', source: 'reelfren' };
  } catch (e) {
    return { url: null, spadeA: null, codec: null, error: e.message };
  }
}

/** 粘贴 reelfren 链接：/drama/<provider>/<id>-slug 或 /watch/<provider>/<id>-slug */
function seriesIdFromUrl(input) {
  const m = String(input || '').match(/reelfren\.[a-z]+\/(?:drama|watch)\/([a-z0-9]+)\/([^?#/-]+)/i);
  return m ? `${PREFIX}${m[1].toLowerCase()}-${m[2]}` : null;
}

module.exports = { owns, listHome, search, fetchEpisodeList, fetchPlayUrlSingle, seriesIdFromUrl };
