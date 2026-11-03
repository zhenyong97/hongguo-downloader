const axios = require('axios');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const API = "https://api5-normal-sinfonlineb.fqnovel.com";
const UA = "com.phoenix.read/71532 (Linux; U; Android 9; SM-N9860; Build/PQ3A.190705.10241111;tt-ok/3.12.13.20)";
const VIDEO_REFERER = "https://novelquickapp.com/";

// ===== 官网网页版数据源（官方 App 接口不可用时的兜底）=====
// 官网 player 页是服务端渲染的：完整分集 vid 列表与可直接下载的 MP4 直链
// 都内嵌在 HTML 里，无需任何签名。走的是官网对普通用户开放的同一层。
const SITE_ORIGIN = "https://hongguoduanju.com";
const WEB_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
const WEB_REFERER = SITE_ORIGIN + "/";

const COMMON_QUERY = {
  klink_egdi: "AAI29o4dI-eMiO73_SRSbZ_0By1v3fUSriNeu8-L951MoXhWT88pzj5B",
  iid: "3788260546453235",
  device_id: "538083340353620",
  ac: "wifi",
  channel: "oppo_8662_64",
  aid: "8662",
  app_name: "novelread",
  version_code: "71532",
  version_name: "7.1.5.32",
  device_platform: "android",
  os: "android",
  ssmix: "a",
  device_type: "SM-N9860",
  device_brand: "Samsung",
  language: "zh",
  os_api: "28",
  os_version: "9",
  manifest_version_code: "71532",
  resolution: "900*1600",
  dpi: "320",
  update_version_code: "71532",
  host_abi: "arm64-v8a",
  dragon_device_type: "pad",
  pv_player: "71532",
  compliance_status: "0",
  need_personal_recommend: "1",
  player_so_load: "1",
  is_android_pad_screen: "0",
  rom_version: "PQ3A.190705.10241111+release-keys",
  cdid: "b4f93387-5319-4134-aab9-2cd4e9279b8f",
};

const HEADERS = {
  "User-Agent": UA,
  "Accept-Encoding": "gzip",
  "Accept": "application/json; charset=utf-8,application/x-protobuf",
  "Content-Type": "application/json; charset=utf-8",
  "Host": "api5-normal-sinfonlineb.fqnovel.com",
};

const DETAIL_BIZ_PARAM = {
  detail_page_version: 0,
  disable_digg_stat: false,
  image_shrink_datas_str: "W3siaW1hZ2VfdHlwZSI6MywiaW1hZ2Vfd2lkdGgiOjkwMCwic2hyaW5rX3R5cGUiOjN9LHsiaW1hZ2VfdHlwZSI6NCwiaW1hZ2Vfd2lkdGgiOjcyLCJzaHJpbmtfdHlwZSI6NH1d\n",
  need_all_video_definition: false,
  need_mp4_align: false,
  screen_width_px: "900",
  source: 7,
  use_os_player: false,
  use_server_dns: false,
};

const MODEL_BIZ_PARAM = {
  detail_page_version: 0,
  device_level: 3,
  disable_digg_stat: false,
  need_all_video_definition: true,
  need_mp4_align: false,
  use_os_player: false,
  use_server_dns: false,
  video_platform: 1024,
};

// 熔断：官方接口返回空响应（网关直接丢弃）时，一段时间内不再请求，直接走官网兜底，
// 否则每集都要白等 3 次重试（实测约 13 秒/次）
const API_COOLDOWN_MS = 10 * 60 * 1000;
let apiDownUntil = 0;

/**
 * API 调用封装
 */
async function apiCall(apiPath, body, retries = 3) {
  if (Date.now() < apiDownUntil) throw new Error('đang không phản hồi, tạm bỏ qua');
  const q = { ...COMMON_QUERY, _rticket: Date.now().toString() };
  for (let i = 0; i < retries; i++) {
    const signal = {}; // 供错误信息回溯（HTTP 状态 / 字节数 / CDN logid）
    try {
      const res = await axios.post(API + apiPath, body, {
        params: q,
        headers: HEADERS,
        timeout: 25000,
        // 200 + 空 body 时 axios 会解析成 ''，这里统一按原始字节处理便于判断
        responseType: 'arraybuffer',
        transformResponse: [(d) => d],
      });
      signal.status = res.status;
      signal.logid = res.headers?.['x-tt-logid'];
      const buf = Buffer.from(res.data || []);
      signal.bytes = buf.length;
      if (res.status !== 200) {
        throw new Error(`HTTP ${res.status}`);
      }
      if (buf.length === 0) {
        // 服务端返回 200 但无任何内容：网关在做业务处理前就丢弃了请求
        const err = new Error(
          `API trả về phản hồi rỗng (HTTP 200, 0 byte)${signal.logid ? ' logid=' + signal.logid : ''}`
        );
        err.emptyResponse = true;
        err.detail = signal;
        throw err;
      }
      const text = buf.toString('utf8');
      try {
        return JSON.parse(text);
      } catch (e) {
        const err = new Error(`Phản hồi không phải JSON hợp lệ (HTTP 200, ${buf.length} byte): ${text.slice(0, 100)}`);
        err.detail = signal;
        throw err;
      }
    } catch (err) {
      // 空响应是确定性的拒绝，重试无意义
      if (err.emptyResponse) apiDownUntil = Date.now() + API_COOLDOWN_MS;
      if (i === retries - 1 || err.emptyResponse) {
        if (err.detail === undefined) err.detail = signal;
        throw err;
      }
      await new Promise(r => setTimeout(r, 2000 * (i + 1)));
    }
  }
}

// ===== 官网网页版数据源实现 =====

/** MP4 直链：去掉 HTML 转义并剥掉 Range 头，让 CDN 回整段 */
function normalizeVideoUrl(raw) {
  return String(raw || '')
    .replace(/\\u002F/g, '/')
    .replace(/\\u0026/g, '&')
    .replace(/&amp;/g, '&')
    .replace(/([?&])Range=[^&]*/gi, '$1')
    .replace(/[?&]$/, '');
}

/** 从响应体里安全地取出某个字符串字段 */
function pickJsonString(text, key) {
  const m = text.match(new RegExp('"' + key + '"\\s*:\\s*"([^"]*)"'));
  return m ? m[1].replace(/\\u002F/g, '/').replace(/\\u0026/g, '&') : '';
}

/** 拉取官网页面 HTML */
async function fetchSiteHtml(url) {
  const res = await axios.get(url, {
    headers: {
      'User-Agent': WEB_UA,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9',
      'Referer': WEB_REFERER,
    },
    timeout: 30000,
    responseType: 'text',
    maxRedirects: 5,
  });
  return typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
}

/**
 * 官网兜底：从 player 页内嵌 JSON 取完整分集列表
 * vid_list 按下标即集数顺序（下标 i → 第 i+1 集）
 */
async function fetchEpisodeListFromWeb(seriesId) {
  const html = await fetchSiteHtml(`${SITE_ORIGIN}/player/${encodeURIComponent(seriesId)}`);

  const m = html.match(/"vid_list"\s*:\s*\[([^\]]*)\]/);
  if (!m) throw new Error('Không tìm thấy dữ liệu tập phim (vid_list) trên trang web chính thức');

  const vids = m[1]
    .split(',')
    .map((s) => s.trim().replace(/^"|"$/g, ''))
    .filter((s) => /^\d+$/.test(s));
  if (!vids.length) throw new Error('Danh sách tập trên trang web chính thức trống');

  const seriesTitle = pickJsonString(html, 'series_name') || 'Phim chưa đặt tên';
  const cover = pickJsonString(html, 'series_cover');

  const episodes = vids.map((vid, i) => ({
    vid,
    vid_index: i + 1,
    title: '',
    series_id: String(seriesId),
    series_title: seriesTitle,
    cover,
  }));

  return {
    series_id: String(seriesId),
    series_title: seriesTitle,
    cover: cover || (episodes[0] && episodes[0].cover) || '',
    total: episodes.length,
    episodes,
    source: 'web', // 标记来源，便于排查
  };
}

/**
 * 官网兜底：取单集可直接下载的 MP4 直链
 * 官网页里内嵌的 main_url 是「已经可播」的地址，明文 MP4，无 CENC 加密，
 * 因此不需要 spade_a / 解密这一步。
 * sid 已知时用 /player/{sid}/{vid}；未知时退回 /player/_/{vid} 再自行解析。
 */
async function fetchPlayUrlFromWeb(vid, sid) {
  const candidates = [];
  if (sid) candidates.push(`${SITE_ORIGIN}/player/${encodeURIComponent(sid)}/${encodeURIComponent(vid)}`);
  candidates.push(`${SITE_ORIGIN}/player/_/${encodeURIComponent(vid)}`);

  let lastErr = null;
  for (const url of candidates) {
    try {
      const html = await fetchSiteHtml(url);
      let m = html.match(/"main_url"\s*:\s*"([^"]+)"/);
      if (!m) m = html.match(/"contentUrl"\s*:\s*"([^"]+)"/);
      if (!m) continue;

      const videoUrl = normalizeVideoUrl(m[1]);
      if (!/^https?:\/\//i.test(videoUrl)) continue;
      // 官网对不存在/不公开的分集会回落到剧集默认页（第 1 集），直链里的 vid 不是本集就不能用
      if (!videoUrl.includes(String(vid))) continue;
      return { url: videoUrl, spadeA: null, codec: '', source: 'web' };
    } catch (e) {
      lastErr = e;
    }
  }
  if (lastErr) console.warn('[Web] Lấy liên kết phát trực tiếp thất bại:', lastErr.message);
  return null;
}

/**
 * 分享链接 -> series_id
 */
async function resolveSeriesId(shareUrl) {
  const trimmed = String(shareUrl || '').trim();
  if (/^\d+$/.test(trimmed)) {
    return trimmed;
  }
  const res = await axios.get(trimmed, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Linux; Android 9; SM-N9860) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/88.0.4324.152 Mobile Safari/537.36",
    },
    timeout: 25000,
    maxRedirects: 10,
  });

  const finalUrl = res.request?.res?.responseUrl || res.config?.url || trimmed;
  let m = finalUrl.match(/video_series_id=(\d+)/);
  if (m) return m[1];

  m = finalUrl.match(/schemeParams[^&]*/);
  if (m) {
    const raw = decodeURIComponent(decodeURIComponent(m[0]));
    const jm = raw.match(/"video_id"\s*:\s*"(\d+)"/);
    if (jm) return jm[1];
  }

  const bodyText = typeof res.data === 'string' ? res.data : JSON.stringify(res.data || '');
  m = bodyText.match(/video_series_id=(\d+)/) || bodyText.match(/"video_id"\s*:\s*"(\d+)"/) || bodyText.match(/"series_id"\s*:\s*"(\d+)"/);
  if (m) return m[1];

  throw new Error("Không thể phân tích series_id từ liên kết: " + finalUrl);
}

/**
 * 获取全集剧集列表
 */
async function fetchEpisodeList(seriesId) {
  const body = {
    biz_param: DETAIL_BIZ_PARAM,
    dr_scene: "preload",
    series_id: seriesId,
  };
  let j;
  try {
    j = await apiCall("/novel/player/multi_video_detail/preload/v1", body);
  } catch (e) {
    // 官方 App 接口不可用时，自动降级到官网网页版数据源
    console.warn('[Hongguo] detail API không khả dụng, chuyển sang nguồn dữ liệu trang web chính thức:', e.message);
    try {
      const webData = await fetchEpisodeListFromWeb(seriesId);
      console.log(`[Hongguo] Nguồn dữ liệu trang web chính thức thành công: «${webData.series_title}», tổng ${webData.total} tập`);
      return webData;
    } catch (webErr) {
      throw new Error(
        `Lấy danh sách tập thất bại: API chính thức không khả dụng (${e.message}), phương án dự phòng qua trang web chính thức cũng thất bại (${webErr.message})`
      );
    }
  }
  if (!j || j.code !== 0) {
    throw new Error("detail API thất bại: " + JSON.stringify(j || {}).slice(0, 200));
  }
  const d = j.data || {};
  const sid = Object.keys(d)[0];
  if (!sid) {
    throw new Error("Không lấy được dữ liệu phim");
  }
  const vd = d[sid]?.video_data || {};
  const vl = vd.video_list || [];
  const eps = vl.map((item) => ({
    vid: String(item.vid),
    vid_index: item.vid_index || 0,
    title: item.title || '',
    series_id: String(item.series_id || sid),
    series_title: vd.series_title || '',
    cover: vd.series_cover || vd.cover_url || item.cover_url || '',
  }));
  eps.sort((a, b) => a.vid_index - b.vid_index);
  return {
    series_id: String(sid),
    series_title: vd.series_title || 'Phim chưa đặt tên',
    cover: vd.series_cover || vd.cover_url || (eps[0] && eps[0].cover) || '',
    total: eps.length,
    episodes: eps,
  };
}

/**
 * 单条视频流的清晰度评分
 * 返回 { defNum, pixels, bitrate }，数值越大越清晰
 */
function streamScore(v) {
  const meta = v.video_meta || {};
  const defStr = String(meta.definition || '');
  let defNum = 0;
  const m = defStr.match(/(\d+)\s*p/i);
  if (m) {
    defNum = parseInt(m[1], 10);
  } else {
    const map = { '4k': 2160, '2k': 1440, 'fhd': 1080, 'fullhd': 1080, 'hd': 720, 'sd': 480, 'ld': 360 };
    defNum = map[defStr.toLowerCase()] || 0;
  }
  const w = parseInt(meta.vwidth, 10) || 0;
  const h = parseInt(meta.vheight, 10) || 0;
  const bitrate = parseInt(meta.bitrate || meta.real_bitrate, 10) || 0;
  return { defNum, pixels: w * h, bitrate };
}

/**
 * 解析单个 video_model JSON
 * 选流优先级：清晰度标签 > 像素 > 编码格式 > 码率（取最高分辨率）
 */
function parseModelVideo(vm) {
  if (typeof vm !== 'string') return [null, null, null];
  let vmj;
  try {
    vmj = JSON.parse(vm);
  } catch (e) {
    return [null, null, null];
  }
  const vl = vmj.video_list || [];
  const rank = (codec) => {
    if (['h265', 'h264', 'h265_hvc1', 'hevc', 'hvc1', 'avc1'].includes(codec)) return 0;
    if (codec === 'bytevc1') return 1;
    return 2;
  };
  // 比较两条流：返回 >0 表示 a 更清晰
  const cmp = (a, b) => {
    if (a.defNum !== b.defNum) return a.defNum - b.defNum;
    if (a.pixels !== b.pixels) return a.pixels - b.pixels;
    if (a.codecRank !== b.codecRank) return b.codecRank - a.codecRank; // rank 越小越好
    return a.bitrate - b.bitrate;
  };
  let best = null;
  let bestScore = null;
  for (const v of vl) {
    if (!v.main_url) continue;
    const codec = v.video_meta?.codec_type || '';
    const ei = v.encrypt_info || {};
    const s = { ...streamScore(v), codecRank: rank(codec) };
    if (!bestScore || cmp(s, bestScore) > 0) {
      bestScore = s;
      best = [v.main_url, ei.spade_a || null, codec];
    }
  }
  return best || [null, null, null];
}

/**
 * 获取单集播放直链与 spade_a 加密 key
 */
async function fetchPlayUrlSingle(vid, sid) {
  const body = {
    biz_param: MODEL_BIZ_PARAM,
    dr_scene: "preload",
    mixed_video_id_map: { "1004": [vid] },
  };
  let apiErr = 'không có luồng phát';
  try {
    const j = await apiCall("/novel/player/multi_video_model/preload/v1", body);
    const item = j?.data?.[vid] || {};
    const [url, spadeA, codec] = parseModelVideo(item.video_model);
    if (url) return { url, spadeA, codec, source: 'api' };
  } catch (e) {
    apiErr = e.message;
    // 落到下面的官网兜底
  }
  // 官方 App 接口不可用时，改用官网内嵌的 MP4 直链（明文，无需解密）
  try {
    const web = await fetchPlayUrlFromWeb(vid, sid);
    if (web && web.url) return web;
  } catch (_) {}
  return {
    url: null, spadeA: null, codec: null,
    error: `API ứng dụng: ${apiErr}; trang web không công khai tập này`,
  };
}

/**
 * FFmpeg 兼容 Base64 解码
 */
function avBase64Decode(s) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const table = {};
  for (let i = 0; i < chars.length; i++) table[chars.charCodeAt(i)] = i;
  const dst = [];
  let i = 0;
  while (i + 4 <= s.length) {
    const vals = [];
    let ok = true;
    for (let j = 0; j < 4; j++) {
      const c = s.charCodeAt(i + j);
      if (c in table) {
        vals.push(table[c]);
      } else {
        ok = false;
        break;
      }
    }
    if (!ok) {
      let v = 0;
      for (let j2 = 0; j2 < vals.length; j2++) {
        v = (v << 6) | vals[j2];
      }
      if (vals.length === 3) {
        dst.push((v >> 10) & 0xff);
        dst.push((v >> 2) & 0xff);
      } else if (vals.length === 2) {
        dst.push((v >> 4) & 0xff);
      }
      break;
    }
    const v = (vals[0] << 18) | (vals[1] << 12) | (vals[2] << 6) | vals[3];
    dst.push((v >> 16) & 0xff);
    dst.push((v >> 8) & 0xff);
    dst.push(v & 0xff);
    i += 4;
  }
  return Buffer.from(dst);
}

/**
 * spade_a -> 16 字节 AES Key
 */
function deriveKey(spadeA) {
  if (!spadeA) return null;
  const buf = avBase64Decode(spadeA);
  const L = buf.length;
  if (L < 3) return null;

  const key0 = buf[0] ^ buf[1] ^ buf[2];
  const x27 = key0 - 0x30;
  const w22 = L - key0 + 0x2f;
  if (x27 < 2 || w22 < 2 || w22 > L - 1) return null;

  const x21 = Buffer.from(buf.subarray(1, 1 + w22));
  let w11 = 0x55, w12 = 0xfa, w10 = 0xeb;
  for (let i = 0; i < x21.length; i++) {
    const w13 = x21[i];
    const pc = i.toString(2).split('1').length - 1;
    const w14 = (i & 1) === 0 ? w12 : w11;
    if ((i & 1) === 1) {
      w11 = w13;
    } else {
      w12 = w13;
    }
    const w13_xor = w14 ^ x21[i];
    const w14_sub = w10 - pc;
    x21[i] = (w14_sub + w13_xor) & 0xff;
  }

  const c0 = x21[0];
  let hval = 0;
  if (0x30 <= c0 && c0 <= 0x39) {
    hval = c0 - 0x30;
  } else if (0x61 <= c0 && c0 <= 0x7a) {
    hval = c0 - 0x57;
  } else {
    return null;
  }

  const w9 = w22 - hval;
  if (w9 < 2) return null;

  const strA = x21.subarray(1, 1 + w9 - 1).toString('ascii');
  if (strA.length !== 32) return null;

  try {
    return Buffer.from(strA, 'hex');
  } catch (e) {
    return null;
  }
}

/**
 * AES-128-ECB 加密
 */
function aes128EcbEncrypt(key16, data) {
  const cipher = crypto.createCipheriv('aes-128-ecb', key16, null);
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(data), cipher.final()]);
}

/**
 * CENC-AES-CTR 解密 sample
 */
function decryptSample(key, nonce, cipher) {
  if (!cipher || cipher.length === 0) return Buffer.alloc(0);
  const nblocks = Math.ceil(cipher.length / 16);
  const full = Buffer.alloc(nblocks * 16);
  for (let k = 0; k < nblocks; k++) {
    nonce.copy(full, k * 16, 0, 8);
    full.writeBigUInt64BE(BigInt(k), k * 16 + 8);
  }
  const ks = aes128EcbEncrypt(key, full);
  const plain = Buffer.alloc(cipher.length);
  for (let i = 0; i < cipher.length; i++) {
    plain[i] = cipher[i] ^ ks[i];
  }
  return plain;
}

/**
 * MP4 Box 结构解析
 */
function parseBoxes(data, start, end) {
  const boxes = [];
  let off = start;
  while (off + 8 <= end) {
    let size = data.readUInt32BE(off);
    const typ = data.subarray(off + 4, off + 8).toString('latin1');
    let hdr = 8;
    if (size === 1) {
      size = Number(data.readBigUInt64BE(off + 8));
      hdr = 16;
    } else if (size === 0) {
      size = end - off;
    }
    if (size < hdr || off + size > end) break;
    let children = null;
    if (['moov', 'trak', 'mdia', 'minf', 'stbl', 'edts', 'dinf', 'udta', 'meta'].includes(typ)) {
      children = parseBoxes(data, off + hdr, off + size);
    }
    boxes.push({ typ, off, size, hdr, children });
    off += size;
  }
  return boxes;
}

/**
 * 重建 moov box
 */
function rebuildMoov(data, moovOff, moovSize, top) {
  const moovBox = top.find(b => b.typ === 'moov');
  if (!moovBox) throw new Error('no moov box');

  function clone(box) {
    return {
      typ: box.typ,
      off: box.off,
      size: box.size,
      hdr: box.hdr,
      children: box.children ? box.children.map(clone) : null
    };
  }

  function prune(box) {
    if (!box.children) return box;
    const keep = [];
    for (const c of box.children) {
      if (['senc', 'saio', 'saiz', 'sgpd', 'sbgp'].includes(c.typ)) continue;
      keep.push(prune(c));
    }
    box.children = keep;
    return box;
  }

  const tree = prune(clone(moovBox));

  function* walkChildren(box) {
    for (const c of (box.children || [])) {
      yield c;
      for (const x of walkChildren(c)) yield x;
    }
  }

  const patches = {};
  for (const b of walkChildren(tree)) {
    if (b.typ === 'stsd') {
      const content = b.off + 8;
      const count = data.readUInt32BE(content + 4);
      let p = content + 8;
      const entries = [];
      for (let i = 0; i < count; i++) {
        let esize = data.readUInt32BE(p);
        const etyp = data.subarray(p + 4, p + 8).toString('latin1');
        if (etyp === 'encv' || etyp === 'enca') {
          const newType = etyp === 'encv' ? 'hvc1' : 'mp4a';
          const hdrSize = etyp === 'encv' ? 78 : 28;
          const entry = Buffer.alloc(8 + hdrSize);
          entry.writeUInt32BE(0, 0);
          entry.write(newType, 4, 4, 'latin1');
          data.copy(entry, 8, p + 8, p + 8 + hdrSize);

          let entryExtra = Buffer.alloc(0);
          let q = p + 8 + hdrSize;
          while (q + 8 <= p + esize) {
            let s2 = data.readUInt32BE(q);
            const t2 = data.subarray(q + 4, q + 8).toString('latin1');
            if (s2 === 1) {
              s2 = Number(data.readBigUInt64BE(q + 8));
            } else if (s2 === 0) {
              s2 = p + esize - q;
            }
            if (t2 !== 'sinf') {
              entryExtra = Buffer.concat([entryExtra, data.subarray(q, q + s2)]);
            }
            q += s2;
          }
          const fullEntry = Buffer.concat([entry, entryExtra]);
          fullEntry.writeUInt32BE(fullEntry.length, 0);
          entries.push(fullEntry);
        } else {
          entries.push(data.subarray(p, p + esize));
        }
        p += esize;
      }
      const stsdHdr = Buffer.alloc(16);
      data.copy(stsdHdr, 0, b.off, content + 8);
      stsdHdr.writeUInt32BE(entries.length, 12);
      const fullStsd = Buffer.concat([stsdHdr, ...entries]);
      fullStsd.writeUInt32BE(fullStsd.length, 0);
      patches[b.off] = fullStsd;
    }
  }

  function serialize(box) {
    if (!box.children) {
      return patches[box.off] || data.subarray(box.off, box.off + box.size);
    }
    const body = Buffer.concat(box.children.map(serialize));
    const hdrb = Buffer.alloc(box.hdr);
    data.copy(hdrb, 0, box.off, box.off + box.hdr);
    if (box.hdr === 8) {
      hdrb.writeUInt32BE(8 + body.length, 0);
    } else {
      hdrb.writeUInt32BE(1, 0);
      hdrb.writeBigUInt64BE(BigInt(16 + body.length), 8);
    }
    return Buffer.concat([hdrb, body]);
  }

  const first = serialize(tree);
  const delta = moovSize - first.length;

  for (const b of walkChildren(tree)) {
    if (b.typ === 'stco') {
      const nc = data.readUInt32BE(b.off + 12);
      for (let i = 0; i < nc; i++) {
        const v = data.readUInt32BE(b.off + 16 + i * 4);
        if (v >= delta) {
          data.writeUInt32BE(v - delta, b.off + 16 + i * 4);
        }
      }
    }
  }

  return serialize(tree);
}

/**
 * 解密 CENC-AES-CTR 加密的 MP4（内存版）
 * 输入一个完整的加密 MP4 Buffer，返回解密并重建过 moov 的 Buffer。
 * 注意：会就地修改传入的 Buffer（调用方应独占它）。
 */
function decryptMp4Buffer(data, key) {
  const total = data.length;
  const top = parseBoxes(data, 0, total);
  const moov = top.find(b => b.typ === 'moov');
  if (!moov) throw new Error('no moov box found in MP4');

  function getBox(boxes, typ) {
    return (boxes || []).find(b => b.typ === typ);
  }

  function* walkBoxes(boxes) {
    for (const b of boxes) {
      if (b.children) {
        for (const x of walkBoxes(b.children)) yield x;
      }
      yield b;
    }
  }

  const stbls = Array.from(walkBoxes(top)).filter(b => b.typ === 'stbl');
  const trackInfo = [];
  for (const stbl of stbls) {
    const stsz = getBox(stbl.children, 'stsz');
    const stco = getBox(stbl.children, 'stco');
    const stsc = getBox(stbl.children, 'stsc');
    const senc = getBox(stbl.children, 'senc');
    if (!stsz || !stco || !stsc) continue;

    const ss = data.readUInt32BE(stsz.off + 12);
    const n = data.readUInt32BE(stsz.off + 16);
    let sizes = [];
    if (ss === 0) {
      for (let i = 0; i < n; i++) {
        sizes.push(data.readUInt32BE(stsz.off + 20 + i * 4));
      }
    } else {
      sizes = new Array(n).fill(ss);
    }

    const nc = data.readUInt32BE(stco.off + 12);
    const chunkOffs = [];
    for (let i = 0; i < nc; i++) {
      chunkOffs.push(data.readUInt32BE(stco.off + 16 + i * 4));
    }

    const ns = data.readUInt32BE(stsc.off + 12);
    const stscTab = [];
    for (let i = 0; i < ns; i++) {
      stscTab.push([
        data.readUInt32BE(stsc.off + 16 + i * 12),
        data.readUInt32BE(stsc.off + 20 + i * 12),
        data.readUInt32BE(stsc.off + 24 + i * 12),
      ]);
    }

    const ivs = [];
    if (senc) {
      const sc = data.readUInt32BE(senc.off + 12);
      for (let i = 0; i < sc; i++) {
        ivs.push(data.subarray(senc.off + 16 + i * 8, senc.off + 24 + i * 8));
      }
    }

    const chunkSpc = {};
    for (let i = 0; i < stscTab.length; i++) {
      const fc = stscTab[i][0];
      const spc = stscTab[i][1];
      const nxt = (i + 1 < stscTab.length) ? stscTab[i + 1][0] : (nc + 1);
      for (let ci = fc - 1; ci < nxt - 1; ci++) {
        chunkSpc[ci] = spc;
      }
    }

    const sampleOffs = [];
    let si = 0;
    for (let ci = 0; ci < nc; ci++) {
      let off = chunkOffs[ci];
      const spc = chunkSpc[ci] || 1;
      for (let s = 0; s < spc; s++) {
        if (si >= n) break;
        sampleOffs.push(off);
        off += sizes[si];
        si++;
      }
    }

    trackInfo.push({ sizes, offs: sampleOffs, ivs, stco });
  }

  for (const ti of trackInfo) {
    for (let i = 0; i < ti.offs.length; i++) {
      const off = ti.offs[i];
      const sz = ti.sizes[i];
      if (off + sz > total) continue;
      if (i < ti.ivs.length) {
        const nonce = ti.ivs[i].subarray(0, 8);
        const cipher = data.subarray(off, off + sz);
        const plain = decryptSample(key, nonce, cipher);
        plain.copy(data, off);
      }
    }
  }

  const newMoov = rebuildMoov(data, moov.off, moov.size, top);
  const out = [];
  let off = 0;
  while (off < total) {
    let size = data.readUInt32BE(off);
    const typ = data.subarray(off + 4, off + 8).toString('latin1');
    let hdr = 8;
    if (size === 1) {
      size = Number(data.readBigUInt64BE(off + 8));
      hdr = 16;
    } else if (size === 0) {
      size = total - off;
    }
    if (typ === 'moov') {
      out.push(newMoov);
    } else {
      out.push(data.subarray(off, off + size));
    }
    off += size;
  }

  return Buffer.concat(out);
}

/**
 * 解密 MP4 文件并保存
 */
function decryptMp4File(srcPath, dstPath, key) {
  const data = fs.readFileSync(srcPath);
  const finalBuf = decryptMp4Buffer(data, key);
  fs.writeFileSync(dstPath, finalBuf);
}

module.exports = {
  resolveSeriesId,
  fetchEpisodeList,
  fetchEpisodeListFromWeb,
  fetchPlayUrlSingle,
  fetchPlayUrlFromWeb,
  deriveKey,
  decryptMp4File,
  decryptMp4Buffer,
  VIDEO_REFERER,
  UA,
};
