import React, { useState, useEffect } from 'react';
import { Film, Download, Settings, Play, Sparkles } from './components/icons';
import HongguoDownload from './components/HongguoDownload';
import DownloadManager from './components/DownloadManager';
import SettingsPage from './components/Settings';
import Player from './components/Player';
import Browse from './components/Browse';

const MENU = [
  { id: 'browse', label: 'Khám phá', icon: Sparkles },
  { id: 'download', label: 'Tải Hongguo', icon: Film },
  { id: 'player', label: 'Trình phát', icon: Play },
  { id: 'manager', label: 'Quản lý tải xuống', icon: Download },
  { id: 'settings', label: 'Cài đặt', icon: Settings },
];

export default function App() {
  const [page, setPage] = useState('browse');
  const [appInfo, setAppInfo] = useState(null); // { version, brand, appName }
  const [playerTarget, setPlayerTarget] = useState(null); // Phát từ trang duyệt -> chọn sẵn ở trang phát

  useEffect(() => {
    window.electronAPI.getAppInfo().then((info) => {
      setAppInfo(info);
    });
  }, []);

  // Lệnh điều hướng từ main process (vd. bấm «Phát ngay» ở trang duyệt)
  useEffect(() => {
    if (!window.electronAPI.onNavigate) return undefined;
    return window.electronAPI.onNavigate((data) => {
      if (!data || !data.page) return;
      if (data.payload) setPlayerTarget({ ...data.payload, ts: Date.now() });
      setPage(data.page);
    });
  }, []);

  const renderPage = () => {
    switch (page) {
      case 'browse':
        return <Browse onNavigate={setPage} />;
      case 'player':
        return <Player target={playerTarget} onNavigate={setPage} />;
      case 'manager':
        return <DownloadManager onNavigate={setPage} />;
      case 'settings':
        return <SettingsPage />;
      case 'download':
      default:
        return <HongguoDownload onNavigate={setPage} />;
    }
  };

  return (
    <div className="app-layout">
      {/* Thanh bên trái */}
      <div className="sidebar">
        <div className="sidebar-brand">
          <div className="logo">
            <Film size={18} />
          </div>
          <div>
            <div className="brand-text">{appInfo ? appInfo.brand : 'Trình tải phim ngắn Hongguo'}</div>
            <div className="brand-sub">Trình tải phim ngắn Hongguo v{appInfo ? appInfo.version : ''}</div>
          </div>
        </div>

        <div className="sidebar-menu">
          {MENU.map((item) => {
            const Icon = item.icon;
            return (
              <div
                key={item.id}
                className={`sidebar-item ${page === item.id ? 'active' : ''}`}
                onClick={() => setPage(item.id)}
              >
                <Icon size={18} />
                <span>{item.label}</span>
              </div>
            );
          })}
        </div>

        <div className="sidebar-footer">
          <div className="footer-note">Giải mã AES-128 CENC gốc · Không watermark</div>
        </div>
      </div>

      {/* Vùng nội dung chính bên phải */}
      <div className="main-wrapper">
        <div className="main-content">{renderPage()}</div>
      </div>
    </div>
  );
}
