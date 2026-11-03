import React, { useState, useEffect } from 'react';
import './HongguoDownload.css';
import { Search, Film, RefreshCw, ExternalLink, Download, X } from './icons';

/**
 * SearchPanel —— dùng trình duyệt nhúng bắt kết quả tìm kiếm của hongguoduanju.com và search.bilibili.com
 * Có series_id thì chuyển cho component cha chạy luồng sẵn có «lấy đủ tập + chọn tập tải xuống».
 */
function SearchPanel({ onSelectSeries, onSwitchToInput, onNavigate }) {
  const [keyword, setKeyword] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState(null); // null=chưa tìm, []=không có kết quả
  const [error, setError] = useState('');
  const [pageTitle, setPageTitle] = useState('');
  const [pickingId, setPickingId] = useState('');
  const [bulkBusy, setBulkBusy] = useState(false);
  const [byTheme, setByTheme] = useState(false); // Tìm theo nội dung / mô-típ: nhiều từ khóa, lấy hết mọi trang
  const [progress, setProgress] = useState(null);

  useEffect(() => window.electronAPI.onSearchThemeProgress(setProgress), []);

  // Tải tất cả các tập của mọi kết quả tìm kiếm
  const downloadAll = async () => {
    if (!results || !results.length) return;
    if (!window.confirm(`Tải toàn bộ tập của ${results.length} phim trong kết quả tìm kiếm?`)) return;
    setBulkBusy(true);
    setError('');
    try {
      const res = await window.electronAPI.downloadSeriesList(results.map((r) => r.series_id));
      if (res && res.success && res.seriesCount > 0) {
        if (onNavigate) onNavigate('manager');
      } else {
        setError((res && res.error) || 'Không lấy được danh sách tập của phim nào');
      }
    } catch (e) {
      setError('Lỗi khi gửi: ' + e.message);
    } finally {
      setBulkBusy(false);
    }
  };

  const doSearch = async () => {
    const kw = keyword.trim();
    if (!kw) {
      setError(byTheme ? 'Vui lòng nhập từ khóa mô-típ' : 'Vui lòng nhập từ khóa tên phim');
      return;
    }
    setLoading(true);
    setError('');
    setResults(null);
    setPageTitle('');
    setProgress(null);
    try {
      const res = byTheme ? await window.electronAPI.searchTheme(kw) : await window.electronAPI.searchSeries(kw);
      if (!res || !res.success) {
        setError((res && res.error) || 'Tìm kiếm thất bại, vui lòng thử lại');
        setResults([]);
      } else {
        setResults(res.results || []);
        if (!res.results || res.results.length === 0) setPageTitle(res.pageTitle || '');
      }
    } catch (e) {
      setError('Lỗi khi tìm kiếm: ' + e.message);
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  // Chọn một phim -> lấy đủ danh sách tập -> chuyển sang trang tải xuống
  const pick = async (item) => {
    setPickingId(item.series_id);
    setError('');
    try {
      const res = await window.electronAPI.searchResolve(item.series_id);
      if (res && res.success && res.data) {
        onSelectSeries(res.data);
      } else {
        setError((res && res.error) || 'Lấy danh sách tập thất bại');
      }
    } catch (e) {
      setError('Lỗi khi lấy danh sách tập: ' + e.message);
    } finally {
      setPickingId('');
    }
  };

  const showBrowser = async () => {
    await window.electronAPI.searchWindowShow(true);
    setError('Đã mở cửa sổ tìm kiếm, bạn có thể thao tác thủ công; đóng cửa sổ đó rồi quay lại trang này để tiếp tục.');
  };

  return (
    <div className="hongguo-card">
      <div className="card-header-title">
        <Search size={18} />
        <span>Tìm kiếm phim ngắn</span>
      </div>

      <div className="input-group">
        <input
          type="text"
          className="input-field"
          placeholder={byTheme ? 'Từ khóa mô-típ tiếng Trung, cách nhau bằng dấu cách: 逆袭 总裁 打脸' : 'Nhập tên phim bằng tiếng Trung'}
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && doSearch()}
        />
        <button className="btn btn-primary" onClick={doSearch} disabled={loading}>
          {loading ? (
            <>
              <RefreshCw size={16} className="spin" />
              <span>Đang tìm kiếm...</span>
            </>
          ) : (
            <>
              <Search size={16} />
              <span>Tìm kiếm</span>
            </>
          )}
        </button>
        {loading && byTheme && (
          <button className="btn btn-outline" onClick={() => window.electronAPI.searchThemeCancel()}>
            <X size={16} />
            <span>Dừng</span>
          </button>
        )}
      </div>
      <label className="search-mode">
        <input type="checkbox" checked={byTheme} disabled={loading} onChange={(e) => setByTheme(e.target.checked)} />
        Tìm theo nội dung / mô-típ (mỗi từ khóa tìm riêng, lấy hết mọi trang)
      </label>
      <p className="settings-hint" style={{ marginTop: 8 }}>
        {byTheme
          ? 'Mỗi từ khóa được tìm riêng: Hongguo lấy hết mọi trang (khớp cả phần giới thiệu), PineDrama và Bilibili lấy trang đầu. Phim khớp nhiều mô-típ hơn xếp lên trước; có thể mất vài phút.'
          : 'Từ khóa sẽ được tìm trên hongguoduanju.com, Bilibili (trình duyệt tích hợp) và PineDrama (qua reelfren); chọn một kết quả để lấy toàn bộ tập và tải xuống ngay.'}
      </p>

      {error && <div className="alert alert-error">{error}</div>}

      {loading && (
        <div className="search-loading">
          <RefreshCw size={18} className="spin" />
          <span>
            {byTheme && progress
              ? `Đang tìm ${progress.text} — đã có ${progress.count} phim…`
              : 'Đang lấy kết quả tìm kiếm, lần đầu có thể mất vài giây…'}
          </span>
        </div>
      )}

      {results && results.length === 0 && !loading && (
        <div className="search-empty">
          <p>Không tìm thấy phim ngắn phù hợp{pageTitle ? ` (tiêu đề trang: ${pageTitle})` : ''}</p>
          <div className="search-empty-actions">
            <button className="btn btn-outline" onClick={showBrowser}>
              <ExternalLink size={15} />
              Hiện cửa sổ trình duyệt
            </button>
            {onSwitchToInput && (
              <button className="btn btn-outline" onClick={onSwitchToInput}>
                Tải bằng liên kết / ID
              </button>
            )}
          </div>
        </div>
      )}

      {results && results.length > 0 && (
        <>
          <div className="search-count">
            Tìm thấy {results.length} phim ngắn phù hợp
            <button className="btn btn-primary btn-sm" style={{ marginLeft: "auto" }} onClick={downloadAll} disabled={bulkBusy}>
              {bulkBusy ? <RefreshCw size={14} className="spin" /> : <Download size={14} />}
              {bulkBusy ? `Đang thêm ${results.length} phim…` : 'Tải tất cả'}
            </button>
          </div>
          <div className="search-grid">
            {results.map((item) => (
              <div
                key={item.series_id}
                className={`search-card ${pickingId === item.series_id ? 'picking' : ''}`}
                onClick={() => pickingId === '' && pick(item)}
                title={`Bấm để xem và tải xuống: ${item.series_title}`}
              >
                <div className="search-cover">
                  {item.cover ? (
                    <img src={item.cover} alt={item.series_title} loading="lazy" />
                  ) : (
                    <div className="cover-placeholder">
                      <Film size={22} />
                    </div>
                  )}
                </div>
                <div className="search-card-body">
                  <div className="search-card-title">{item.series_title}</div>
                  {item.matched && item.matched.length > 0 && (
                    <div className="search-card-tags">Khớp: {item.matched.join(' · ')}</div>
                  )}
                  {item.intro && <div className="search-card-intro" title={item.intro}>{item.intro}</div>}
                  {item.tags && item.tags.length > 0 && (
                    <div className="search-card-sub">{item.tags.join(' · ')}</div>
                  )}
                  <div className="search-card-sub">
                    {pickingId === item.series_id ? (
                      <>
                        <RefreshCw size={13} className="spin" /> Đang lấy danh sách tập…
                      </>
                    ) : (
                      item.note || <>series_id {item.series_id}</>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default SearchPanel;
