import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import './Player.css';
import { Play, Film, Download, Check, RefreshCw, Layers, X, Trash2, ChevronDown, Zap } from './icons';
import { vi } from '../zhLabels';

/**
 * Player —— 内置播放器
 *
 * 设计要点：
 *  - 直接播本地 file:// 文件（实测支持 seek），无需流服务器
 *  - 「边下边看」：下一集若还在下载，显示等待态并轮询，下完自动接上
 *  - 断点续播：按 series_id 记住看到第几集、第几秒
 */
function Player({ target, onNavigate }) {
  const [seriesList, setSeriesList] = useState([]);
  const [activeSeriesId, setActiveSeriesId] = useState('');
  const [detail, setDetail] = useState(null); // { series_title, episodes: [...], total, completedCount }
  const [currentIndex, setCurrentIndex] = useState(1);
  const [autoNext, setAutoNext] = useState(true);
  const [waitingFor, setWaitingFor] = useState(null); // 正在等待下载的集号
  const [toast, setToast] = useState(null);
  const [loading, setLoading] = useState(false);
  const [merging, setMerging] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);   // 剧集选择面板
  const [pickerQuery, setPickerQuery] = useState('');
  const [dismissedCount, setDismissedCount] = useState(0);

  // 在线播放（内存缓存，不落盘）
  const [onlineVid, setOnlineVid] = useState(null);
  const [onlineUrl, setOnlineUrl] = useState('');
  const [onlineProgress, setOnlineProgress] = useState(null); // {percent, phase}
  const [cacheInfo, setCacheInfo] = useState({ count: 0, bytes: 0 });
  const [downloadedMap, setDownloadedMap] = useState({}); // series_id -> {completed,total}
  const [storageMap, setStorageMap] = useState({});       // series_id -> {files,bytes}
  const [storageTotal, setStorageTotal] = useState({ files: 0, bytes: 0 });
  const [autoDelete, setAutoDelete] = useState(false);    // 看完自动删本地文件
  const [confirmAsk, setConfirmAsk] = useState(null);     // {title, message, danger, onOk}

  // 兼容模式：本机解不了 HEVC 时转码为 H.264
  const [autoCompat, setAutoCompat] = useState(true);
  const [compatMap, setCompatMap] = useState({});         // vidIndex -> 转码后 url
  const [compatProgress, setCompatProgress] = useState(null); // {vidIndex, percent}
  const [decodeFailed, setDecodeFailed] = useState(false);    // 当前集解不出画面
  const [compatCache, setCompatCache] = useState({ files: 0, bytes: 0 });
  const [mergeAsk, setMergeAsk] = useState(false);            // 合并格式选择

  const videoRef = useRef(null);
  const toastTimer = useRef(null);
  const pendingSeekRef = useRef(0); // 切集后要跳转的秒数
  const lastSavedRef = useRef(0);
  const stateRef = useRef({ currentIndex, autoNext, activeSeriesId });
  stateRef.current = { currentIndex, autoNext, activeSeriesId };

  const showToast = useCallback((text) => {
    setToast(text);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  }, []);

  // 载入已登记的剧集列表
  const loadSeriesList = useCallback(async () => {
    const list = (await window.electronAPI.getSeriesList()) || [];
    setSeriesList(list);
    return list;
  }, []);

  // 载入某剧的分集状态
  const loadDetail = useCallback(async (seriesId, opts = {}) => {
    if (!seriesId) return null;
    const res = await window.electronAPI.getSeriesEpisodes(seriesId);
    if (!res || !res.success) return null;
    setDetail(res.data);
    return res.data;
  }, []);

  const refreshCacheInfo = useCallback(async () => {
    try {
      const res = await window.electronAPI.onlineCacheStatus();
      if (res && res.success) setCacheInfo({ count: res.count, bytes: res.bytes });
      const dc = await window.electronAPI.dismissedCount();
      setDismissedCount(dc || 0);
      const st = await window.electronAPI.getStorageUsage();
      if (st && st.success) {
        const map = {};
        for (const s of st.series) map[String(s.series_id)] = { files: s.files, bytes: s.bytes, merged: s.merged };
        setStorageMap(map);
        setStorageTotal({ files: st.totalFiles, bytes: st.totalBytes });
      }
    } catch (_) {}
  }, []);

  const fmtSize = (b) => {
    if (!b || b <= 0) return '0 B';
    const u = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0;
    let v = b;
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
    return v.toFixed(v >= 100 || i === 0 ? 0 : 1) + ' ' + u[i];
  };

  useEffect(() => {
    refreshCacheInfo();
    window.electronAPI.getSettings().then((s) => {
      if (s) {
        setAutoDelete(s.auto_delete_watched === true);
        setAutoCompat(s.compat_mode !== false); // 默认开启
      }
    });
    window.electronAPI.compatCacheStatus().then((r) => {
      if (r && r.success) setCompatCache({ files: r.files, bytes: r.bytes });
    });
  }, [refreshCacheInfo]);

  useEffect(() => {
    if (!window.electronAPI.onTranscodeProgress) return undefined;
    return window.electronAPI.onTranscodeProgress((d) => {
      if (d.done) return;
      setCompatProgress({ vidIndex: d.vidIndex, percent: d.percent || 0 });
    });
  }, []);

  /**
   * 注意：以下三个用到 episodes 的函数必须定义在 episodes 之后。
   * useCallback 的依赖数组在「定义时」就会求值，若提前引用后声明的 const
   * 会触发 TDZ（Cannot access 'X' before initialization）导致整页白屏。
   */
  const toggleAutoCompat = async () => {
    const next = !autoCompat;
    setAutoCompat(next);
    try {
      const s = await window.electronAPI.getSettings();
      await window.electronAPI.saveSettings({ ...s, compat_mode: next });
      showToast(next ? 'Đã bật Chế độ tương thích: tự chuyển mã khi không giải mã được' : 'Đã tắt Chế độ tương thích');
    } catch (_) {}
  };

  const toggleAutoDelete = async () => {
    const next = !autoDelete;
    setAutoDelete(next);
    try {
      const s = await window.electronAPI.getSettings();
      await window.electronAPI.saveSettings({ ...s, auto_delete_watched: next });
      showToast(next ? 'Đã bật: xem xong một tập sẽ tự xóa tệp cục bộ' : 'Đã tắt tự xóa');
    } catch (_) {}
  };

  // 打开剧集面板时，补全各剧的下载进度（只拉一次）
  useEffect(() => {
    if (!pickerOpen) return;
    let cancelled = false;
    (async () => {
      const map = {};
      for (const s of seriesList) {
        try {
          const res = await window.electronAPI.getSeriesEpisodes(s.series_id);
          if (res && res.success) map[String(s.series_id)] = { completed: res.data.completedCount, total: res.data.total };
        } catch (_) {}
        if (cancelled) return;
      }
      if (!cancelled) setDownloadedMap(map);
    })();
    return () => { cancelled = true; };
  }, [pickerOpen, seriesList]);

  useEffect(() => {
    if (!window.electronAPI.onOnlinePlayProgress) return undefined;
    return window.electronAPI.onOnlinePlayProgress((d) => {
      setOnlineProgress({
        vid: d.vid,
        percent: d.percent || 0,
        phase: d.phase || 'downloading',
        received: d.received,
        total: d.total,
      });
    });
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const list = await loadSeriesList();
      if (list.length) {
        // 浏览页点播时优先用指定剧，否则选最近更新的那部
        const wanted = target && target.seriesId ? String(target.seriesId) : '';
        const exists = wanted && list.some((s) => String(s.series_id) === wanted);
        const sorted = [...list].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
        const sid = exists ? wanted : sorted[0].series_id;
        setActiveSeriesId(sid);
        const d = await loadDetail(sid);

        if (exists && target.vidIndex) {
          // 点播指定集：优先播它（若尚未下载则交给等待逻辑）
          setCurrentIndex(target.vidIndex);
          const ep = d && d.episodes.find((e) => e.vid_index === target.vidIndex);
          if (ep && ep.status !== 'completed') setWaitingFor(target.vidIndex);
        } else {
          // 恢复断点
          const saved = await window.electronAPI.getPlaybackPosition(sid);
          if (saved && saved.vid_index) setCurrentIndex(saved.vid_index);
          else if (d) {
            const firstPlayable = d.episodes.find((e) => e.status === 'completed');
            setCurrentIndex(firstPlayable ? firstPlayable.vid_index : 1);
          }
          pendingSeekRef.current = saved ? saved.currentTime || 0 : 0;
        }
      }
      setLoading(false);
    })();
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadSeriesList, loadDetail]);

  // 浏览页再次点播（组件已挂载时）
  const handledTargetRef = useRef(0);
  useEffect(() => {
    if (!target || !target.seriesId || !target.ts) return;
    if (handledTargetRef.current === target.ts) return;
    handledTargetRef.current = target.ts;
    (async () => {
      const list = await loadSeriesList();
      const wanted = String(target.seriesId);
      if (!list.some((s) => String(s.series_id) === wanted)) return;
      setActiveSeriesId(wanted);
      setWaitingFor(null);
      pendingSeekRef.current = 0;
      const d = await loadDetail(wanted);
      if (target.vidIndex) {
        setCurrentIndex(target.vidIndex);
        const ep = d && d.episodes.find((e) => e.vid_index === target.vidIndex);
        if (ep && ep.status !== 'completed') setWaitingFor(target.vidIndex);
      } else if (d) {
        const firstPlayable = d.episodes.find((e) => e.status === 'completed');
        setCurrentIndex(firstPlayable ? firstPlayable.vid_index : 1);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target && target.ts]);

  // 轮询：让「正在下载」的集实时更新，并在等待时自动接上
  useEffect(() => {
    if (!activeSeriesId) return;
    const timer = setInterval(async () => {
      const d = await loadDetail(activeSeriesId);
      if (!d) return;
      const { waitingFor: wf } = stateRef.current;
      if (wf != null) {
        const ep = d.episodes.find((e) => e.vid_index === wf);
        if (ep && ep.status === 'completed') {
          // 等待中的下一集下好了 -> 自动切过去
          setWaitingFor(null);
          goToEpisode(wf, true);
        }
      }
    }, 2000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSeriesId, loadDetail]);

  const episodes = detail ? detail.episodes : [];
  const current = useMemo(
    () => episodes.find((e) => e.vid_index === currentIndex) || null,
    [episodes, currentIndex]
  );

  const playableCount = episodes.filter((e) => e.status === 'completed').length;

  /** 转码当前集为 H.264 后播放（解决本机无法解码 HEVC 的黑屏问题） */
  const startCompatPlay = useCallback(
    async (vidIndex) => {
      const ep = episodes.find((e) => e.vid_index === vidIndex);
      if (!ep) return;
      setCompatProgress({ vidIndex, percent: 0 });
      try {
        const res = await window.electronAPI.transcodeForPlayback({
          seriesId: activeSeriesId,
          vidIndex,
          vid: ep.vid,
          filePath: ep.savePath || null,
        });
        if (res && res.success) {
          setCompatMap((prev) => ({ ...prev, [vidIndex]: res.url }));
          setDecodeFailed(false);
          setCompatProgress(null);
          showToast(res.cached ? 'Đã chuyển sang phát định dạng tương thích' : `Đã chuyển mã sang định dạng tương thích (mất ${res.elapsed}s), bắt đầu phát`);
          window.electronAPI.compatCacheStatus().then((r) => {
            if (r && r.success) setCompatCache({ files: r.files, bytes: r.bytes });
          });
        } else {
          setCompatProgress(null);
          showToast((res && res.error) || 'Chuyển mã thất bại');
        }
      } catch (e) {
        setCompatProgress(null);
        showToast('Lỗi chuyển mã: ' + e.message);
      }
    },
    [episodes, activeSeriesId, showToast]
  );

  const clearCompatCache = async () => {
    const r = await window.electronAPI.clearCompatCache();
    setCompatCache({ files: 0, bytes: 0 });
    showToast(r && r.count > 0 ? `Đã dọn bộ nhớ đệm chuyển mã, giải phóng ${fmtSize(r.freed)}` : 'Bộ nhớ đệm chuyển mã đã trống');
  };

  // 播放中若始终解不出画面（videoWidth 一直为 0），判定为解码不兼容。
  // 必须定义在早返回之前 —— hooks 不能出现在条件分支之后。
  const handlePlaying = useCallback(() => {
    setDecodeFailed(false);
    const idx = currentIndex;
    setTimeout(() => {
      const v = videoRef.current;
      if (!v) return;
      if (v.videoWidth === 0 && !v.paused && v.currentTime > 0.3) {
        setDecodeFailed(true);
        if (autoCompat && !compatMap[idx]) {
          showToast('Máy này không giải mã được định dạng video này (HEVC), đang chuyển mã sang định dạng tương thích…');
          startCompatPlay(idx);
        }
      }
    }, 2600);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoCompat, compatMap, currentIndex, startCompatPlay, showToast]);

  /**
   * 在线播放：让主进程把该集下载+解密到内存，拿回可播放的流地址。
   * 不写本地文件、不占用下载目录，看完可选择清理内存缓存。
   */
  const startOnlinePlay = useCallback(
    async (vidIndex) => {
      const ep = episodes.find((e) => e.vid_index === vidIndex);
      if (!ep || !ep.vid) {
        showToast('Tập này thiếu vid, không thể phát trực tuyến');
        return;
      }
      setCurrentIndex(vidIndex);
      setWaitingFor(null);
      setOnlineProgress({ vid: ep.vid, percent: 0, phase: 'downloading' });
      setOnlineVid(ep.vid);
      setOnlineUrl('');
      try {
        const res = await window.electronAPI.prepareOnlinePlay({
          vid: ep.vid,
          seriesId: activeSeriesId,
          vidIndex,
        });
        if (!res || !res.success) {
          showToast((res && res.error) || 'Chuẩn bị phát trực tuyến thất bại');
          setOnlineVid(null);
          setOnlineProgress(null);
          return;
        }
        setOnlineUrl(res.url);
        setOnlineProgress(null);
        refreshCacheInfo();
      } catch (e) {
        showToast('Phát trực tuyến thất bại: ' + e.message);
        setOnlineVid(null);
        setOnlineProgress(null);
      }
    },
    [episodes, activeSeriesId, showToast, refreshCacheInfo]
  );

  // 切集
  const goToEpisode = useCallback(
    (vidIndex, keepPlaying = true) => {
      setCurrentIndex(vidIndex);
      setWaitingFor(null);
      pendingSeekRef.current = 0;
      // 换集时清掉上一集的在线流（下载好的集直接走本地文件）
      const ep = episodes.find((e) => e.vid_index === vidIndex);
      if (!ep || ep.status === 'completed') {
        setOnlineVid(null);
        setOnlineUrl('');
        setOnlineProgress(null);
      }
      const v = videoRef.current;
      if (v && keepPlaying) {
        // 等 src 更新后再播
        setTimeout(() => {
          v.play().catch(() => {});
        }, 80);
      }
    },
    [episodes]
  );

  // 找下一集（按集号顺序）
  const findNext = useCallback(
    (fromIndex) => {
      const idx = episodes.findIndex((e) => e.vid_index === fromIndex);
      if (idx === -1 || idx + 1 >= episodes.length) return null;
      return episodes[idx + 1];
    },
    [episodes]
  );
  const findPrev = useCallback(
    (fromIndex) => {
      const idx = episodes.findIndex((e) => e.vid_index === fromIndex);
      if (idx <= 0) return null;
      return episodes[idx - 1];
    },
    [episodes]
  );

  // 播放结束 -> 连播（未下载的集自动转在线播放，做到「不下载也能连着看」）
  const handleEnded = useCallback(() => {
    const { currentIndex: ci, autoNext: an, activeSeriesId: sid } = stateRef.current;
    const finished = episodes.find((e) => e.vid_index === ci);

    // 看完自动删：先把刚看完这集的本地文件清掉，再决定下一集怎么播
    if (autoDelete && finished && finished.status === 'completed' && sid) {
      window.electronAPI.deleteEpisodeFile(sid, ci).then((r) => {
        if (r && r.success && r.count > 0) {
          showToast(`Đã xem xong Tập ${ci}, tự động xóa tệp cục bộ (giải phóng ${fmtSize(r.freed)})`);
          refreshCacheInfo();
          loadDetail(sid);
        }
      });
    }

    if (!an) return;
    const next = findNext(ci);
    if (!next) {
      showToast('Đây đã là tập cuối');
      return;
    }
    if (sid) window.electronAPI.savePlaybackPosition(sid, next.vid_index, 0);

    const nextIsLocal = next.status === 'completed' && next.fileUrl && !(autoDelete && finished && finished.status === 'completed');
    if (nextIsLocal) {
      goToEpisode(next.vid_index, true);
    } else if (next.status === 'downloading' || next.status === 'pending') {
      // 正在下载：等它下完自动接上
      setWaitingFor(next.vid_index);
      setCurrentIndex(next.vid_index);
      showToast(`Tập ${next.vid_index} đang tải, tải xong sẽ tự động phát`);
    } else {
      // 未下载（或被自动删了）-> 直接在线播放
      showToast(`Tập ${next.vid_index} chuyển sang phát trực tuyến`);
      startOnlinePlay(next.vid_index);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [findNext, goToEpisode, showToast, startOnlinePlay, autoDelete, episodes, refreshCacheInfo, loadDetail]);

  // 记住播放进度（每 5 秒 + 切集时）
  const persistPosition = useCallback(() => {
    const v = videoRef.current;
    const { activeSeriesId: sid, currentIndex: ci } = stateRef.current;
    if (!v || !sid) return;
    if (Math.abs(v.currentTime - lastSavedRef.current) < 3) return;
    lastSavedRef.current = v.currentTime;
    window.electronAPI.savePlaybackPosition(sid, ci, v.currentTime);
  }, []);

  useEffect(() => {
    const timer = setInterval(persistPosition, 5000);
    return () => {
      clearInterval(timer);
      persistPosition();
    };
  }, [persistPosition]);

  // 切集 / 恢复断点
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !current || current.status !== 'completed') return;
    const seekTo = pendingSeekRef.current || 0;
    const onLoaded = () => {
      if (seekTo > 0 && seekTo < v.duration - 3) {
        v.currentTime = seekTo;
        showToast(`Tiếp tục phát từ ${Math.floor(seekTo / 60)}:${String(Math.floor(seekTo % 60)).padStart(2, '0')}`);
      }
      pendingSeekRef.current = 0;
      v.play().catch(() => {});
    };
    v.addEventListener('loadedmetadata', onLoaded, { once: true });
    return () => v.removeEventListener('loadedmetadata', onLoaded);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current && current.fileUrl]);

  // 快捷键
  useEffect(() => {
    const onKey = (e) => {
      const v = videoRef.current;
      if (!v || e.target.tagName === 'INPUT') return;
      const { currentIndex: ci, activeSeriesId: sid, autoNext: an } = stateRef.current;
      if (e.code === 'Space') {
        e.preventDefault();
        v.paused ? v.play().catch(() => {}) : v.pause();
      } else if (e.key === 'ArrowRight') {
        v.currentTime = Math.min(v.duration || 0, v.currentTime + 5);
      } else if (e.key === 'ArrowLeft') {
        v.currentTime = Math.max(0, v.currentTime - 5);
      } else if (e.key === 'ArrowUp') {
        const p = findPrev(ci);
        if (p) {
          if (sid) window.electronAPI.savePlaybackPosition(sid, ci, v.currentTime);
          goToEpisode(p.vid_index, true);
        }
      } else if (e.key === 'ArrowDown') {
        const n = findNext(ci);
        if (n && n.status === 'completed') goToEpisode(n.vid_index, true);
        else if (n) setWaitingFor(n.vid_index);
      } else if (e.key.toLowerCase() === 'a') {
        setAutoNext(!an);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [findNext, findPrev, goToEpisode]);

  const switchSeries = async (sid) => {
    persistPosition();
    setActiveSeriesId(sid);
    setDetail(null);
    setWaitingFor(null);
    setOnlineVid(null);
    setOnlineUrl('');
    setOnlineProgress(null);
    const d = await loadDetail(sid);
    const saved = await window.electronAPI.getPlaybackPosition(sid);
    if (saved && saved.vid_index) setCurrentIndex(saved.vid_index);
    else if (d) {
      const firstPlayable = d.episodes.find((e) => e.status === 'completed');
      setCurrentIndex(firstPlayable ? firstPlayable.vid_index : 1);
    }
    pendingSeekRef.current = saved ? saved.currentTime || 0 : 0;
  };

  // 从列表移除一部短剧（只取消登记，不删本地文件）
  const removeSeries = async (sid, title) => {
    const res = await window.electronAPI.removeSeries(sid);
    if (!res || !res.success) {
      showToast((res && res.error) || 'Gỡ thất bại');
      return;
    }
    showToast(`Đã gỡ “${title}” khỏi danh sách (vẫn giữ tệp cục bộ)`);
    const list = await loadSeriesList();
    refreshCacheInfo();
    if (String(sid) === String(activeSeriesId)) {
      const next = list[0];
      if (next) await switchSeries(next.series_id);
      else {
        setActiveSeriesId('');
        setDetail(null);
      }
    }
  };

  const purgeEmpty = async () => {
    const res = await window.electronAPI.purgeEmptySeries();
    if (res && res.success) {
      showToast(res.count > 0 ? `Đã dọn ${res.count} phim chưa tải` : 'Không có phim nào cần dọn');
      const list = await loadSeriesList();
      refreshCacheInfo();
      if (!list.some((s) => String(s.series_id) === String(activeSeriesId))) {
        if (list[0]) await switchSeries(list[0].series_id);
      }
    }
  };

  const restoreDismissed = async () => {
    const res = await window.electronAPI.restoreDismissedSeries();
    if (res && res.success) {
      showToast(res.count > 0 ? `Đã khôi phục ${res.count} phim đã gỡ` : 'Không có phim nào bị gỡ');
      await loadSeriesList();
      refreshCacheInfo();
    }
  };

  const clearCache = async () => {
    await window.electronAPI.clearOnlineCache();
    refreshCacheInfo();
    showToast('Đã xóa bộ nhớ đệm phát trực tuyến');
  };

  const downloadEpisode = async (vidIndex) => {
    const res = await window.electronAPI.downloadSingleEpisode(activeSeriesId, vidIndex);
    if (res && res.success) {
      showToast(res.count > 0 ? `Đã thêm Tập ${vidIndex} vào hàng đợi tải xuống` : `Tập ${vidIndex} đã có trong hàng đợi`);
      if (currentIndex === vidIndex) setWaitingFor(vidIndex);
    } else {
      showToast((res && res.error) || 'Thêm vào tải xuống thất bại');
    }
  };

  const downloadMissing = async () => {
    const missing = episodes.filter((e) => e.status !== 'completed');
    if (!missing.length) {
      showToast('Đã tải tất cả');
      return;
    }
    let ok = 0;
    for (const ep of missing) {
      const r = await window.electronAPI.downloadSingleEpisode(activeSeriesId, ep.vid_index);
      if (r && r.success) ok++;
    }
    showToast(`Đã thêm ${ok} tập vào hàng đợi tải xuống`);
  };

  // 一键合并当前这部剧（弹出格式选择）
  const mergeThisSeries = async (compatible) => {
    setMerging(true);
    setMergeAsk(false);
    try {
      const res = await window.electronAPI.mergeSeries(activeSeriesId, '', { compatible });
      if (!res || !res.success) {
        showToast((res && res.error) || 'Gộp thất bại');
        return;
      }
      const tip = compatible
        ? `Bắt đầu gộp tương thích ${res.count} tập (H.264, mất khá lâu)`
        : `Bắt đầu gộp ${res.count} tập, khoảng ${(res.totalBytes / 1073741824).toFixed(2)} GB`;
      showToast(`${tip}. Xem tiến độ trong “Quản lý tải xuống”`);
      if (res.codecWarning) showToast(res.codecWarning);
    } catch (e) {
      showToast('Lỗi gộp: ' + e.message);
    } finally {
      setMerging(false);
    }
  };

  // ===== 渲染 =====
  if (loading) {
    return <div className="player-container"><div className="player-empty">Đang tải…</div></div>;
  }

  if (!seriesList.length) {
    return (
      <div className="player-container">
        <div className="player-header">
          <div className="player-title"><Play size={22} /><h2>Trình phát</h2></div>
        </div>
        <div className="player-empty">
          <Film size={40} />
          <p>Chưa có phim ngắn nào để phát</p>
          <p className="player-empty-sub">Vào “Khám phá” chọn một phim, mở ra là phát trực tuyến được ngay, không cần tải xuống trước</p>
          <div className="player-empty-actions">
            {onNavigate && (
              <button className="btn btn-primary" onClick={() => onNavigate('browse')}>
                Khám phá phim
              </button>
            )}
            {onNavigate && (
              <button className="btn btn-outline" onClick={() => onNavigate('download')}>
                Tìm kiếm / dán liên kết
              </button>
            )}
          </div>
          {dismissedCount > 0 && (
            <button className="btn btn-outline btn-sm" onClick={restoreDismissed}>
              Khôi phục {dismissedCount} phim đã gỡ
            </button>
          )}
        </div>
      </div>
    );
  }

  // 可播放：本地已下载走 file://，否则走在线内存流；兼容模式下优先用转码后的文件
  const compatUrl = current ? compatMap[current.vid_index] : null;
  const isOnlinePlaying = onlineVid && current && current.vid === onlineVid && onlineUrl;
  const canPlay = !!(current && (compatUrl || (current.status === 'completed' && current.fileUrl) || isOnlinePlaying));
  const videoSrc = compatUrl || (isOnlinePlaying ? onlineUrl : (current && current.fileUrl) || '');

  return (
    <div className="player-container">
      <div className="player-header">
        <div className="player-title">
          <Play size={22} />
          <h2>Trình phát</h2>
        </div>
        <div className="player-header-right">
          <span className="player-stat">Đã tải {playableCount} / {episodes.length || 0} tập</span>
          <button
            className={`btn btn-outline ${autoNext ? 'btn-autonext-on' : ''}`}
            onClick={() => setAutoNext(!autoNext)}
            title="Phát xong tự động phát tập tiếp theo (phím tắt A)"
          >
            <Layers size={15} />
            Tự phát tiếp: {autoNext ? 'Bật' : 'Tắt'}
          </button>
          <button
            className={`btn btn-outline ${autoCompat ? 'btn-autonext-on' : ''}`}
            onClick={toggleAutoCompat}
            title="Tự chuyển mã sang H.264 để phát khi máy không giải mã được HEVC (khắc phục màn hình đen nhưng có tiếng)"
          >
            <Zap size={15} />
            Chế độ tương thích: {autoCompat ? 'Bật' : 'Tắt'}
          </button>
          <button
            className={`btn btn-outline ${autoDelete ? 'btn-autonext-on' : ''}`}
            onClick={toggleAutoDelete}
            title="Xem xong một tập sẽ tự xóa tệp cục bộ của tập đó (vừa xem vừa dọn, không chiếm ổ đĩa)"
          >
            <Trash2 size={15} />
            Xem xong tự xóa: {autoDelete ? 'Bật' : 'Tắt'}
          </button>
          <button className="btn btn-outline" onClick={downloadMissing}>
            <Download size={15} />
            Tải các tập chưa xong
          </button>
          <button
            className="btn btn-primary"
            onClick={() => setMergeAsk(true)}
            disabled={merging || playableCount === 0}
            title="Gộp các tập đã tải thành một tệp mp4 để xem liền một lượt"
          >
            <Layers size={15} />
            {merging ? 'Đang gửi...' : 'Gộp và xuất toàn bộ'}
          </button>
        </div>
      </div>

      {/* 剧集选择：当前剧 + 下拉管理面板（替代原来会越堆越长的横条） */}
      <div className="player-series-row">
        <div className="player-series-current">
          <span className="player-series-label">Đang phát</span>
          <span className="player-series-name" title={detail ? detail.series_title : ''}>
            {detail ? detail.series_title : '—'}
          </span>
        </div>
        <button
          className={`btn btn-outline series-picker-btn ${pickerOpen ? 'open' : ''}`}
          onClick={() => setPickerOpen((v) => !v)}
        >
          Đổi phim
          <span className="series-count">{seriesList.length}</span>
          <ChevronDown size={15} />
        </button>
      </div>

      {pickerOpen && (
        <div className="series-picker">
          <div className="series-picker-head">
            <input
              type="text"
              className="input-field"
              placeholder="Tìm tên phim…"
              value={pickerQuery}
              onChange={(e) => setPickerQuery(e.target.value)}
            />
            <button className="icon-btn" title="Đóng" onClick={() => setPickerOpen(false)}>
              <X size={16} />
            </button>
          </div>

          <div className="series-picker-list">
            {seriesList.length === 0 && <div className="series-picker-empty">Chưa có phim nào</div>}
            {seriesList
              .filter((s) => !pickerQuery.trim() || (s.series_title || '').includes(pickerQuery.trim()))
              .map((s) => {
                const isActive = String(s.series_id) === String(activeSeriesId);
                const dl = downloadedMap[String(s.series_id)];
                return (
                  <div
                    key={s.series_id}
                    className={`series-row ${isActive ? 'active' : ''}`}
                    onClick={() => {
                      if (!isActive) switchSeries(s.series_id);
                      setPickerOpen(false);
                    }}
                  >
                    <div className="series-row-cover">
                      {s.cover ? <img src={s.cover} alt="" loading="lazy" /> : <Film size={14} />}
                    </div>
                    <div className="series-row-body">
                      <div className="series-row-title">{s.series_title}</div>
                      <div className="series-row-sub">
                        {dl && dl.completed > 0 ? `Đã tải ${dl.completed}/${dl.total} tập` : `${(s.episodes || []).length} tập · Chưa tải`}
                      </div>
                    </div>
                    {isActive && <span className="series-row-cur">Đang phát</span>}
                    {(() => {
                      const st = storageMap[String(s.series_id)];
                      const hasFiles = st && st.files > 0;
                      return (
                        <>
                          {hasFiles && (
                            <button
                              className="icon-btn icon-btn-danger series-row-del"
                              title={`Xóa tệp cục bộ (${st.files} tệp · ${fmtSize(st.bytes)})`}
                              onClick={(e) => {
                                e.stopPropagation();
                                setConfirmAsk({
                                  title: 'Xóa tệp cục bộ',
                                  message: `Sẽ xóa ${st.files} tệp đã tải của “${s.series_title}”, giải phóng ${fmtSize(st.bytes)}.\nPhim vẫn được giữ trong danh sách, sau này có thể phát trực tuyến hoặc tải lại bất cứ lúc nào.`,
                                  okText: 'Xóa tệp',
                                  danger: true,
                                  onOk: async () => {
                                    const r = await window.electronAPI.deleteSeriesFiles(s.series_id);
                                    if (r && r.success) {
                                      showToast(`Đã xóa ${r.count} tệp, giải phóng ${fmtSize(r.freed)}`);
                                      await loadDetail(activeSeriesId);
                                      refreshCacheInfo();
                                    } else {
                                      showToast((r && r.error) || 'Xóa thất bại');
                                    }
                                  },
                                });
                              }}
                            >
                              <Trash2 size={15} />
                            </button>
                          )}
                          <button
                            className="icon-btn series-row-del"
                            title="Gỡ khỏi danh sách (không xóa tệp cục bộ)"
                            onClick={(e) => {
                              e.stopPropagation();
                              removeSeries(s.series_id, s.series_title);
                            }}
                          >
                            <X size={15} />
                          </button>
                        </>
                      );
                    })()}
                  </div>
                );
              })}
          </div>

          <div className="series-picker-foot">
            {storageTotal.files > 0 && (
              <span className="series-picker-usage">
                Dung lượng cục bộ đã dùng: <b>{fmtSize(storageTotal.bytes)}</b> / {storageTotal.files} tệp
              </span>
            )}
            <button className="btn btn-outline btn-sm" onClick={purgeEmpty} title="Gỡ khỏi danh sách những phim chưa tải tập nào">
              <Trash2 size={14} />
              Dọn phim chưa tải
            </button>
            {dismissedCount > 0 && (
              <button className="btn btn-outline btn-sm" onClick={restoreDismissed}>
                Khôi phục phim đã gỡ ({dismissedCount})
              </button>
            )}
            {storageTotal.files > 0 && (
              <button
                className="btn btn-outline btn-sm btn-danger-text"
                title="Xóa tất cả tệp cục bộ đã tải"
                onClick={() => {
                  setConfirmAsk({
                    title: 'Xóa toàn bộ tệp cục bộ',
                    message: `Sẽ xóa tất cả tệp phim đã tải, tổng cộng ${storageTotal.files} tệp, ${fmtSize(storageTotal.bytes)}.\nDanh sách phim và thông tin các tập vẫn được giữ, sau này vẫn có thể phát trực tuyến hoặc tải lại.`,
                    okText: 'Xóa tất cả',
                    danger: true,
                    onOk: async () => {
                      const r = await window.electronAPI.deleteAllDownloaded();
                      if (r && r.success) {
                        showToast(`Đã xóa ${r.count} tệp, giải phóng ${fmtSize(r.freed)}`);
                        await loadDetail(activeSeriesId);
                        refreshCacheInfo();
                      } else {
                        showToast((r && r.error) || 'Xóa thất bại');
                      }
                    },
                  });
                }}
              >
                Xóa tất cả đã tải
              </button>
            )}
            <button className="btn btn-outline btn-sm" onClick={clearCache} title="Giải phóng bộ nhớ mà phát trực tuyến đang chiếm">
              <Zap size={14} />
              Xóa bộ nhớ đệm phát{cacheInfo.count > 0 ? ` (${cacheInfo.count})` : ''}
            </button>
            {compatCache.files > 0 && (
              <button className="btn btn-outline btn-sm" onClick={clearCompatCache} title="Xóa các tệp định dạng tương thích do chuyển mã tạo ra">
                <Trash2 size={14} />
                Xóa bộ nhớ đệm chuyển mã ({fmtSize(compatCache.bytes)})
              </button>
            )}
          </div>
        </div>
      )}

      {/* 播放区 */}
      <div className="player-stage">
        {canPlay ? (
          <video
            ref={videoRef}
            src={videoSrc}
            className="player-video"
            controls
            autoPlay
            onEnded={handleEnded}
            onPause={persistPosition}
            onPlaying={handlePlaying}
          />
        ) : (
          <div className="player-placeholder">
            {onlineProgress && onlineProgress.vid && (!current || current.vid === onlineProgress.vid) ? (
              <>
                <RefreshCw size={30} className="spin" />
                <p>{onlineProgress.phase === 'decrypting' ? 'Đang giải mã…' : 'Đang tải đệm để phát trực tuyến…'}</p>
                <div className="player-wait-bar">
                  <div className="player-wait-fill" style={{ width: `${onlineProgress.percent || 0}%` }} />
                </div>
                <span className="player-placeholder-sub">
                  {(onlineProgress.percent || 0)}%
                  {onlineProgress.total ? ` · ${(onlineProgress.received / 1048576).toFixed(1)} / ${(onlineProgress.total / 1048576).toFixed(1)} MB` : ''}
                  {' · Không ghi vào ổ đĩa, chỉ dùng bộ nhớ'}
                </span>
              </>
            ) : waitingFor != null ? (
              <>
                <RefreshCw size={30} className="spin" />
                <p>Tập {waitingFor} đang tải, tải xong sẽ tự động phát…</p>
                {(() => {
                  const ep = episodes.find((e) => e.vid_index === waitingFor);
                  return ep && ep.status === 'downloading' ? (
                    <div className="player-wait-bar">
                      <div className="player-wait-fill" style={{ width: `${ep.progress || 0}%` }} />
                    </div>
                  ) : null;
                })()}
                <span className="player-placeholder-sub">Bạn cũng có thể phát trực tuyến tập này ngay</span>
              </>
            ) : current ? (
              <>
                <Film size={34} />
                <p>
                  Tập {current.vid_index}{' '}
                  {current.status === 'downloading' ? 'đang tải' : current.status === 'pending' ? 'đang chờ' : 'chưa tải'}
                </p>
                {current.status === 'downloading' && (
                  <div className="player-wait-bar">
                    <div className="player-wait-fill" style={{ width: `${current.progress || 0}%` }} />
                  </div>
                )}
                <div className="player-placeholder-actions">
                  <button className="btn btn-primary" onClick={() => startOnlinePlay(current.vid_index)}>
                    <Play size={15} />
                    Phát trực tuyến (không tải xuống)
                  </button>
                  <button className="btn btn-outline" onClick={() => downloadEpisode(current.vid_index)}>
                    <Download size={15} />
                    Tải xuống tập này
                  </button>
                </div>
                <span className="player-placeholder-sub">Phát trực tuyến chỉ lưu tạm trong bộ nhớ, không chiếm thư mục tải xuống của bạn</span>
              </>
            ) : (
              <>
                <Film size={34} />
                <p>Hãy chọn một tập để bắt đầu phát</p>
              </>
            )}
          </div>
        )}

        {/* 兼容模式浮层：解码失败提示 / 转码进度 */}
        {compatProgress && compatProgress.vidIndex === currentIndex && (
          <div className="compat-overlay">
            <RefreshCw size={26} className="spin" />
            <p>Đang chuyển mã sang định dạng tương thích (H.264)…</p>
            <div className="player-wait-bar">
              <div className="player-wait-fill" style={{ width: `${compatProgress.percent || 0}%` }} />
            </div>
            <span className="compat-overlay-sub">
              {compatProgress.percent || 0}% · Máy này không giải mã được HEVC, chỉ cần chuyển mã một lần là có thể phát và tua bình thường
            </span>
          </div>
        )}

        {!compatProgress && decodeFailed && canPlay && !compatUrl && (
          <div className="compat-overlay">
            <Film size={30} />
            <p>Không hiển thị được hình (vẫn có tiếng)</p>
            <span className="compat-overlay-sub">
              Máy này không hỗ trợ định dạng mã hóa của video (HEVC). Chuyển mã sang H.264 là có thể phát bình thường.
            </span>
            <div className="player-placeholder-actions">
              <button className="btn btn-primary" onClick={() => startCompatPlay(currentIndex)}>
                <Zap size={15} />
                Chuyển mã rồi phát
              </button>
              <button className="btn btn-outline" onClick={toggleAutoCompat}>
                {autoCompat ? 'Tắt tự chuyển mã' : 'Bật tự chuyển mã'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 播放中的集信息 */}
      {current && (
        <div className="player-now">
          <span className="player-now-title">
            “{detail ? detail.series_title : ''}” Tập {current.vid_index}
          </span>
          {current.title && <span className="player-now-sub">{vi(current.title)}</span>}
          <span className={`player-now-status status-${current.status}`}>
            {current.status === 'completed' ? 'Có thể phát' : current.status === 'downloading' ? `Đang tải ${current.progress || 0}%` : current.status === 'pending' ? 'Đang chờ' : 'Chưa tải'}
          </span>
        </div>
      )}

      {/* 分集列表 */}
      <div className="player-episodes">
        {episodes.map((ep) => {
          const isCurrent = ep.vid_index === currentIndex;
          return (
            <button
              key={ep.vid_index}
              className={`ep-chip ep-${ep.status} ${isCurrent ? 'ep-current' : ''}`}
              onClick={() => {
                if (ep.status === 'completed') goToEpisode(ep.vid_index, true);
                else if (ep.status === 'downloading' || ep.status === 'pending') {
                  setWaitingFor(ep.vid_index);
                  setCurrentIndex(ep.vid_index);
                } else {
                  // 未下载：直接在线播放，不必先下载
                  startOnlinePlay(ep.vid_index);
                }
              }}
              title={
                ep.status === 'completed'
                  ? 'Nhấn để phát (cục bộ)'
                  : ep.status === 'downloading' || ep.status === 'pending'
                  ? 'Đang tải, tải xong sẽ tự động phát'
                  : 'Nhấn để phát trực tuyến (không tải xuống) · Nhấn đúp để thêm vào tải xuống'
              }
              onDoubleClick={() => ep.status !== 'completed' && downloadEpisode(ep.vid_index)}
            >
              <span className="ep-num">{ep.vid_index}</span>
              {ep.status === 'completed' && <Check size={11} className="ep-badge" />}
              {ep.status === 'downloading' && (
                <span className="ep-progress" style={{ width: `${ep.progress || 0}%` }} />
              )}
              {onlineVid === ep.vid && <span className="ep-online-dot" />}
            </button>
          );
        })}
      </div>

      <div className="player-tips">
        Phím tắt: Space phát/tạm dừng · ← → tua lùi/tới 5 giây · ↑ ↓ tập trước/tập sau · A bật/tắt tự phát tiếp.
        <br />
        <b>Nhấn một lần vào tập màu xám để phát trực tuyến</b> (không tải xuống, không chiếm thư mục tải xuống, chỉ lưu đệm trong bộ nhớ); nhấn đúp mới thêm vào hàng đợi tải xuống.
        Khi tự phát tiếp gặp tập chưa tải sẽ tự chuyển sang phát trực tuyến.
      </div>

      {toast && <div className="dm-toast dm-toast-success" onClick={() => setToast(null)}>{toast}</div>}

      {/* 合并格式选择 */}
      {mergeAsk && (
        <div className="player-confirm-mask" onClick={() => setMergeAsk(false)}>
          <div className="player-confirm" onClick={(e) => e.stopPropagation()}>
            <div className="player-confirm-title" style={{ color: 'var(--accent)' }}>
              <Layers size={17} />
              Gộp và xuất toàn bộ
            </div>
            <div className="player-confirm-msg">
              <p>Gộp {playableCount} tập đã tải của “{detail ? detail.series_title : ''}” thành một tệp mp4.</p>
              <p><b>Gộp nhanh</b>: nối trực tiếp giữ nguyên chất lượng gốc, xong trong vài giây, nhưng định dạng vẫn là HEVC — trên một số máy tính có thể bị màn hình đen nhưng có tiếng.</p>
              <p><b>Gộp tương thích</b>: chuyển mã sang H.264, máy tính/trình phát nào cũng phát được, nhưng chậm (khoảng vài giây cho mỗi phút video).</p>
            </div>
            <div className="player-confirm-foot">
              <button className="btn btn-outline" onClick={() => setMergeAsk(false)}>Hủy</button>
              <button className="btn btn-outline" onClick={() => mergeThisSeries(true)} disabled={merging}>
                Gộp tương thích (H.264)
              </button>
              <button className="btn btn-primary" onClick={() => mergeThisSeries(false)} disabled={merging}>
                Gộp nhanh
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 删除确认 */}
      {confirmAsk && (        <div className="player-confirm-mask" onClick={() => setConfirmAsk(null)}>
          <div className="player-confirm" onClick={(e) => e.stopPropagation()}>
            <div className="player-confirm-title">
              <Trash2 size={17} />
              {confirmAsk.title}
            </div>
            <div className="player-confirm-msg">
              {String(confirmAsk.message).split('\n').map((line, i) => (
                <p key={i}>{line}</p>
              ))}
            </div>
            <div className="player-confirm-foot">
              <button className="btn btn-outline" onClick={() => setConfirmAsk(null)}>Hủy</button>
              <button
                className={`btn ${confirmAsk.danger ? 'btn-danger-solid' : 'btn-primary'}`}
                onClick={async () => {
                  const fn = confirmAsk.onOk;
                  setConfirmAsk(null);
                  await fn();
                }}
              >
                {confirmAsk.okText || 'Xác nhận'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Player;
