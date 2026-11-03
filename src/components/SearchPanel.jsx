import React, { useState } from 'react';
import './HongguoDownload.css';
import { Search, Film, RefreshCw, ExternalLink, Download } from './icons';

/**
 * SearchPanel —— 通过内嵌浏览器嗅探 hongguoduanju.com 的搜索结果
 * 拿到 series_id 后交给父组件走既有的「拉全集 + 选集下载」流程。
 */
function SearchPanel({ onSelectSeries, onSwitchToInput, onNavigate }) {
  const [keyword, setKeyword] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState(null); // null=未搜索, []=无结果
  const [error, setError] = useState('');
  const [pageTitle, setPageTitle] = useState('');
  const [pickingId, setPickingId] = useState('');
  const [bulkBusy, setBulkBusy] = useState(false);

  // 一键下载全部搜索结果的所有分集
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
      setError('Vui lòng nhập từ khóa tên phim');
      return;
    }
    setLoading(true);
    setError('');
    setResults(null);
    setPageTitle('');
    try {
      const res = await window.electronAPI.searchSeries(kw);
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

  // 选中某部剧 -> 拉取完整分集 -> 交给下载页
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
          placeholder="Nhập tên phim bằng tiếng Trung"
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
      </div>
      <p className="settings-hint" style={{ marginTop: 8 }}>
        Từ khóa sẽ được tìm trên hongguoduanju.com bằng trình duyệt tích hợp; chọn một kết quả để lấy toàn bộ tập và tải xuống ngay.
      </p>

      {error && <div className="alert alert-error">{error}</div>}

      {loading && (
        <div className="search-loading">
          <RefreshCw size={18} className="spin" />
          <span>Đang lấy kết quả tìm kiếm, lần đầu có thể mất vài giây…</span>
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
                  <div className="search-card-sub">
                    {pickingId === item.series_id ? (
                      <>
                        <RefreshCw size={13} className="spin" /> Đang lấy danh sách tập…
                      </>
                    ) : (
                      <>series_id {item.series_id}</>
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
