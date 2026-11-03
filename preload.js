const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // 应用信息 / 官网链接
  getAppInfo: () => ipcRenderer.invoke('get-app-info'),
  openExternalUrl: (url) => ipcRenderer.invoke('open-external-url', url),


  // 红果解析与下载
  hongguoResolve: (input) => ipcRenderer.invoke('hongguo-resolve', input),
  hongguoDownloadBatch: (payload) => ipcRenderer.invoke('hongguo-download-batch', payload),
  downloadSeriesList: (seriesIds) => ipcRenderer.invoke('download-series-list', seriesIds),

  // 搜索（内嵌浏览器嗅探）
  searchSeries: (keyword) => ipcRenderer.invoke('search-series', keyword),
  searchResolve: (seriesId) => ipcRenderer.invoke('search-resolve', seriesId),
  searchWindowShow: (visible) => ipcRenderer.invoke('search-window-show', visible),
  getSeriesList: () => ipcRenderer.invoke('get-series-list'),
  removeSeries: (seriesId) => ipcRenderer.invoke('remove-series', seriesId),
  purgeEmptySeries: () => ipcRenderer.invoke('purge-empty-series'),
  restoreDismissedSeries: () => ipcRenderer.invoke('restore-dismissed-series'),
  dismissedCount: () => ipcRenderer.invoke('dismissed-count'),
  rescanDownloads: () => ipcRenderer.invoke('rescan-downloads'),

  // 在线播放（内存缓存 + 自定义流协议，不落盘）
  prepareOnlinePlay: (payload) => ipcRenderer.invoke('prepare-online-play', payload),
  onlineCacheStatus: () => ipcRenderer.invoke('online-cache-status'),
  clearOnlineCache: () => ipcRenderer.invoke('clear-online-cache'),
  onOnlinePlayProgress: (cb) => {
    const listener = (_e, data) => cb(data);
    ipcRenderer.on('online-play-progress', listener);
    return () => ipcRenderer.removeListener('online-play-progress', listener);
  },

  // 兼容模式（HEVC -> H.264 转码，解决「黑屏有声」）
  transcodeForPlayback: (payload) => ipcRenderer.invoke('transcode-for-playback', payload),
  compatCacheStatus: () => ipcRenderer.invoke('compat-cache-status'),
  clearCompatCache: () => ipcRenderer.invoke('clear-compat-cache'),
  decodeCapability: () => ipcRenderer.invoke('decode-capability'),
  onTranscodeProgress: (cb) => {
    const listener = (_e, data) => cb(data);
    ipcRenderer.on('transcode-progress', listener);
    return () => ipcRenderer.removeListener('transcode-progress', listener);
  },

  // 浏览（分类页）
  browseCategories: () => ipcRenderer.invoke('browse-categories'),
  browseList: (options) => ipcRenderer.invoke('browse-list', options),
  playSeries: (payload) => ipcRenderer.invoke('play-series', payload),
  onNavigate: (cb) => {
    const listener = (_e, data) => cb(data);
    ipcRenderer.on('navigate', listener);
    return () => ipcRenderer.removeListener('navigate', listener);
  },

  // 播放器
  getSeriesEpisodes: (seriesId) => ipcRenderer.invoke('get-series-episodes', seriesId),
  downloadSingleEpisode: (seriesId, vidIndex) =>
    ipcRenderer.invoke('download-single-episode', seriesId, vidIndex),
  savePlaybackPosition: (seriesId, vidIndex, currentTime) =>
    ipcRenderer.invoke('save-playback-position', seriesId, vidIndex, currentTime),
  getPlaybackPosition: (seriesId) => ipcRenderer.invoke('get-playback-position', seriesId),

  // 一键合并
  getFfmpegStatus: () => ipcRenderer.invoke('get-ffmpeg-status'),
  mergeSeries: (seriesId, outputName, options) => ipcRenderer.invoke('merge-series', seriesId, outputName, options),
  cancelMerge: (id) => ipcRenderer.invoke('cancel-merge', id),
  getMergeTasks: () => ipcRenderer.invoke('get-merge-tasks'),
  deleteMergeTask: (id) => ipcRenderer.invoke('delete-merge-task', id),
  onMergeProgress: (cb) => {
    const listener = (_e, data) => cb(data);
    ipcRenderer.on('merge-progress', listener);
    return () => ipcRenderer.removeListener('merge-progress', listener);
  },
  onMergeTaskAdded: (cb) => {
    const listener = (_e, data) => cb(data);
    ipcRenderer.on('merge-task-added', listener);
    return () => ipcRenderer.removeListener('merge-task-added', listener);
  },
  onMergeCompleted: (cb) => {
    const listener = (_e, data) => cb(data);
    ipcRenderer.on('merge-completed', listener);
    return () => ipcRenderer.removeListener('merge-completed', listener);
  },
  onMergeFailed: (cb) => {
    const listener = (_e, data) => cb(data);
    ipcRenderer.on('merge-failed', listener);
    return () => ipcRenderer.removeListener('merge-failed', listener);
  },

  // 设置
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),

  // 网络代理
  getProxyStatus: () => ipcRenderer.invoke('get-proxy-status'),
  testProxy: (draft) => ipcRenderer.invoke('test-proxy', draft),

  // 下载管理
  getDownloadTasks: () => ipcRenderer.invoke('get-download-tasks'),
  deleteTask: (taskId) => ipcRenderer.invoke('delete-task', taskId),
  deleteTasks: (taskIds) => ipcRenderer.invoke('delete-tasks', taskIds),

  // 文件清理
  deleteTaskWithFiles: (taskId, deleteFiles) => ipcRenderer.invoke('delete-task', taskId, { deleteFiles }),
  deleteTasksWithFiles: (taskIds, deleteFiles) => ipcRenderer.invoke('delete-tasks', taskIds, { deleteFiles }),
  deleteSeriesFiles: (seriesId, options) => ipcRenderer.invoke('delete-series-files', seriesId, options),
  deleteEpisodeFile: (seriesId, vidIndex) => ipcRenderer.invoke('delete-episode-file', seriesId, vidIndex),
  getStorageUsage: () => ipcRenderer.invoke('get-storage-usage'),
  deleteAllDownloaded: () => ipcRenderer.invoke('delete-all-downloaded'),
  stopDownload: (taskId) => ipcRenderer.invoke('stop-download', taskId),
  retryTask: (taskId) => ipcRenderer.invoke('retry-task', taskId),
  retryTasks: (taskIds) => ipcRenderer.invoke('retry-tasks', taskIds),
  openFolder: (taskId) => ipcRenderer.invoke('open-folder', taskId),
  showInFolder: (filePath) => ipcRenderer.invoke('show-in-folder', filePath),

  // 一键启动 / 一键暂停 / 队列状态
  pauseAll: () => ipcRenderer.invoke('pause-all'),
  resumeAll: () => ipcRenderer.invoke('resume-all'),
  getQueueStatus: () => ipcRenderer.invoke('get-queue-status'),

  // 事件监听
  onDownloadProgress: (cb) => {
    const listener = (_e, data) => cb(data);
    ipcRenderer.on('download-progress', listener);
    return () => ipcRenderer.removeListener('download-progress', listener);
  },
  onDownloadTaskAdded: (cb) => {
    const listener = (_e, data) => cb(data);
    ipcRenderer.on('download-task-added', listener);
    return () => ipcRenderer.removeListener('download-task-added', listener);
  },
  onDownloadCompleted: (cb) => {
    const listener = (_e, data) => cb(data);
    ipcRenderer.on('download-completed', listener);
    return () => ipcRenderer.removeListener('download-completed', listener);
  },
  onDownloadFailed: (cb) => {
    const listener = (_e, data) => cb(data);
    ipcRenderer.on('download-failed', listener);
    return () => ipcRenderer.removeListener('download-failed', listener);
  },
  onDownloadStopped: (cb) => {
    const listener = (_e, data) => cb(data);
    ipcRenderer.on('download-stopped', listener);
    return () => ipcRenderer.removeListener('download-stopped', listener);
  },
  onDownloadQueueChanged: (cb) => {
    const listener = (_e, data) => cb(data);
    ipcRenderer.on('download-queue-changed', listener);
    return () => ipcRenderer.removeListener('download-queue-changed', listener);
  },
});
