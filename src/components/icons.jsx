// Bộ icon SVG nét mảnh kiểu lucide (stroke 1.75, viewBox 24x24)
// Cách dùng: <Home size={18} /> —— size quy định rộng/cao, className có thể ghi đè màu (currentColor)

import React from 'react';

const baseProps = (size = 18, strokeWidth = 1.75, className = '', style = {}) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  className,
  style,
  'aria-hidden': true,
});

export const Home = (p) => (
  <svg {...baseProps(p.size, p.strokeWidth, p.className, p.style)}>
    <path d="M3 9.5 12 3l9 6.5V20a1 1 0 0 1-1 1h-5v-7h-6v7H4a1 1 0 0 1-1-1V9.5Z" />
  </svg>
);

export const Download = (p) => (
  <svg {...baseProps(p.size, p.strokeWidth, p.className, p.style)}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
);

export const User = (p) => (
  <svg {...baseProps(p.size, p.strokeWidth, p.className, p.style)}>
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </svg>
);

export const Users = (p) => (
  <svg {...baseProps(p.size, p.strokeWidth, p.className, p.style)}>
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);

export const Radio = (p) => (
  <svg {...baseProps(p.size, p.strokeWidth, p.className, p.style)}>
    <circle cx="12" cy="12" r="2" />
    <path d="M16.24 7.76a6 6 0 0 1 0 8.49M7.76 16.24a6 6 0 0 1 0-8.49M19.07 4.93a10 10 0 0 1 0 14.14M4.93 19.07a10 10 0 0 1 0-14.14" />
  </svg>
);

export const MessageSquare = (p) => (
  <svg {...baseProps(p.size, p.strokeWidth, p.className, p.style)}>
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10Z" />
  </svg>
);

export const Flame = (p) => (
  <svg {...baseProps(p.size, p.strokeWidth, p.className, p.style)}>
    <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5Z" />
  </svg>
);

export const BarChart3 = (p) => (
  <svg {...baseProps(p.size, p.strokeWidth, p.className, p.style)}>
    <path d="M3 3v18h18" />
    <path d="M18 17V9" />
    <path d="M13 17V5" />
    <path d="M8 17v-3" />
  </svg>
);

export const Bell = (p) => (
  <svg {...baseProps(p.size, p.strokeWidth, p.className, p.style)}>
    <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
    <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
  </svg>
);

export const Film = (p) => (
  <svg {...baseProps(p.size, p.strokeWidth, p.className, p.style)}>
    <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18" />
    <line x1="7" y1="2" x2="7" y2="22" />
    <line x1="17" y1="2" x2="17" y2="22" />
    <line x1="2" y1="12" x2="22" y2="12" />
    <line x1="2" y1="7" x2="7" y2="7" />
    <line x1="2" y1="17" x2="7" y2="17" />
    <line x1="17" y1="17" x2="22" y2="17" />
    <line x1="17" y1="7" x2="22" y2="7" />
  </svg>
);

export const Cookie = (p) => (
  <svg {...baseProps(p.size, p.strokeWidth, p.className, p.style)}>
    <path d="M12 2a10 10 0 1 0 10 10c0-.46-.04-.92-.1-1.36a4 4 0 0 1-5.54-5.54A9.96 9.96 0 0 0 12 2Z" />
    <path d="M8.5 8.5h.01M16 15.5h.01M9 16h.01M14.5 9h.01M12 12h.01" />
  </svg>
);

export const Megaphone = (p) => (
  <svg {...baseProps(p.size, p.strokeWidth, p.className, p.style)}>
    <path d="m3 11 18-5v12L3 14v-3z" />
    <path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" />
  </svg>
);

export const Settings = (p) => (
  <svg {...baseProps(p.size, p.strokeWidth, p.className, p.style)}>
    <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

export const Plus = (p) => (
  <svg {...baseProps(p.size, p.strokeWidth, p.className, p.style)}>
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

export const Trash2 = (p) => (
  <svg {...baseProps(p.size, p.strokeWidth, p.className, p.style)}>
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    <line x1="10" y1="11" x2="10" y2="17" />
    <line x1="14" y1="11" x2="14" y2="17" />
  </svg>
);

export const RefreshCw = (p) => (
  <svg {...baseProps(p.size, p.strokeWidth, p.className, p.style)}>
    <polyline points="23 4 23 10 17 10" />
    <polyline points="1 20 1 14 7 14" />
    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
  </svg>
);

export const Check = (p) => (
  <svg {...baseProps(p.size, p.strokeWidth, p.className, p.style)}>
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

export const X = (p) => (
  <svg {...baseProps(p.size, p.strokeWidth, p.className, p.style)}>
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

export const ChevronRight = (p) => (
  <svg {...baseProps(p.size, p.strokeWidth, p.className, p.style)}>
    <polyline points="9 18 15 12 9 6" />
  </svg>
);

export const ChevronDown = (p) => (
  <svg {...baseProps(p.size, p.strokeWidth, p.className, p.style)}>
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

export const ExternalLink = (p) => (
  <svg {...baseProps(p.size, p.strokeWidth, p.className, p.style)}>
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    <polyline points="15 3 21 3 21 9" />
    <line x1="10" y1="14" x2="21" y2="3" />
  </svg>
);

export const AlertCircle = (p) => (
  <svg {...baseProps(p.size, p.strokeWidth, p.className, p.style)}>
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="8" x2="12" y2="12" />
    <line x1="12" y1="16" x2="12.01" y2="16" />
  </svg>
);

export const Search = (p) => (
  <svg {...baseProps(p.size, p.strokeWidth, p.className, p.style)}>
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);

export const Link2 = (p) => (
  <svg {...baseProps(p.size, p.strokeWidth, p.className, p.style)}>
    <path d="M15 7h3a5 5 0 0 1 5 5 5 5 0 0 1-5 5h-3m-6 0H6a5 5 0 0 1-5-5 5 5 0 0 1 5-5h3" />
    <line x1="8" y1="12" x2="16" y2="12" />
  </svg>
);

export const Activity = (p) => (
  <svg {...baseProps(p.size, p.strokeWidth, p.className, p.style)}>
    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
  </svg>
);

export const Heart = (p) => (
  <svg {...baseProps(p.size, p.strokeWidth, p.className, p.style)}>
    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
  </svg>
);

export const Eye = (p) => (
  <svg {...baseProps(p.size, p.strokeWidth, p.className, p.style)}>
    <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

export const Sparkles = (p) => (
  <svg {...baseProps(p.size, p.strokeWidth, p.className, p.style)}>
    <path d="M12 3v4M12 17v4M3 12h4M17 12h4" />
    <path d="m6.3 6.3 2.4 2.4M15.3 15.3l2.4 2.4M17.7 6.3l-2.4 2.4M8.7 15.3l-2.4 2.4" />
  </svg>
);

export const Clock = (p) => (
  <svg {...baseProps(p.size, p.strokeWidth, p.className, p.style)}>
    <circle cx="12" cy="12" r="10" />
    <polyline points="12 6 12 12 16 14" />
  </svg>
);

export const TrendingUp = (p) => (
  <svg {...baseProps(p.size, p.strokeWidth, p.className, p.style)}>
    <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
    <polyline points="16 7 22 7 22 13" />
  </svg>
);

export const Database = (p) => (
  <svg {...baseProps(p.size, p.strokeWidth, p.className, p.style)}>
    <ellipse cx="12" cy="5" rx="9" ry="3" />
    <path d="M3 5v14a9 3 0 0 0 18 0V5" />
    <path d="M3 12a9 3 0 0 0 18 0" />
  </svg>
);

export const Share2 = (p) => (
  <svg {...baseProps(p.size, p.strokeWidth, p.className, p.style)}>
    <circle cx="18" cy="5" r="3" />
    <circle cx="6" cy="12" r="3" />
    <circle cx="18" cy="19" r="3" />
    <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
    <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
  </svg>
);

export const Copy = (p) => (
  <svg {...baseProps(p.size, p.strokeWidth, p.className, p.style)}>
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);

export const Image = (p) => (
  <svg {...baseProps(p.size, p.strokeWidth, p.className, p.style)}>
    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
    <circle cx="8.5" cy="8.5" r="1.5" />
    <polyline points="21 15 16 10 5 21" />
  </svg>
);

export const Music = (p) => (
  <svg {...baseProps(p.size, p.strokeWidth, p.className, p.style)}>
    <path d="M9 18V5l12-2v13" />
    <circle cx="6" cy="18" r="3" />
    <circle cx="18" cy="16" r="3" />
  </svg>
);

export const Zap = (p) => (
  <svg {...baseProps(p.size, p.strokeWidth, p.className, p.style)}>
    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
  </svg>
);

export const Shield = (p) => (
  <svg {...baseProps(p.size, p.strokeWidth, p.className, p.style)}>
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
  </svg>
);

export const VideoChannel = (p) => (
  <svg {...baseProps(p.size, p.strokeWidth, p.className, p.style)}>
    <rect x="2" y="5" width="20" height="14" rx="3" ry="3" />
    <polygon points="10 9 15 12 10 15" fill="currentColor" stroke="none" />
  </svg>
);

export const Layers = (p) => (
  <svg {...baseProps(p.size, p.strokeWidth, p.className, p.style)}>
    <polygon points="12 2 2 7 12 12 22 7 12 2" />
    <polyline points="2 17 12 22 22 17" />
    <polyline points="2 12 12 17 22 12" />
  </svg>
);

export const Filter = (p) => (
  <svg {...baseProps(p.size, p.strokeWidth, p.className, p.style)}>
    <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
  </svg>
);

export const Globe = (p) => (
  <svg {...baseProps(p.size, p.strokeWidth, p.className, p.style)}>
    <circle cx="12" cy="12" r="9" />
    <line x1="3" y1="12" x2="21" y2="12" />
    <path d="M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18z" />
  </svg>
);

export const Edit3 = (p) => (
  <svg {...baseProps(p.size, p.strokeWidth, p.className, p.style)}>
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
  </svg>
);

export const FolderPlus = (p) => (
  <svg {...baseProps(p.size, p.strokeWidth, p.className, p.style)}>
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    <line x1="12" y1="11" x2="12" y2="17" />
    <line x1="9" y1="14" x2="15" y2="14" />
  </svg>
);

export const Play = (p) => (
  <svg {...baseProps(p.size, p.strokeWidth, p.className, p.style)}>
    <polygon points="6 3 20 12 6 21 6 3" />
  </svg>
);

export const Pause = (p) => (
  <svg {...baseProps(p.size, p.strokeWidth, p.className, p.style)}>
    <rect x="6" y="4" width="4" height="16" rx="1" />
    <rect x="14" y="4" width="4" height="16" rx="1" />
  </svg>
);

export const Bookmark = (p) => (
  <svg {...baseProps(p.size, p.strokeWidth, p.className, p.style)}>
    <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
  </svg>
);

export const Pin = (p) => (
  <svg {...baseProps(p.size, p.strokeWidth, p.className, p.style)}>
    <line x1="12" y1="17" x2="12" y2="22" />
    <path d="M5 17h14l-1.5-6V4a1 1 0 0 0-1-1h-9a1 1 0 0 0-1 1v7L5 17z" />
  </svg>
);

export const Tag = (p) => (
  <svg {...baseProps(p.size, p.strokeWidth, p.className, p.style)}>
    <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
    <line x1="7" y1="7" x2="7.01" y2="7" />
  </svg>
);

export const Folder = (p) => (
  <svg {...baseProps(p.size, p.strokeWidth, p.className, p.style)}>
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
  </svg>
);

export const CheckSquare = (p) => (
  <svg {...baseProps(p.size, p.strokeWidth, p.className, p.style)}>
    <polyline points="9 11 12 14 22 4" />
    <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
  </svg>
);

export const Square = (p) => (
  <svg {...baseProps(p.size, p.strokeWidth, p.className, p.style)}>
    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
  </svg>
);
