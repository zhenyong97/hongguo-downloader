import React, { useState, useEffect } from 'react';
import './Settings.css';
import { Settings, Folder, Check, Globe, X, RefreshCw, AlertCircle } from './icons';


const FORMAT_PRESETS = [
  { label: 'Tên phim_Tập N', value: 'Tên phim Số tập' },
  { label: 'Tên phim_Tập N_Tiêu đề', value: 'Tên phim Số tập Tiêu đề' },
  { label: 'Chỉ tên phim', value: 'Tên phim' },
];

const PROXY_MODES = [
  { value: 'system', label: 'Theo hệ thống', desc: 'Dùng cấu hình proxy có sẵn trong hệ thống / biến môi trường' },
  { value: 'custom', label: 'Tùy chỉnh', desc: 'Tự nhập địa chỉ và cổng proxy (hỗ trợ proxy HTTP/HTTPS)' },
  { value: 'direct', label: 'Bắt buộc kết nối trực tiếp', desc: 'Bỏ qua mọi proxy, kết nối trực tiếp' },
];

// 常见代理软件默认端口，方便一键填入
const PORT_PRESETS = [
  { label: 'Clash / Mihomo', port: 7890 },
  { label: 'V2rayN', port: 10809 },
  { label: 'Shadowsocks', port: 1080 },
  { label: 'Burp / Bắt gói tin', port: 8080 },
];

/** 已保存设置 -> 当前生效的代理描述 */
function describeProxy(settings) {
  if (!settings || settings.proxy_enabled !== true) {
    return { on: false, text: 'Chưa bật (mọi yêu cầu kết nối trực tiếp)' };
  }
  const mode = settings.proxy_mode || 'system';
  if (mode === 'direct') {
    return { on: false, text: 'Đã bật nhưng đang ở chế độ «Bắt buộc kết nối trực tiếp»' };
  }
  if (mode === 'custom') {
    const host = (settings.proxy_host || '').trim();
    const port = (settings.proxy_port || '').toString().trim();
    if (!host) return { on: false, text: 'Đã bật nhưng chưa nhập địa chỉ proxy' };
    return { on: true, text: `${host}${port ? ':' + port : ''}` };
  }
  return { on: true, text: 'Theo proxy của hệ thống / biến môi trường' };
}

function SettingsPage() {
  const [settings, setSettings] = useState(null);
  const [saved, setSaved] = useState(false);
  const [proxyOpen, setProxyOpen] = useState(false);
  const [proxyDraft, setProxyDraft] = useState(null);
  const [testResult, setTestResult] = useState(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    window.electronAPI.getSettings().then(setSettings);
  }, []);

  const update = (key, value) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  };

  const selectFolder = async () => {
    const dir = await window.electronAPI.selectFolder();
    if (dir) update('root', dir);
  };

  const save = async () => {
    const res = await window.electronAPI.saveSettings(settings);
    if (res && res.success) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
  };

  // ===== 代理弹窗 =====
  const openProxyModal = () => {
    setProxyDraft({
      proxy_enabled: settings.proxy_enabled === true,
      proxy_mode: settings.proxy_mode || 'system',
      proxy_host: settings.proxy_host || '127.0.0.1',
      proxy_port: settings.proxy_port || 7890,
      proxy_username: settings.proxy_username || '',
      proxy_password: settings.proxy_password || '',
    });
    setTestResult(null);
    setProxyOpen(true);
  };

  const patchDraft = (key, value) => {
    setProxyDraft((prev) => ({ ...prev, [key]: value }));
    setTestResult(null);
  };

  const runTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await window.electronAPI.testProxy(proxyDraft);
      setTestResult(res);
    } catch (e) {
      setTestResult({ success: false, error: e.message });
    } finally {
      setTesting(false);
    }
  };

  const applyProxy = async () => {
    const next = { ...settings, ...proxyDraft };
    const res = await window.electronAPI.saveSettings(next);
    if (res && res.success) {
      setSettings(next);
      setProxyOpen(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
  };

  if (!settings) {
    return <div className="settings-container">Đang tải...</div>;
  }

  const proxyInfo = describeProxy(settings);
  const mode = proxyDraft ? proxyDraft.proxy_mode : 'system';

  return (
    <div className="settings-container">
      <div className="settings-header">
        <Settings size={22} />
        <h2>Cài đặt</h2>
      </div>

      <div className="settings-card">
        <div className="settings-group">
          <label className="settings-label">Thư mục tải xuống</label>
          <div className="folder-row">
            <input
              type="text"
              className="input-field"
              value={settings.root || ''}
              onChange={(e) => update('root', e.target.value)}
              placeholder="Chọn thư mục lưu tệp tải xuống"
            />
            <button className="btn btn-outline" onClick={selectFolder}>
              <Folder size={16} />
              Chọn thư mục
            </button>
          </div>
          <p className="settings-hint">Tệp sẽ được lưu vào <code>Thư mục tải xuống/Phim ngắn Hongguo/Tên phim/</code></p>
        </div>

        <div className="settings-group">
          <label className="settings-label">Quy tắc đặt tên tệp</label>
          <div className="preset-row">
            {FORMAT_PRESETS.map((p) => (
              <button
                key={p.value}
                className={`btn-chip ${settings.name_format === p.value ? 'btn-chip-primary' : ''}`}
                onClick={() => update('name_format', p.value)}
              >
                {p.label}
              </button>
            ))}
          </div>
          <input
            type="text"
            className="input-field mt8"
            value={settings.name_format || ''}
            onChange={(e) => update('name_format', e.target.value)}
          />
          <p className="settings-hint">
            Biến khả dụng: <code>Tên phim</code> (series_title) · <code>Số tập</code> (vid_index, ví dụ 001) · <code>Tiêu đề</code> (ep_title)
          </p>
        </div>

        <div className="settings-group">
          <label className="settings-label">Số lượt tải đồng thời tối đa</label>
          <select
            className="input-field select-field"
            value={settings.max_concurrent || 3}
            onChange={(e) => update('max_concurrent', parseInt(e.target.value, 10))}
          >
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
              <option key={n} value={n}>{n} lượt tải đồng thời</option>
            ))}
          </select>
          <p className="settings-hint">
            Tải đồng thời <b>{settings.max_concurrent || 3}</b> tập (có hiệu lực ngay sau khi lưu).
            Số lượt đồng thời càng cao thì càng nhanh, nhưng có thể bị giới hạn tần suất truy cập API; khuyến nghị 3~5.
          </p>
        </div>

        <div className="settings-group">
          <label className="settings-label">Tự động gộp sau khi tải xong</label>
          <select
            className="input-field select-field"
            value={!settings.auto_merge ? 'off' : settings.auto_merge_compatible ? 'compatible' : 'fast'}
            onChange={(e) => {
              const v = e.target.value;
              setSettings((prev) => ({ ...prev, auto_merge: v !== 'off', auto_merge_compatible: v === 'compatible' }));
              setSaved(false);
            }}
          >
            <option value="off">Tắt</option>
            <option value="fast">Gộp nhanh (giữ nguyên chất lượng, vài giây)</option>
            <option value="compatible">Gộp tương thích (chuyển sang H.264, chậm hơn)</option>
          </select>
          <p className="settings-hint">
            Khi đã tải đủ <b>toàn bộ</b> tập của một phim, app tự ghép thành một tệp <code>Tên phim_Bản gộp.mp4</code> trong cùng thư mục. Các tập lẻ vẫn được giữ lại.
          </p>
        </div>

        <div className="settings-group">
          <label className="settings-label">Proxy mạng</label>
          <div className="proxy-status-row">
            <span className={`proxy-dot ${proxyInfo.on ? 'proxy-dot-on' : 'proxy-dot-off'}`} />
            <span className="proxy-status-text">
              {proxyInfo.on ? <>Đã bật: <code>{proxyInfo.text}</code></> : proxyInfo.text}
            </span>
            <button className="btn btn-outline btn-sm" onClick={openProxyModal}>
              <Globe size={15} />
              Cấu hình proxy
            </button>
          </div>
          <p className="settings-hint">
            Nếu máy có proxy (Clash / V2rayN, v.v.) thì điền vào đây; việc phân tích phim và tải video đều sẽ đi qua proxy này. Có hiệu lực ngay sau khi lưu, không cần khởi động lại.
          </p>
        </div>

        <div className="settings-footer">
          <button className="btn btn-primary" onClick={save}>
            {saved ? <><Check size={16} /> Đã lưu</> : 'Lưu cài đặt'}
          </button>
        </div>
      </div>

      {proxyOpen && proxyDraft && (
        <div className="proxy-modal-mask" onClick={() => setProxyOpen(false)}>
          <div className="proxy-modal" onClick={(e) => e.stopPropagation()}>
            <div className="proxy-modal-head">
              <div className="proxy-modal-title">
                <Globe size={18} />
                <span>Cài đặt proxy mạng</span>
              </div>
              <button className="icon-btn" title="Đóng" onClick={() => setProxyOpen(false)}>
                <X size={16} />
              </button>
            </div>

            <div className="proxy-modal-body">
              <label className="proxy-switch-row">
                <input
                  type="checkbox"
                  checked={proxyDraft.proxy_enabled}
                  onChange={(e) => patchDraft('proxy_enabled', e.target.checked)}
                />
                <span className="proxy-switch-text">
                  Bật proxy
                  <em>Khi tắt, proxy không có hiệu lực, mọi yêu cầu kết nối trực tiếp</em>
                </span>
              </label>

              <div className={`proxy-fields ${proxyDraft.proxy_enabled ? '' : 'proxy-fields-disabled'}`}>
                <div className="settings-group">
                  <label className="settings-label">Chế độ proxy</label>
                  <div className="proxy-mode-list">
                    {PROXY_MODES.map((m) => (
                      <label
                        key={m.value}
                        className={`proxy-mode-item ${mode === m.value ? 'active' : ''}`}
                      >
                        <input
                          type="radio"
                          name="proxy_mode"
                          value={m.value}
                          checked={mode === m.value}
                          disabled={!proxyDraft.proxy_enabled}
                          onChange={() => patchDraft('proxy_mode', m.value)}
                        />
                        <span className="proxy-mode-body">
                          <b>{m.label}</b>
                          <em>{m.desc}</em>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>

                {mode === 'custom' && (
                  <div className="settings-group">
                    <label className="settings-label">Địa chỉ proxy</label>
                    <div className="proxy-host-row">
                      <input
                        type="text"
                        className="input-field"
                        placeholder="127.0.0.1"
                        value={proxyDraft.proxy_host}
                        disabled={!proxyDraft.proxy_enabled}
                        onChange={(e) => patchDraft('proxy_host', e.target.value)}
                      />
                      <span className="proxy-colon">:</span>
                      <input
                        type="number"
                        className="input-field proxy-port"
                        placeholder="7890"
                        min="1"
                        max="65535"
                        value={proxyDraft.proxy_port}
                        disabled={!proxyDraft.proxy_enabled}
                        onChange={(e) => patchDraft('proxy_port', e.target.value)}
                      />
                    </div>
                    <div className="preset-row mt8">
                      {PORT_PRESETS.map((p) => (
                        <button
                          key={p.port}
                          type="button"
                          className="btn-chip"
                          disabled={!proxyDraft.proxy_enabled}
                          onClick={() => patchDraft('proxy_port', p.port)}
                        >
                          {p.label} {p.port}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {mode === 'custom' && (
                  <div className="settings-group">
                    <label className="settings-label">Xác thực proxy (tùy chọn)</label>
                    <div className="proxy-auth-row">
                      <input
                        type="text"
                        className="input-field"
                        placeholder="Tên người dùng"
                        autoComplete="off"
                        value={proxyDraft.proxy_username}
                        disabled={!proxyDraft.proxy_enabled}
                        onChange={(e) => patchDraft('proxy_username', e.target.value)}
                      />
                      <input
                        type="password"
                        className="input-field"
                        placeholder="Mật khẩu"
                        autoComplete="new-password"
                        value={proxyDraft.proxy_password}
                        disabled={!proxyDraft.proxy_enabled}
                        onChange={(e) => patchDraft('proxy_password', e.target.value)}
                      />
                    </div>
                    <p className="settings-hint">Để trống nếu proxy không cần xác thực</p>
                  </div>
                )}
              </div>

              {testResult && (
                <div className={`proxy-test-result ${testResult.success ? 'ok' : 'fail'}`}>
                  {testResult.success ? <Check size={15} /> : <AlertCircle size={15} />}
                  <span>
                    {testResult.success ? testResult.message : testResult.error}
                    {testResult.success && testResult.via ? ` · qua ${testResult.via}` : ''}
                  </span>
                </div>
              )}
            </div>

            <div className="proxy-modal-foot">
              <button className="btn btn-outline" onClick={runTest} disabled={testing}>
                <RefreshCw size={15} />
                {testing ? 'Đang kiểm tra...' : 'Kiểm tra kết nối'}
              </button>
              <div className="proxy-foot-right">
                <button className="btn btn-outline" onClick={() => setProxyOpen(false)}>Hủy</button>
                <button className="btn btn-primary" onClick={applyProxy}>
                  <Check size={15} />
                  Lưu và áp dụng
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


export default SettingsPage;
