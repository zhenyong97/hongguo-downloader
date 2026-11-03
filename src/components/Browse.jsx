import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import './Browse.css';
import { Film, RefreshCw, ExternalLink, Download, Play, Check, X, Sparkles } from './icons';
import { vi } from '../zhLabels';

/**
 * Browse —— duyệt phim theo danh mục
 *
 * Luồng dữ liệu:
 *   Trình duyệt nhúng bắt dữ liệu trang danh mục -> thẻ (series_id/tên phim/ảnh bìa/số tập/nhãn)
 *   Bấm thẻ -> dùng lại search-resolve để lấy đủ tập và ghi vào hồ sơ phim
 *         -> dùng lại get-series-episodes để lấy trạng thái từng tập «đã tải/đang tải/chưa tải»
 *         -> chuyển sang trình phát hoặc dùng luồng tải hàng loạt sẵn có
 */
function Browse({ onNavigate }) {
  const [categories, setCategories] = useState([]);
  const [category, setCategory] = useState('real-drama');
  const [genre, setGenre] = useState('');
  const [page, setPage] = useState(1);

  const [results, setResults] = useState([]);
  const [meta, setMeta] = useState({ total: 0, totalPages: 0, genres: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [pageTitle, setPageTitle] = useState('');

  // Ngăn kéo chi tiết
  const [detail, setDetail] = useState(null); // { series_id, series_title, cover, episodes: [...] }
  const [detailLoading, setDetailLoading] = useState(false);
  const [rangeInput, setRangeInput] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);

  // ===== Lọc nâng cao: quét nhiều trang + lọc theo điều kiện =====
  const [scan, setScan] = useState(null); // null=chỉ xem trang hiện tại; { pool, done, total, running }
  const [scanPages, setScanPages] = useState(5);
  const scanStop = useRef(false);
  const [keyword, setKeyword] = useState('');
  const [tagRule, setTagRule] = useState({}); // tag -> 'inc' | 'exc'
  const [minEp, setMinEp] = useState('');
  const [maxEp, setMaxEp] = useState('');

  // Thống kê đã tải (theo series_id -> số tập đã tải)
  const [downloadedMap, setDownloadedMap] = useState({});
  const [toast, setToast] = useState(null);

  const showToast = useCallback((text, type = 'success') => {
    setToast({ text, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  const loadDownloadedMap = useCallback(async () => {
    try {
      const list = (await window.electronAPI.getSeriesList()) || [];
      const map = {};
      for (const s of list) {
        const res = await window.electronAPI.getSeriesEpisodes(s.series_id);
        if (res && res.success) {
          map[String(s.series_id)] = {
            completed: res.data.completedCount,
            total: res.data.total,
          };
        }
      }
      setDownloadedMap(map);
    } catch (_) {}
  }, []);

  const loadCategories = useCallback(async () => {
    try {
      const list = await window.electronAPI.browseCategories();
      if (Array.isArray(list) && list.length) {
        setCategories(list);
      }
    } catch (_) {}
  }, []);

  const loadList = useCallback(
    async (cat, gen, pg) => {
      setLoading(true);
      setError('');
      try {
        const res = await window.electronAPI.browseList({ category: cat, genre: gen, page: pg });
        if (!res || !res.success) {
          setError((res && res.error) || 'Tải thất bại, vui lòng thử lại');
          setResults([]);
        } else {
          setResults(res.results || []);
          setMeta({ total: res.total || 0, totalPages: res.totalPages || 0, genres: res.genres || [] });
          setPageTitle(res.pageTitle || '');
          if (!res.results || res.results.length === 0) {
            setError('Không lấy được nội dung trang này, hãy thử đổi danh mục hoặc dùng “Hiện cửa sổ trình duyệt” để thao tác thủ công');
          }
        }
      } catch (e) {
        setError('Lỗi khi tải: ' + e.message);
        setResults([]);
      } finally {
        setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    loadCategories();
    loadDownloadedMap();
  }, [loadCategories, loadDownloadedMap]);

  useEffect(() => {
    loadList(category, genre, page);
  }, [category, genre, page, loadList]);

  const switchCategory = (slug) => {
    if (slug === category) return;
    setCategory(slug);
    setGenre('');
    setPage(1);
    setResults([]);
    resetScan();
  };

  const switchGenre = (slug) => {
    if (slug === genre) return;
    setGenre(slug);
    setPage(1);
    setResults([]);
    resetScan();
  };

  const resetScan = () => {
    scanStop.current = true;
    setScan(null);
    setTagRule({});
  };

  // Lấy lần lượt từng trang của danh mục/thể loại hiện tại, tối đa scanPages trang, loại trùng theo series_id
  const startScan = async () => {
    scanStop.current = false;
    const want = Math.max(1, parseInt(scanPages, 10) || 1);
    const pool = new Map();
    let total = want;
    setScan({ pool: [], done: 0, total, running: true });
    for (let p = 1; p <= total && !scanStop.current; p++) {
      try {
        const res = await window.electronAPI.browseList({ category, genre, page: p });
        if (res && res.success) {
          if (res.totalPages) total = Math.min(want, res.totalPages);
          for (const r of res.results || []) pool.set(String(r.series_id), r);
        }
      } catch (_) {}
      if (scanStop.current) return;
      setScan({ pool: [...pool.values()], done: p, total, running: p < total });
    }
  };

  const cycleTag = (t) => {
    setTagRule((prev) => {
      const next = { ...prev };
      if (!next[t]) next[t] = 'inc';
      else if (next[t] === 'inc') next[t] = 'exc';
      else delete next[t];
      return next;
    });
  };

  const source = scan ? scan.pool : results;

  // Các nhãn xuất hiện trong nguồn, sắp xếp theo số lần xuất hiện
  const tagOptions = useMemo(() => {
    const cnt = {};
    for (const r of source) for (const t of r.tags || []) cnt[t] = (cnt[t] || 0) + 1;
    return Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a]);
  }, [source]);

  const shown = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    const inc = Object.keys(tagRule).filter((t) => tagRule[t] === 'inc');
    const exc = Object.keys(tagRule).filter((t) => tagRule[t] === 'exc');
    const lo = parseInt(minEp, 10);
    const hi = parseInt(maxEp, 10);
    return source.filter((r) => {
      const tags = r.tags || [];
      if (kw && !String(r.series_title || '').toLowerCase().includes(kw)) return false;
      if (inc.some((t) => !tags.includes(t))) return false;
      if (exc.some((t) => tags.includes(t))) return false;
      if (!Number.isNaN(lo) && (r.episode_count || 0) < lo) return false;
      if (!Number.isNaN(hi) && (r.episode_count || 0) > hi) return false;
      return true;
    });
  }, [source, keyword, tagRule, minEp, maxEp]);

  const hasFilter = keyword.trim() || Object.keys(tagRule).length || minEp !== '' || maxEp !== '';

  const gotoPage = (p) => {
    const max = meta.totalPages || 1;
    const next = Math.min(Math.max(1, p), max);
    if (next === page) return;
    setPage(next);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // ===== Mở một phim =====
  const openSeries = async (item) => {
    setDetailLoading(true);
    setDetail(null);
    setSelectedIdx(new Set());
    setRangeInput('');
    try {
      const res = await window.electronAPI.searchResolve(item.series_id);
      if (!res || !res.success) {
        showToast((res && res.error) || 'Lấy danh sách tập thất bại', 'error');
        return;
      }
      const data = res.data;
      // Gộp trạng thái tải xuống
      const epRes = await window.electronAPI.getSeriesEpisodes(item.series_id);
      const statusMap = {};
      if (epRes && epRes.success) {
        for (const e of epRes.data.episodes) statusMap[e.vid_index] = e;
      }
      const episodes = data.episodes.map((ep) => ({
        ...ep,
        status: statusMap[ep.vid_index] ? statusMap[ep.vid_index].status : 'missing',
        progress: statusMap[ep.vid_index] ? statusMap[ep.vid_index].progress : 0,
        fileUrl: statusMap[ep.vid_index] ? statusMap[ep.vid_index].fileUrl : null,
      }));
      setDetail({ ...data, episodes, completedCount: episodes.filter((e) => e.status === 'completed').length });
      // Mặc định chọn hết các tập chưa tải
      setSelectedIdx(new Set(episodes.filter((e) => e.status !== 'completed').map((e) => e.vid_index)));
    } catch (e) {
      showToast('Mở thất bại: ' + e.message, 'error');
    } finally {
      setDetailLoading(false);
    }
  };

  const toggleIdx = (idx) => {
    const next = new Set(selectedIdx);
    if (next.has(idx)) next.delete(idx);
    else next.add(idx);
    setSelectedIdx(next);
  };

  // Chọn nhanh theo khoảng: 1-50 / 10 tập đầu / 30 tập cuối / chọn tất cả / bỏ chọn
  const applyRange = (expr) => {
    if (!detail) return;
    const total = detail.episodes.length;
    const nums = new Set();
    const push = (n) => {
      if (n >= 1 && n <= total) nums.add(n);
    };
    const parse = (s) => {
      const text = String(s || '').trim();
      if (!text) return;
      for (const part of text.split(/[,，]/)) {
        const p = part.trim();
        if (!p) continue;
        const m = p.match(/^(\d+)\s*[-~]\s*(\d+)$/);
        if (m) {
          const a = parseInt(m[1], 10);
          const b = parseInt(m[2], 10);
          for (let i = Math.min(a, b); i <= Math.max(a, b); i++) push(i);
        } else if (/^\d+$/.test(p)) {
          push(parseInt(p, 10));
        }
      }
    };
    parse(expr);
    setSelectedIdx(nums);
  };

  const downloadSelected = async () => {
    if (!detail || selectedIdx.size === 0) return;
    setSubmitting(true);
    try {
      const eps = detail.episodes.filter((e) => selectedIdx.has(e.vid_index));
      const res = await window.electronAPI.hongguoDownloadBatch({
        seriesId: detail.series_id,
        seriesTitle: detail.series_title,
        episodes: eps,
      });
      if (res && res.success) {
        showToast(`Đã thêm vào hàng đợi tải xuống: ${res.count} tập`);
        setDetail(null);
        if (onNavigate) onNavigate('manager');
      } else {
        showToast((res && res.error) || 'Gửi tải xuống thất bại', 'error');
      }
    } catch (e) {
      showToast('Lỗi khi gửi: ' + e.message, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  // Phát ngay: ưu tiên bắt đầu từ tập đã tải đầu tiên
  const playNow = async () => {
    if (!detail) return;
    const first = detail.episodes.find((e) => e.status === 'completed');
    if (!first) {
      showToast('Tập này chưa được tải, hãy bấm “Tải xuống mục đã chọn” trước rồi phát', 'error');
      return;
    }
    await window.electronAPI.playSeries({ seriesId: detail.series_id, vidIndex: first.vid_index });
    setDetail(null);
  };

  // Tải tất cả các tập của mọi phim trong trang này
  const downloadAllOnPage = async () => {
    if (!shown.length) return;
    if (!window.confirm(`Tải toàn bộ tập của ${shown.length} phim đang hiển thị?`)) return;
    setBulkBusy(true);
    try {
      const res = await window.electronAPI.downloadSeriesList(shown.map((r) => r.series_id));
      if (res && res.success) {
        const fail = res.failed && res.failed.length ? `, ${res.failed.length} phim lỗi` : '';
        showToast(`Đã thêm ${res.episodeCount} tập của ${res.seriesCount} phim vào hàng đợi${fail}`, fail ? 'error' : 'success');
        if (onNavigate) onNavigate('manager');
      } else {
        showToast((res && res.error) || 'Gửi tải xuống thất bại', 'error');
      }
    } catch (e) {
      showToast('Lỗi khi gửi: ' + e.message, 'error');
    } finally {
      setBulkBusy(false);
    }
  };

  const showBrowser = async () => {
    await window.electronAPI.searchWindowShow(true);
    showToast('Đã mở cửa sổ trình duyệt, bạn có thể thao tác thủ công; đóng cửa sổ rồi quay lại trang này để tiếp tục');
  };

  const totalPages = meta.totalPages || 0;
  const pageNumbers = useMemo(() => {
    if (!totalPages) return [];
    const out = [];
    const cur = page;
    const push = (n) => {
      if (n >= 1 && n <= totalPages && !out.includes(n)) out.push(n);
    };
    out.push(1);
    for (let i = cur - 1; i <= cur + 1; i++) push(i);
    out.push(totalPages);
    return out.sort((a, b) => a - b);
  }, [totalPages, page]);

  return (
    <div className="browse-container">
      <div className="browse-header">
        <div className="browse-title">
          <Sparkles size={22} />
          <h2>Khám phá</h2>
        </div>
        <div className="browse-header-right">
          {meta.total > 0 && <span className="browse-stat">Tổng cộng {meta.total} phim</span>}
          <button className="btn btn-primary" onClick={downloadAllOnPage} disabled={bulkBusy || loading || !shown.length}>
            {bulkBusy ? <RefreshCw size={15} className="spin" /> : <Download size={15} />}
            {bulkBusy ? `Đang thêm ${shown.length} phim…` : `Tải tất cả ${shown.length} phim đang hiển thị`}
          </button>
          <button className="btn btn-outline" onClick={showBrowser}>
            <ExternalLink size={15} />
            Hiện cửa sổ trình duyệt
          </button>
        </div>
      </div>

      {/* Tab danh mục */}
      <div className="browse-cats">
        {(categories.length ? categories : [{ slug: 'real-drama', label: 'Phim người đóng' }]).map((c) => (
          <button
            key={c.slug}
            className={`browse-cat ${category === c.slug ? 'active' : ''}`}
            onClick={() => switchCategory(c.slug)}
          >
            {c.label}
          </button>
        ))}
      </div>

      {/* Chip thể loại */}
      {meta.genres.length > 0 && (
        <div className="browse-genres">
          <button
            className={`genre-chip ${genre === '' ? 'active' : ''}`}
            onClick={() => switchGenre('')}
          >
            Tất cả
          </button>
          {meta.genres.map((g) => (
            <button
              key={g.slug}
              className={`genre-chip ${genre === g.slug ? 'active' : ''}`}
              onClick={() => switchGenre(g.slug)}
            >
              {vi(g.label)}
            </button>
          ))}
        </div>
      )}

      {/* Lọc nâng cao */}
      <div className="browse-filter">
        <div className="browse-filter-row">
          <input
            className="input-field"
            placeholder="Tên phim chứa (tiếng Trung)…"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
          <span className="browse-filter-label">Số tập</span>
          <input className="input-field browse-filter-num" type="number" min="0" placeholder="từ" value={minEp} onChange={(e) => setMinEp(e.target.value)} />
          <input className="input-field browse-filter-num" type="number" min="0" placeholder="đến" value={maxEp} onChange={(e) => setMaxEp(e.target.value)} />
          <span className="browse-filter-label">Quét</span>
          <input className="input-field browse-filter-num" type="number" min="1" max="200" value={scanPages} onChange={(e) => setScanPages(e.target.value)} />
          <span className="browse-filter-label">trang</span>
          {scan && scan.running ? (
            <button className="btn btn-outline" onClick={() => { scanStop.current = true; setScan((s) => s && { ...s, running: false }); }}>
              Dừng ({scan.done}/{scan.total})
            </button>
          ) : (
            <button className="btn btn-outline" onClick={startScan} disabled={loading}>
              <RefreshCw size={15} /> Quét nhiều trang
            </button>
          )}
          {(scan || hasFilter) && (
            <button className="btn-chip" onClick={() => { resetScan(); setKeyword(''); setMinEp(''); setMaxEp(''); }}>
              Xóa bộ lọc
            </button>
          )}
        </div>
        {tagOptions.length > 0 && (
          <div className="browse-filter-tags">
            {tagOptions.map((t) => (
              <button
                key={t}
                className={`genre-chip ${tagRule[t] === 'inc' ? 'tag-inc' : tagRule[t] === 'exc' ? 'tag-exc' : ''}`}
                onClick={() => cycleTag(t)}
                title="Bấm: bắt buộc có → loại trừ → bỏ chọn"
              >
                {tagRule[t] === 'inc' ? '+ ' : tagRule[t] === 'exc' ? '− ' : ''}{vi(t)}
              </button>
            ))}
          </div>
        )}
        <div className="browse-filter-sum">
          {scan
            ? `Đã quét ${scan.done}/${scan.total} trang · ${scan.pool.length} phim · khớp bộ lọc: ${shown.length}`
            : `Trang hiện tại: ${results.length} phim · khớp bộ lọc: ${shown.length}`}
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {loading ? (
        <div className="browse-loading">
          <RefreshCw size={18} className="spin" />
          <span>Đang tải nội dung danh mục…</span>
        </div>
      ) : (
        <div className="browse-grid">
          {shown.map((item) => {
            const dl = downloadedMap[String(item.series_id)];
            return (
              <div
                key={item.series_id}
                className="browse-card"
                onClick={() => openSeries(item)}
                title={item.series_title}
              >
                <div className="browse-cover">
                  {item.cover ? (
                    <img src={item.cover} alt={item.series_title} loading="lazy" />
                  ) : (
                    <div className="cover-placeholder"><Film size={22} /></div>
                  )}
                  {item.episode_count > 0 && (
                    <span className="browse-ep-badge">{item.episode_count} tập</span>
                  )}
                  {dl && dl.completed > 0 && (
                    <span className="browse-dl-badge">
                      <Check size={11} /> {dl.completed}/{dl.total}
                    </span>
                  )}
                  <div className="browse-hover">
                    <span className="browse-hover-play">
                      <Play size={16} /> {dl && dl.completed > 0 ? 'Phát' : 'Xem'}
                    </span>
                  </div>
                </div>
                <div className="browse-card-title">{item.series_title}</div>
                {item.tags && item.tags.length > 0 && (
                  <div className="browse-card-tags">
                    {item.tags.map((t) => (
                      <span key={t} className="browse-tag">{vi(t)}</span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Phân trang */}
      {totalPages > 1 && !scan && (
        <div className="browse-pager">
          <button className="pager-item" disabled={page <= 1} onClick={() => gotoPage(page - 1)}>‹</button>
          {pageNumbers.map((n, i) => (
            <React.Fragment key={n}>
              {i > 0 && n - pageNumbers[i - 1] > 1 && <span className="pager-gap">…</span>}
              <button
                className={`pager-item ${n === page ? 'active' : ''}`}
                onClick={() => gotoPage(n)}
              >
                {n}
              </button>
            </React.Fragment>
          ))}
          <button className="pager-item" disabled={page >= totalPages} onClick={() => gotoPage(page + 1)}>›</button>
        </div>
      )}

      {/* ===== Ngăn kéo chi tiết phim ===== */}
      {(detail || detailLoading) && (
        <div className="browse-drawer-mask" onClick={() => !detailLoading && setDetail(null)}>
          <div className="browse-drawer" onClick={(e) => e.stopPropagation()}>
            <div className="browse-drawer-head">
              <div className="browse-drawer-title">
                <Film size={18} />
                <span>{detail ? `“${detail.series_title}”` : 'Đang tải…'}</span>
              </div>
              <button className="icon-btn" onClick={() => setDetail(null)} title="Đóng">
                <X size={16} />
              </button>
            </div>

            {detailLoading && (
              <div className="browse-loading">
                <RefreshCw size={18} className="spin" />
                <span>Đang lấy toàn bộ tập…</span>
              </div>
            )}

            {detail && (
              <>
                <div className="browse-drawer-body">
                  <div className="browse-drawer-info">
                    {detail.cover && <img src={detail.cover} alt="" className="browse-drawer-cover" />}
                    <div className="browse-drawer-meta">
                      <div className="browse-drawer-count">
                        Tổng cộng {detail.total} tập · Đã tải <b>{detail.completedCount}</b> tập
                      </div>
                      <div className="browse-drawer-sub">Đã chọn {selectedIdx.size} tập chờ tải xuống</div>
                      <div className="browse-range-row">
                        <input
                          type="text"
                          className="input-field"
                          placeholder="Khoảng, VD: 1-50 hoặc 1,3,5"
                          value={rangeInput}
                          onChange={(e) => setRangeInput(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && applyRange(rangeInput)}
                        />
                        <button className="btn btn-outline btn-sm" onClick={() => applyRange(rangeInput)}>Áp dụng</button>
                      </div>
                      <div className="preset-row mt8">
                        <button className="btn-chip" onClick={() => applyRange(`1-${Math.min(10, detail.total)}`)}>10 tập đầu</button>
                        <button className="btn-chip" onClick={() => applyRange(`1-${Math.min(30, detail.total)}`)}>30 tập đầu</button>
                        <button className="btn-chip" onClick={() => applyRange(`${Math.max(1, detail.total - 29)}-${detail.total}`)}>30 tập cuối</button>
                        <button className="btn-chip" onClick={() => setSelectedIdx(new Set(detail.episodes.map((e) => e.vid_index)))}>Chọn tất cả</button>
                        <button className="btn-chip" onClick={() => setSelectedIdx(new Set())}>Bỏ chọn</button>
                      </div>
                    </div>
                  </div>

                  <div className="browse-eps">
                    {detail.episodes.map((ep) => (
                      <button
                        key={ep.vid_index}
                        className={`ep-chip ep-${ep.status} ${selectedIdx.has(ep.vid_index) ? 'ep-picked' : ''}`}
                        onClick={() => toggleIdx(ep.vid_index)}
                        title={vi(ep.title) || `Tập ${ep.vid_index}`}
                      >
                        <span className="ep-num">{ep.vid_index}</span>
                        {ep.status === 'completed' && <Check size={11} className="ep-badge" />}
                        {selectedIdx.has(ep.vid_index) && <span className="ep-pick-dot" />}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="browse-drawer-foot">
                  <button className="btn btn-outline" onClick={playNow}>
                    <Play size={15} />
                    Phát ngay
                  </button>
                  <div className="browse-foot-right">
                    <button
                      className="btn btn-primary"
                      disabled={submitting || selectedIdx.size === 0}
                      onClick={downloadSelected}
                    >
                      <Download size={15} />
                      Tải xuống mục đã chọn ({selectedIdx.size})
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {toast && (
        <div className={`dm-toast dm-toast-${toast.type}`} onClick={() => setToast(null)}>
          {toast.text}
        </div>
      )}
    </div>
  );
}

export default Browse;
