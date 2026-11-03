import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import './DownloadManager.css';
import { Download, Trash2, RefreshCw, X, Film, Square, Folder, Zap, CheckSquare, Play, Pause, Layers } from './icons';

const STATUS_TEXT = {
  pending: 'Đang chờ',
  downloading: 'Đang tải',
  completed: 'Hoàn thành',
  failed: 'Thất bại',
  stopped: 'Đã dừng',
};

const STATUS_ORDER = {
  downloading: 0,
  pending: 1,
  failed: 2,
  stopped: 3,
  completed: 4,
};

function sortTasks(list) {
  return [...list].sort((a, b) => {
    const wa = STATUS_ORDER[a.status] ?? 99;
    const wb = STATUS_ORDER[b.status] ?? 99;
    if (wa !== wb) return wa - wb;
    if (wa <= 1) {
      return (a.hongguoInfo?.vid_index || 0) - (b.hongguoInfo?.vid_index || 0) || (a.startTime || 0) - (b.startTime || 0);
    }
    return (b.endTime || b.startTime || 0) - (a.endTime || a.startTime || 0);
  });
}


function fmtBytes(bytes) {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = bytes;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return v.toFixed(v >= 100 || i === 0 ? 0 : 1) + ' ' + units[i];
}

function DownloadManager({ onNavigate }) {
  const [tasks, setTasks] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [toast, setToast] = useState(null);
  const [queue, setQueue] = useState({ active: 0, queued: 0, maxConcurrent: 3 });
  const [seriesList, setSeriesList] = useState([]);
  const [mergeSeriesId, setMergeSeriesId] = useState('');
  const [merging, setMerging] = useState(false);
  const [mergeTasks, setMergeTasks] = useState([]);
  const [confirmAsk, setConfirmAsk] = useState(null); // Xác nhận xóa (có thể tick để xóa cả file trên máy)
  const [mergeAsk, setMergeAsk] = useState(false);    // Chọn định dạng gộp
  const listenersRef = useRef([]);
  const toastTimerRef = useRef(null);

  const refresh = useCallback(async () => {
    const list = await window.electronAPI.getDownloadTasks();
    setTasks(list);
  }, []);

  const loadQueue = useCallback(async () => {
    try {
      const q = await window.electronAPI.getQueueStatus();
      if (q) setQueue(q);
    } catch (_) {}
  }, []);

  const loadSeriesList = useCallback(async () => {
    try {
      const list = (await window.electronAPI.getSeriesList()) || [];
      setSeriesList(list);
      setMergeSeriesId((prev) => prev || (list[0] ? String(list[0].series_id) : ''));
    } catch (_) {}
  }, []);

  const loadMergeTasks = useCallback(async () => {
    try {
      const list = (await window.electronAPI.getMergeTasks()) || [];
      setMergeTasks(list);
    } catch (_) {}
  }, []);

  const showToast = useCallback((text, type = 'success') => {
    setToast({ text, type });
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 3200);
  }, []);

  useEffect(() => () => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
  }, []);

  useEffect(() => {
    refresh();
    loadSeriesList();
    loadMergeTasks();
    const cleanups = [
      window.electronAPI.onDownloadProgress((data) => {
        setTasks((prev) =>
          prev.map((t) => (t.id === data.id ? { ...t, progress: data.progress, receivedBytes: data.receivedBytes, totalBytes: data.totalBytes, status: 'downloading' } : t))
        );
      }),
      window.electronAPI.onDownloadTaskAdded(() => refresh()),
      window.electronAPI.onDownloadCompleted((data) => {
        setTasks((prev) => prev.map((t) => (t.id === data.id ? { ...t, status: 'completed', progress: 100 } : t)));
      }),
      window.electronAPI.onDownloadFailed((data) => {
        setTasks((prev) => prev.map((t) => (t.id === data.id ? { ...t, status: 'failed', error: data.error } : t)));
      }),
      window.electronAPI.onDownloadStopped((data) => {
        setTasks((prev) => prev.map((t) => (t.id === data.id ? { ...t, status: 'stopped' } : t)));
      }),
      window.electronAPI.onDownloadQueueChanged(() => {
        refresh();
        loadQueue();
      }),
      window.electronAPI.onMergeTaskAdded(() => loadMergeTasks()),
      window.electronAPI.onMergeProgress((data) => {
        setMergeTasks((prev) =>
          prev.map((t) => (t.id === data.id ? { ...t, progress: data.progress, status: 'running' } : t))
        );
      }),
      window.electronAPI.onMergeCompleted((data) => {
        loadMergeTasks();
        showToast('Gộp xong: ' + (data.path ? data.path.split('\\').pop() : ''));
      }),
      window.electronAPI.onMergeFailed((data) => {
        loadMergeTasks();
        showToast('Gộp thất bại: ' + (data.error || 'Lỗi không xác định'), 'error');
      }),
    ];
    listenersRef.current = cleanups;
    return () => cleanups.forEach((c) => c());
  }, [refresh, loadQueue, loadMergeTasks, showToast]);

  // Thăm dò trạng thái hàng đợi: hiển thị «đang chạy x / giới hạn đồng thời y» theo thời gian thực
  useEffect(() => {
    refresh();
    loadSeriesList();
    loadMergeTasks();
  }, [refresh, loadSeriesList, loadMergeTasks]);

  // Thăm dò trạng thái hàng đợi: hiển thị «đang chạy x / giới hạn đồng thời y» theo thời gian thực
  useEffect(() => {
    loadQueue();
    const timer = setInterval(() => {
      loadQueue();
      // Cần làm mới trạng thái khi tác vụ đồng thời hoàn tất (sự kiện completed/failed đã xử lý, đây là dự phòng)
      refresh();
      // Làm mới tiến độ gộp (dự phòng)
      setMergeTasks((prev) => {
        if (prev.some((t) => t.status === 'running')) loadMergeTasks();
        return prev;
      });
    }, 2000);
    return () => clearInterval(timer);
  }, [loadQueue, refresh, loadMergeTasks]);

  const toggleSelect = (id) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const clearSelection = () => setSelected(new Set());

  const deleteTask = async (id) => {
    await window.electronAPI.deleteTask(id);
    refresh();
  };

  const fmtSize = (b) => {
    if (!b || b <= 0) return '0 B';
    const u = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0;
    let v = b;
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
    return v.toFixed(v >= 100 || i === 0 ? 0 : 1) + ' ' + u[i];
  };

  /** Hiện hộp xác nhận xóa: mặc định chỉ xóa bản ghi, có thể tick để xóa cả file trên máy */
  const askDelete = (list, label) => {
    const items = (list || []).filter(Boolean);
    if (!items.length) return;
    // Ước tính dung lượng giải phóng được từ số byte đã tải (chỉ có ý nghĩa với tác vụ đã xong)
    const estBytes = items.reduce((s, t) => s + (t.totalBytes || t.receivedBytes || 0), 0);
    const withFile = items.filter((t) => t.status === 'completed').length;
    setConfirmAsk({
      title: label,
      count: items.length,
      withFile,
      estBytes,
      onOk: async (deleteFiles) => {
        const ids = items.map((t) => t.id);
        const res = await window.electronAPI.deleteTasksWithFiles(ids, deleteFiles);
        setSelected(new Set());
        await refresh();
        if (res && res.success) {
          showToast(deleteFiles
            ? `Đã xóa ${res.count} tác vụ, giải phóng ${fmtSize(res.freed)}`
            : `Đã xóa ${res.count} bản ghi tác vụ (giữ lại tệp cục bộ)`);
        }
      },
    });
  };

  const deleteSelected = async () => {
    if (selected.size === 0) return;
    askDelete(tasks.filter((t) => selected.has(t.id)), 'Xóa các tác vụ đã chọn');
  };
  const retrySelected = async () => {
    if (selected.size === 0) return;
    const res = await window.electronAPI.retryTasks(Array.from(selected));
    setSelected(new Set());
    await refresh();
    if (res && res.success) {
      showToast(res.count > 0 ? `Đã đưa lại vào hàng đợi: ${res.count} mục` : 'Không có tác vụ nào có thể thử lại trong các mục đã chọn');
    } else {
      showToast((res && res.error) || 'Thử lại thất bại', 'error');
    }
  };

  // Gộp các phim đã chọn
  const doMerge = async (compatible) => {
    if (!mergeSeriesId) {
      showToast('Vui lòng chọn phim ngắn cần gộp trước', 'error');
      return;
    }
    setMergeAsk(false);
    setMerging(true);
    try {
      const res = await window.electronAPI.mergeSeries(mergeSeriesId, '', { compatible });
      if (!res || !res.success) {
        showToast((res && res.error) || 'Gộp thất bại', 'error');
        return;
      }
      await loadMergeTasks();
      const sizeGb = (res.totalBytes / 1073741824).toFixed(2);
      const mins = Math.round(res.totalDuration / 60);
      showToast(compatible
        ? `Bắt đầu gộp tương thích ${res.count} tập (H.264, mất khá nhiều thời gian)`
        : `Bắt đầu gộp ${res.count} tập (khoảng ${sizeGb} GB / ${mins} phút)`);
      if (res.codecWarning) showToast(res.codecWarning, 'error');
    } catch (e) {
      showToast('Lỗi khi gộp: ' + e.message, 'error');
    } finally {
      setMerging(false);
    }
  };

  const cancelMerge = async (id) => {
    await window.electronAPI.cancelMerge(id);
    await loadMergeTasks();
    showToast('Đã hủy gộp');
  };

  const openMergedFile = async (path) => {
    if (!path) return;
    await window.electronAPI.showInFolder(path);
  };

  // Tạm dừng tất cả: hủy tác vụ đang chạy + xóa hàng đợi
  const pauseAll = async () => {
    const res = await window.electronAPI.pauseAll();
    await refresh();
    await loadQueue();
    showToast(res && res.success ? `Đã tạm dừng ${res.count} tác vụ` : 'Tạm dừng thất bại', res && res.success ? 'success' : 'error');
  };

  // Chạy tất cả: đưa mọi tác vụ đã dừng/lỗi/đang chờ vào hàng đợi chạy lại
  const resumeAll = async () => {
    const res = await window.electronAPI.resumeAll();
    await refresh();
    await loadQueue();
    showToast(res && res.success ? `Đã bắt đầu ${res.count} tác vụ` : 'Bắt đầu thất bại', res && res.success ? 'success' : 'error');
  };

  // Thử lại tất cả tác vụ lỗi/đã dừng
  const retryAllFailed = async () => {
    const ids = tasks.filter((t) => t.status === 'failed' || t.status === 'stopped').map((t) => t.id);
    if (ids.length === 0) return;
    const res = await window.electronAPI.retryTasks(ids);
    await refresh();
    if (res && res.success) {
      showToast(`Đã đưa lại vào hàng đợi: ${res.count} mục`);
    } else {
      showToast((res && res.error) || 'Thử lại thất bại', 'error');
    }
  };

  // Chọn tất cả tác vụ lỗi/đã dừng (chọn xong có thể bấm «Thử lại mục đã chọn»)
  const selectAllFailed = () => {
    const ids = tasks.filter((t) => t.status === 'failed' || t.status === 'stopped').map((t) => t.id);
    if (ids.length === 0) {
      showToast('Không có tác vụ thất bại hoặc đã dừng');
      return;
    }
    setSelected(new Set(ids));
    showToast(`Đã chọn ${ids.length} mục, bấm “Thử lại mục đã chọn” để tải lại`);
  };

  const clearCompleted = async () => {
    const done = tasks.filter((t) => t.status === 'completed');
    if (done.length === 0) return;
    askDelete(done, 'Xóa các tác vụ đã hoàn thành');
  };

  const sortedTasks = useMemo(() => sortTasks(tasks), [tasks]);

  const activeCount = tasks.filter((t) => t.status === 'downloading' || t.status === 'pending').length;
  const completedCount = tasks.filter((t) => t.status === 'completed').length;
  const failedTasks = useMemo(
    () => tasks.filter((t) => t.status === 'failed' || t.status === 'stopped'),
    [tasks]
  );
  const failedCount = failedTasks.length;

  // Tác vụ có thể tạm dừng: đang tải, đang chờ, đã dừng (mọi tác vụ chưa chạy xong)
  const pausableCount = useMemo(
    () => tasks.filter((t) => t.status !== 'completed').length,
    [tasks]
  );

  // Số mục thực sự có thể thử lại trong các mục đã chọn
  const retryableSelectedCount = useMemo(
    () =>
      Array.from(selected).filter((id) => {
        const t = tasks.find((x) => x.id === id);
        return t && (t.status === 'failed' || t.status === 'stopped');
      }).length,
    [selected, tasks]
  );

  return (
    <div className="dm-container">
      <div className="dm-header">
        <div className="dm-title">
          <Download size={22} />
          <h2>Quản lý tải xuống</h2>
        </div>
        <div className="dm-stats">
          <span className="stat stat-active">Đang chạy {activeCount}</span>
          <span className="stat stat-done">Hoàn thành {completedCount}</span>
          <span className="stat stat-fail">Thất bại/Đã dừng {failedCount}</span>
        </div>
      </div>

      <div className="dm-toolbar">
        <button
          className="btn btn-primary"
          onClick={resumeAll}
          disabled={queue.active > 0 || pausableCount === 0}
          title="Đưa tất cả tác vụ đang chờ / đã dừng / thất bại vào hàng đợi để chạy"
        >
          <Play size={15} />
          Bắt đầu tất cả
        </button>
        <button
          className="btn btn-danger-solid"
          onClick={pauseAll}
          disabled={pausableCount === 0}
          title="Tạm dừng tất cả: hủy các tác vụ đang tải và xóa hàng đợi"
        >
          <Pause size={15} />
          Tạm dừng tất cả
        </button>
        <button
          className="btn btn-primary"
          onClick={retryAllFailed}
          disabled={failedCount === 0}
          title="Đưa tất cả tác vụ thất bại/đã dừng trở lại hàng đợi tải xuống"
        >
          <Zap size={15} />
          {failedCount > 0 ? `Thử lại tất cả mục thất bại (${failedCount})` : 'Thử lại tất cả mục thất bại'}
        </button>
        <button
          className="btn btn-outline"
          onClick={selectAllFailed}
          disabled={failedCount === 0}
          title="Chọn tất cả tác vụ thất bại/đã dừng"
        >
          <CheckSquare size={15} />
          {failedCount > 0 ? `Chọn mục thất bại (${failedCount})` : 'Chọn mục thất bại'}
        </button>
        <button className="btn btn-outline" onClick={retrySelected} disabled={retryableSelectedCount === 0}>
          <RefreshCw size={15} />
          Thử lại mục đã chọn ({retryableSelectedCount})
        </button>
        <button className="btn btn-outline" onClick={deleteSelected} disabled={selected.size === 0}>
          <Trash2 size={15} />
          Xóa mục đã chọn
        </button>
        <button className="btn btn-outline" onClick={clearCompleted} disabled={completedCount === 0}>
          <X size={15} />
          Xóa mục đã hoàn thành
        </button>
        <button className="btn btn-outline" onClick={clearSelection} disabled={selected.size === 0}>
          Bỏ chọn
        </button>
        <button
          className="btn btn-outline"
          onClick={async () => {
            const r = await window.electronAPI.rescanDownloads();
            await refresh();
            showToast(r && r.success
              ? (r.count > 0 ? `Đã khôi phục ${r.count} bản ghi tải xuống từ ổ đĩa` : 'Không tìm thấy tệp nào chưa được ghi nhận')
              : 'Quét thất bại');
          }}
          title="Quét thư mục tải xuống, ghi nhận lại các tệp có trên ổ đĩa nhưng chưa có trong danh sách"
        >
          <RefreshCw size={15} />
          Quét thư mục để ghi nhận
        </button>
        {seriesList.length > 0 && (
          <div className="merge-inline">
            <select
              className="input-field merge-select"
              value={mergeSeriesId}
              onChange={(e) => setMergeSeriesId(e.target.value)}
              title="Chọn phim ngắn cần gộp"
            >
              {seriesList.map((s) => (
                <option key={s.series_id} value={String(s.series_id)}>
                  {s.series_title}
                </option>
              ))}
            </select>
            <button className="btn btn-outline" onClick={() => setMergeAsk(true)} disabled={merging} title="Gộp các tập đã tải của phim này thành một tệp mp4">
              <Layers size={15} />
              {merging ? 'Đang gộp...' : 'Gộp phim này'}
            </button>
          </div>
        )}
        {onNavigate && (
          <button className="btn btn-primary dm-toolbar-end" onClick={() => onNavigate('download')}>
            <Film size={15} />
            Đi tải xuống
          </button>
        )}
      </div>

      {/* Tác vụ gộp */}
      {mergeTasks.length > 0 && (
        <div className="merge-list">
          {mergeTasks.map((m) => (
            <div key={m.id} className={`merge-card merge-${m.status}`}>
              <Layers size={16} />
              <div className="merge-body">
                <div className="merge-title">
                  Gộp “{m.seriesTitle}” · {m.done || 0}/{m.total} tập
                </div>
                <div className="merge-sub">
                  {m.status === 'running' && <>Đang gộp… {m.progress || 0}%</>}
                  {m.status === 'completed' && (
                    <>
                      Hoàn thành · {m.outputName}
                      {m.outputBytes ? ` · ${(m.outputBytes / 1073741824).toFixed(2)} GB` : ''}
                    </>
                  )}
                  {m.status === 'failed' && <>Thất bại: {m.error}</>}
                  {m.status === 'stopped' && <>Đã hủy</>}
                </div>
                {(m.status === 'running') && (
                  <div className="dm-progress">
                    <div className="dm-progress-bar">
                      <div className="dm-progress-fill" style={{ width: `${m.progress || 0}%` }} />
                    </div>
                    <span className="dm-pct">{m.progress || 0}%</span>
                  </div>
                )}
              </div>
              <div className="merge-actions">
                {m.status === 'running' && (
                  <button className="icon-btn" title="Hủy gộp" onClick={() => cancelMerge(m.id)}>
                    <X size={16} />
                  </button>
                )}
                {m.status === 'completed' && (
                  <button className="icon-btn" title="Mở thư mục chứa tệp" onClick={() => openMergedFile(m.output)}>
                    <Folder size={16} />
                  </button>
                )}
                {m.status !== 'running' && (
                  <button
                    className="icon-btn icon-btn-danger"
                    title="Xóa bản ghi"
                    onClick={async () => {
                      await window.electronAPI.deleteMergeTask(m.id);
                      loadMergeTasks();
                    }}
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {queue.active > 0 && (
        <div className="dm-queue-bar">
          <span className="dm-queue-running">
            <span className="dm-queue-pulse" />
            Đang tải đồng thời <b>{queue.active}</b> / {queue.maxConcurrent}
            {queue.queued > 0 ? <> · Đang chờ trong hàng đợi <b>{queue.queued}</b></> : null}
          </span>
          <span className="dm-queue-hint">
            Có thể chỉnh số lượng tải đồng thời tại “Cài đặt → Số lượt tải đồng thời tối đa”
          </span>
        </div>
      )}

      {retryableSelectedCount > 0 && (
        <div className="dm-hint">
          Đã chọn <b>{retryableSelectedCount}</b> mục thất bại, bấm
          <b>“Thử lại mục đã chọn”</b> để tải lại (không cần phân tích lại).
        </div>
      )}

      {sortedTasks.length === 0 ? (
        <div className="dm-empty">
          <Download size={40} />
          <p>Chưa có tác vụ tải xuống</p>
          <p className="dm-empty-sub">Hãy vào “Tải Hongguo” để phân tích phim ngắn và gửi tải xuống</p>
        </div>
      ) : (
        <div className="dm-list">
          {sortedTasks.map((task) => {

            const isSel = selected.has(task.id);
            const isActive = task.status === 'downloading' || task.status === 'pending';
            const canStop = task.status === 'downloading';
            const canRetry = task.status === 'failed' || task.status === 'stopped';
            const pct = task.progress || 0;
            return (
              <div key={task.id} className={`dm-task ${isSel ? 'selected' : ''}`} onClick={() => toggleSelect(task.id)}>
                <div className="dm-task-cover">
                  {task.videoInfo && task.videoInfo.cover ? (
                    <img src={task.videoInfo.cover} alt="" />
                  ) : (
                    <div className="cover-placeholder"><Film size={18} /></div>
                  )}
                </div>
                <div className="dm-task-body">
                  <div className="dm-task-title">{task.title || task.filename}</div>
                  <div className="dm-task-meta">
                    <span className={`status-tag status-${task.status}`}>{STATUS_TEXT[task.status] || task.status}</span>
                    {task.status === 'downloading' && task.totalBytes > 0 && (
                      <span className="dm-size">{fmtBytes(task.receivedBytes)} / {fmtBytes(task.totalBytes)}</span>
                    )}
                    {task.status === 'failed' && task.error && <span className="dm-error">{task.error}</span>}
                  </div>
                  {(task.status === 'downloading' || task.status === 'pending') && (
                    <div className="dm-progress">
                      <div className="dm-progress-bar">
                        <div className="dm-progress-fill" style={{ width: pct + '%' }}></div>
                      </div>
                      <span className="dm-pct">{pct}%</span>
                    </div>
                  )}
                </div>
                <div className="dm-task-actions" onClick={(e) => e.stopPropagation()}>
                  {canStop && (
                    <button className="icon-btn" title="Dừng" onClick={() => { window.electronAPI.stopDownload(task.id); refresh(); }}>
                      <Square size={16} />
                    </button>
                  )}
                  {canRetry && (
                    <button className="icon-btn" title="Thử lại" onClick={() => { window.electronAPI.retryTask(task.id); }}>
                      <RefreshCw size={16} />
                    </button>
                  )}
                  <button className="icon-btn" title="Mở thư mục" onClick={() => window.electronAPI.openFolder(task.id)}>
                    <Folder size={16} />
                  </button>
                  <button
                    className="icon-btn icon-btn-danger"
                    title="Xóa tác vụ (có thể chọn xóa luôn tệp cục bộ)"
                    onClick={() => {
                      askDelete([task], `Xóa tác vụ “${task.hongguoInfo && task.hongguoInfo.series_title ? task.hongguoInfo.series_title : ''}” Tập ${task.hongguoInfo ? task.hongguoInfo.vid_index : ''}`);
                    }}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {toast && (
        <div className={`dm-toast dm-toast-${toast.type}`} onClick={() => setToast(null)}>
          {toast.text}
        </div>
      )}

      {/* Chọn định dạng gộp */}
      {mergeAsk && (
        <div className="player-confirm-mask" onClick={() => setMergeAsk(false)}>
          <div className="player-confirm" onClick={(e) => e.stopPropagation()}>
            <div className="player-confirm-title" style={{ color: 'var(--accent)' }}>
              <Layers size={17} />
              Gộp và xuất toàn bộ phim
            </div>
            <div className="player-confirm-msg">
              <p>Gộp các tập đã tải của phim này thành một tệp mp4.</p>
              <p><b>Gộp nhanh</b>: nối trực tiếp giữ nguyên chất lượng gốc, xong trong vài giây, nhưng định dạng vẫn là HEVC — trên một số máy tính có thể bị màn hình đen nhưng có tiếng.</p>
              <p><b>Gộp tương thích</b>: chuyển mã sang H.264, phát được trên mọi máy tính/trình phát, nhưng chậm (mỗi phút video mất khoảng vài giây).</p>
            </div>
            <div className="player-confirm-foot">
              <button className="btn btn-outline" onClick={() => setMergeAsk(false)}>Hủy</button>
              <button className="btn btn-outline" onClick={() => doMerge(true)} disabled={merging}>
                Gộp tương thích (H.264)
              </button>
              <button className="btn btn-primary" onClick={() => doMerge(false)} disabled={merging}>
                Gộp nhanh
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Xác nhận xóa (tùy chọn xóa cả file trên máy) */}
      {confirmAsk && (
        <div className="player-confirm-mask" onClick={() => setConfirmAsk(null)}>
          <div className="player-confirm" onClick={(e) => e.stopPropagation()}>
            <div className="player-confirm-title">
              <Trash2 size={17} />
              {confirmAsk.title}
            </div>
            <div className="player-confirm-msg">
              <p>Tổng cộng {confirmAsk.count} tác vụ, trong đó {confirmAsk.withFile} tác vụ đã tải xong
                {confirmAsk.estBytes > 0 ? ` (khoảng ${fmtSize(confirmAsk.estBytes)})` : ''}.</p>
              <label className="dm-confirm-check">
                <input
                  type="checkbox"
                  checked={!!confirmAsk._del}
                  onChange={(e) => setConfirmAsk({ ...confirmAsk, _del: e.target.checked })}
                />
                <span>
                  Xóa luôn tệp cục bộ
                  {confirmAsk.estBytes > 0 ? ` (giải phóng khoảng ${fmtSize(confirmAsk.estBytes)})` : ''}
                </span>
              </label>
              <p className="dm-confirm-hint">
                Nếu không chọn, chỉ xóa bản ghi tác vụ, tệp video trên ổ đĩa vẫn được giữ lại (bạn có thể tự quản lý trong trình quản lý tệp).
              </p>
            </div>
            <div className="player-confirm-foot">
              <button className="btn btn-outline" onClick={() => setConfirmAsk(null)}>Hủy</button>
              <button
                className={`btn ${confirmAsk._del ? 'btn-danger-solid' : 'btn-primary'}`}
                onClick={async () => {
                  const fn = confirmAsk.onOk;
                  const del = !!confirmAsk._del;
                  setConfirmAsk(null);
                  await fn(del);
                }}
              >
                {confirmAsk._del ? 'Xóa tác vụ và tệp' : 'Chỉ xóa bản ghi'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default DownloadManager;
