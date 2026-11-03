/**
 * Kiểm tra logic mới của parseModelVideo: trong cùng một phản hồi video_model, xác nhận đã chọn mức cao nhất
 * Cách dùng: node scripts/verify-best-def.js [vid ...]
 */
const path = require('path');
const fs = require('fs');

// Nạp mã nguồn module thật và export thêm hàm nội bộ parseModelVideo
const srcPath = path.join(__dirname, '..', 'src', 'native', 'hongguo.js');
const src = fs.readFileSync(srcPath, 'utf8');
const Module = require('module');
const m = new Module('hongguo-test');
m.paths = Module._nodeModulePaths(path.join(__dirname, '..'));
m._compile(src + '\nmodule.exports._parseModelVideo = parseModelVideo;\n', 'hongguo-test.js');
const hongguo = m.exports;

const vids = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ['7645222653694856254', '7645222681196907582', '7645222713215290430', '7645222723290942526', '7645222730542877758'];

function defNumber(defStr) {
  const m2 = String(defStr || '').match(/(\d+)\s*p/i);
  return m2 ? parseInt(m2[1], 10) : 0;
}

(async () => {
  let allOk = true;
  for (const vid of vids) {
    try {
      const playInfo = await hongguo.fetchPlayUrlSingle(vid);
      // fetchPlayUrlSingle bên trong cũng dùng parseModelVideo, nhưng không lấy được video_model đầy đủ;
      // ở đây lấy lại model gốc một lần nữa, dùng parseModelVideo thật để chọn luồng và so với tất cả các mức
      const axios = require('axios');
      const API = "https://api5-normal-sinfonlineb.fqnovel.com";
      const q = {
        klink_egdi: "AAI29o4dI-eMiO73_SRSbZ_0By1v3fUSriNeu8-L951MoXhWT88pzj5B",
        iid: "3788260546453235", device_id: "538083340353620", ac: "wifi",
        channel: "oppo_8662_64", aid: "8662", app_name: "novelread",
        version_code: "71532", version_name: "7.1.5.32", device_platform: "android",
        os: "android", ssmix: "a", device_type: "SM-N9860", device_brand: "Samsung",
        language: "zh", os_api: "28", os_version: "9", manifest_version_code: "71532",
        resolution: "900*1600", dpi: "320", update_version_code: "71532", host_abi: "arm64-v8a",
        dragon_device_type: "pad", pv_player: "71532", compliance_status: "0",
        need_personal_recommend: "1", player_so_load: "1", is_android_pad_screen: "0",
        rom_version: "PQ3A.190705.10241111+release-keys", cdid: "b4f93387-5319-4134-aab9-2cd4e9279b8f",
        _rticket: Date.now().toString(),
      };
      const body = {
        biz_param: {
          detail_page_version: 0, device_level: 3, disable_digg_stat: false,
          need_all_video_definition: true, need_mp4_align: false,
          use_os_player: false, use_server_dns: false, video_platform: 1024,
        },
        dr_scene: "preload",
        mixed_video_id_map: { "1004": [vid] },
      };
      const res = await axios.post(API + '/novel/player/multi_video_model/preload/v1', body, {
        params: q,
        headers: { "User-Agent": hongguo.UA, "Accept-Encoding": "gzip", "Accept": "application/json; charset=utf-8,application/x-protobuf", "Content-Type": "application/json; charset=utf-8", "Host": "api5-normal-sinfonlineb.fqnovel.com" },
        timeout: 25000,
      });
      const item = res.data?.data?.[vid] || {};
      const [url, , codec] = hongguo._parseModelVideo(item.video_model);
      const vmj = JSON.parse(item.video_model || '{}');
      const defs = (vmj.video_list || []).map(v => ({
        def: v.video_meta?.definition,
        size: `${v.video_meta?.vwidth}x${v.video_meta?.vheight}`,
        br: v.video_meta?.bitrate,
        url: v.main_url,
      }));
      const bestDef = defs.reduce((a, b) => (defNumber(b.def) > defNumber(a.def) ? b : a));
      const ok = url === bestDef.url;
      if (!ok) allOk = false;
      console.log(`${ok ? '✅' : '❌'} vid=${vid} các mức=[${defs.map(d => d.def).join(', ')}] -> đã chọn ${ok ? bestDef.def + ' ' + bestDef.size : 'không rõ'} (codec=${codec})`);
      if (!ok) {
        console.log('  URL mong đợi:', bestDef.url.slice(0, 100));
        console.log('  URL thực tế:', String(url || '').slice(0, 100));
      }
    } catch (e) {
      allOk = false;
      console.log(`❌ vid=${vid} thất bại: ${e.message}`);
    }
  }
  console.log(allOk ? '\nTất cả đều chọn độ nét cao nhất ✅' : '\nCó trường hợp không chọn mức cao nhất ❌');
  process.exit(allOk ? 0 : 1);
})();
