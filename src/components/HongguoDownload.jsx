import React, { useState } from 'react';
import './HongguoDownload.css';
import { Film, Download, CheckSquare, Square, RefreshCw, Folder, Sparkles, Search } from './icons';
import SearchPanel from './SearchPanel';
import { vi } from '../zhLabels';


function HongguoDownload({ onNavigate }) {
  const [tab, setTab] = useState('search'); // 'search' | 'input'
  const [inputUrl, setInputUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Kết quả phân tích phim
  const [seriesData, setSeriesData] = useState(null); // { series_id, series_title, cover, total, episodes: [...] }
  const [selectedVids, setSelectedVids] = useState(new Set());
  const [rangeInput, setRangeInput] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Sau khi chọn một phim từ tìm kiếm: dùng lại giao diện chọn tập tải xuống sẵn có
  const handleSeriesFromSearch = (data) => {
    setErrorMsg('');
    setTab('input');
    setSeriesData(data);
    setSelectedVids(new Set(data.episodes.map((ep) => ep.vid)));
    setSuccessMsg(`Đã chọn “${data.series_title}”, tổng cộng ${data.total} tập, có thể gửi tải xuống ngay`);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Phân tích phim Hongguo
  const handleResolve = async () => {
    if (!inputUrl.trim()) {
      setErrorMsg('Vui lòng nhập liên kết chia sẻ Phim ngắn Hongguo hoặc series_id');
      return;
    }
    setLoading(true);
    setErrorMsg('');
    setSuccessMsg('');
    setSeriesData(null);
    setSelectedVids(new Set());

    try {
      const res = await window.electronAPI.hongguoResolve(inputUrl.trim());
      if (res.success && res.data) {
        setSeriesData(res.data);
        // Mặc định chọn tất cả
        const allVids = new Set(res.data.episodes.map((ep) => ep.vid));
        setSelectedVids(allVids);
        setSuccessMsg(`Phân tích thành công! Đã tìm thấy “${res.data.series_title}”, tổng cộng ${res.data.total} tập`);
      } else {
        setErrorMsg(res.error || 'Phân tích thất bại, vui lòng kiểm tra liên kết hoặc kết nối mạng');
      }
    } catch (err) {
      setErrorMsg('Có lỗi trong quá trình phân tích: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  // Chọn/bỏ chọn một tập
  const toggleVid = (vid) => {
    const next = new Set(selectedVids);
    if (next.has(vid)) {
      next.delete(vid);
    } else {
      next.add(vid);
    }
    setSelectedVids(next);
  };

  // Chọn tất cả
  const handleSelectAll = () => {
    if (!seriesData) return;
    setSelectedVids(new Set(seriesData.episodes.map((ep) => ep.vid)));
  };

  // Đảo lựa chọn
  const handleInvertSelect = () => {
    if (!seriesData) return;
    const next = new Set();
    for (const ep of seriesData.episodes) {
      if (!selectedVids.has(ep.vid)) {
        next.add(ep.vid);
      }
    }
    setSelectedVids(next);
  };

  // Bỏ chọn tất cả
  const handleDeselectAll = () => {
    setSelectedVids(new Set());
  };

  // Chọn nhanh số tập
  const handleQuickSelect = (type) => {
    if (!seriesData || !seriesData.episodes) return;
    const eps = seriesData.episodes;
    const total = eps.length;
    let targetEps = [];
    if (type === 'first10') {
      targetEps = eps.slice(0, 10);
    } else if (type === 'first30') {
      targetEps = eps.slice(0, 30);
    } else if (type === 'last30') {
      targetEps = eps.slice(Math.max(0, total - 30));
    }
    setSelectedVids(new Set(targetEps.map((ep) => ep.vid)));
  };

  // Áp dụng bộ lọc theo chuỗi khoảng (vd. "1-30" hoặc "1,5,10-20")
  const handleApplyRange = () => {
    if (!seriesData || !seriesData.episodes || !rangeInput.trim()) return;
    const total = seriesData.episodes.length;
    const nums = new Set();
    const parts = rangeInput.split(',');
    for (let part of parts) {
      part = part.trim();
      if (part.includes('-')) {
        const [a, b] = part.split('-').map((n) => parseInt(n.trim(), 10));
        if (!isNaN(a) && !isNaN(b)) {
          for (let i = Math.min(a, b); i <= Math.max(a, b); i++) {
            if (i >= 1 && i <= total) nums.add(i);
          }
        }
      } else {
        const n = parseInt(part, 10);
        if (!isNaN(n) && n >= 1 && n <= total) nums.add(n);
      }
    }
    const selectedEps = seriesData.episodes.filter((ep) => nums.has(ep.vid_index));
    setSelectedVids(new Set(selectedEps.map((ep) => ep.vid)));
  };

  // Gửi yêu cầu tải hàng loạt
  const handleBatchDownload = async () => {
    if (!seriesData || selectedVids.size === 0) {
      setErrorMsg('Vui lòng chọn ít nhất một tập phim ngắn để tải xuống');
      return;
    }
    setSubmitting(true);
    setErrorMsg('');
    setSuccessMsg('');
    try {
      const selectedEps = seriesData.episodes.filter((ep) => selectedVids.has(ep.vid));
      const res = await window.electronAPI.hongguoDownloadBatch({
        seriesId: seriesData.series_id,
        seriesTitle: seriesData.series_title,
        episodes: selectedEps,
      });
      if (res.success) {
        setSuccessMsg(`Đã gửi thành công ${res.count} tập vào hàng đợi tải xuống! Bấm nút bên dưới để chuyển đến “Quản lý tải xuống” xem tiến độ theo thời gian thực.`);
      } else {
        setErrorMsg(res.error || 'Gửi tải xuống thất bại');
      }
    } catch (err) {
      setErrorMsg('Lỗi khi gửi tải xuống: ' + err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="hongguo-container">
      {/* Vùng banner đầu trang */}
      <div className="hongguo-hero">
        <div className="hero-icon">
          <Film size={32} />
        </div>
        <div className="hero-text">
          <h2>Tải hàng loạt Phim ngắn Hongguo</h2>
          <p>Hỗ trợ dán liên kết chia sẻ từ ứng dụng Phim ngắn Hongguo hoặc ID phim, vượt qua mã hóa gốc AES-128 CENC, tải toàn bộ tập chất lượng cao không có logo.</p>
        </div>
      </div>

      {/* Chuyển phương thức */}
      <div className="mode-tabs">
        <button
          className={`mode-tab ${tab === 'search' ? 'active' : ''}`}
          onClick={() => setTab('search')}
        >
          <Search size={16} />
          <span>Tìm kiếm phim</span>
        </button>
        <button
          className={`mode-tab ${tab === 'input' ? 'active' : ''}`}
          onClick={() => setTab('input')}
        >
          <Sparkles size={16} />
          <span>Dán liên kết / ID</span>
        </button>
      </div>

      {tab === 'search' ? (
        <SearchPanel
          onSelectSeries={handleSeriesFromSearch}
          onSwitchToInput={() => setTab('input')}
          onNavigate={onNavigate}
        />
      ) : (
        /* Thẻ nhập link để phân tích */
        <div className="hongguo-card">
          <div className="card-header-title">
            <Sparkles size={18} />
            <span>Nhập liên kết hoặc ID phim ngắn</span>
          </div>
          <div className="input-group">
            <input
              type="text"
              className="input-field"
              placeholder="Ví dụ: https://novelquickapp.com/s/WGPClz6sw10/ hoặc 7664958856774044697"
              value={inputUrl}
              onChange={(e) => setInputUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleResolve()}
            />
            <button className="btn btn-primary" onClick={handleResolve} disabled={loading}>
              {loading ? (
                <>
                  <RefreshCw size={16} className="spin" />
                  <span>Đang phân tích...</span>
                </>
              ) : (
                <>
                  <Film size={16} />
                  <span>Phân tích phim</span>
                </>
              )}
            </button>
          </div>

          {errorMsg && <div className="alert alert-error">{errorMsg}</div>}
          {successMsg && <div className="alert alert-success">{successMsg}</div>}
        </div>
      )}

      {/* Thông báo ở chế độ tìm kiếm (thẻ phân tích đã bị thay thế nên hiển thị riêng ở đây) */}
      {tab === 'search' && (errorMsg || successMsg) && (
        <div className="hongguo-card" style={{ marginTop: 0 }}>
          {errorMsg && <div className="alert alert-error">{errorMsg}</div>}
          {successMsg && <div className="alert alert-success">{successMsg}</div>}
        </div>
      )}

      {/* Danh sách tập và điều khiển chọn */}
      {seriesData && (
        <div className="hongguo-card episode-section">
          {/* Thông tin phim */}
          <div className="series-header">
            <div className="series-info">
              {seriesData.cover ? (
                <img src={seriesData.cover} alt={seriesData.series_title} className="series-cover" />
              ) : (
                <div className="series-cover-placeholder">
                  <Film size={28} />
                </div>
              )}
              <div className="series-meta">
                <h3 className="series-title">《{seriesData.series_title}》</h3>
                <div className="series-tags">
                  <span className="badge">Tổng số tập: {seriesData.total} tập</span>
                  <span className="badge badge-secondary">series_id: {seriesData.series_id}</span>
                  <span className="badge badge-success">Tự động giải mã AES-128</span>
                </div>
              </div>
            </div>

            <div className="batch-action-bar">
              <button
                className="btn btn-primary"
                onClick={handleBatchDownload}
                disabled={submitting || selectedVids.size === 0}
              >
                <Download size={16} />
                <span>Tải xuống các tập đã chọn ({selectedVids.size}/{seriesData.total})</span>
              </button>
              {onNavigate && (
                <button className="btn btn-outline" onClick={() => onNavigate('manager')}>
                  <Folder size={16} />
                  <span>Xem Quản lý tải xuống</span>
                </button>
              )}
            </div>
          </div>

          {/* Thanh lọc và thao tác */}
          <div className="controls-row">
            <div className="select-buttons">
              <button className="btn-chip" onClick={handleSelectAll}>Chọn tất cả</button>
              <button className="btn-chip" onClick={handleInvertSelect}>Đảo chọn</button>
              <button className="btn-chip" onClick={handleDeselectAll}>Bỏ chọn tất cả</button>
              <span className="divider"></span>
              <button className="btn-chip" onClick={() => handleQuickSelect('first10')}>10 tập đầu</button>
              <button className="btn-chip" onClick={() => handleQuickSelect('first30')}>30 tập đầu</button>
              <button className="btn-chip" onClick={() => handleQuickSelect('last30')}>30 tập cuối</button>
            </div>

            <div className="range-filter">
              <span className="range-label">Lọc theo khoảng:</span>
              <input
                type="text"
                className="range-input"
                placeholder="VD: 1-30 hoặc 1,5,10"
                value={rangeInput}
                onChange={(e) => setRangeInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleApplyRange()}
              />
              <button className="btn-chip btn-chip-primary" onClick={handleApplyRange}>Áp dụng</button>
            </div>
          </div>

          {/* Lưới danh sách tập */}
          <div className="episode-grid">
            {seriesData.episodes.map((ep) => {
              const isChecked = selectedVids.has(ep.vid);
              return (
                <div
                  key={ep.vid}
                  className={`episode-card ${isChecked ? 'selected' : ''}`}
                  onClick={() => toggleVid(ep.vid)}
                >
                  <div className="checkbox-icon">
                    {isChecked ? <CheckSquare size={18} className="icon-checked" /> : <Square size={18} className="icon-unchecked" />}
                  </div>
                  <div className="episode-info">
                    <span className="episode-num">Tập {String(ep.vid_index).padStart(2, '0')}</span>
                    {ep.title && <span className="episode-title">{vi(ep.title)}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export default HongguoDownload;
