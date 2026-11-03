# Thông tin giấy phép thành phần bên thứ ba

Phần mềm này (Trình tải phim ngắn Hongguo) sử dụng các thành phần bên thứ ba sau. Bản quyền của từng thành phần thuộc về tác giả tương ứng;
việc phần mềm này sử dụng các thành phần đó đều tuân theo giấy phép gốc của chúng.

---

## Phụ thuộc lúc chạy

| Thành phần | Phiên bản | Giấy phép | Địa chỉ dự án |
|---|---|---|---|
| Electron | 28.3.3 | MIT | https://github.com/electron/electron |
| React | 18.3.1 | MIT | https://github.com/facebook/react |
| React DOM | 18.3.1 | MIT | https://github.com/facebook/react |
| axios | ^1.13.2 | MIT | https://github.com/axios/axios |

Sản phẩm đóng gói của Electron đã bao gồm thông báo giấy phép của Chromium và Node.js:

- `LICENSE.electron.txt`
- `LICENSES.chromium.html`

---

## Chương trình thực thi tích hợp

### FFmpeg (GPLv3)

| Mục | Mô tả |
|---|---|
| File | `resources/bin/ffmpeg.exe`, `resources/bin/ffprobe.exe` |
| Phiên bản | FFmpeg 7.1-essentials_build |
| Nguồn | https://www.gyan.dev/ffmpeg/builds/ |
| Tham số build | Có `--enable-gpl --enable-version3 --enable-libx264 --enable-libx265` |
| **Giấy phép** | **GNU General Public License v3.0** |
| Mã nguồn | https://ffmpeg.org/download.html · https://github.com/FFmpeg/FFmpeg |

Mục đích: nối các phân đoạn cho «Gộp một chạm», chuyển đổi định dạng cho «Chế độ tương thích»
(khắc phục lỗi «màn hình đen nhưng có tiếng» trên một số máy không giải mã phần cứng được HEVC).

Toàn văn giấy phép phân phối kèm phần mềm nằm trong `resources/bin/`:

- `COPYING.GPLv3` —— toàn văn GPLv3 (giấy phép chính áp dụng cho bản build này)
- `COPYING.GPLv2` —— toàn văn GPLv2
- `COPYING.LGPLv2.1` —— toàn văn LGPLv2.1
- `LICENSE.md` —— thông tin giấy phép chính thức của FFmpeg
- `FFMPEG-NOTICE.txt` —— ghi chú bổ sung của dự án này và cách lấy mã nguồn

FFmpeg là chương trình bên thứ ba độc lập; phần mềm này chỉ gọi giao diện công khai của nó qua dòng lệnh, không sửa đổi mã nguồn của nó.

---

## Phụ thuộc phát triển

Các công cụ sau được dùng lúc build (không phân phối kèm phần mềm):

| Thành phần | Giấy phép |
|---|---|
| Vite | MIT |
| electron-builder | MIT |
| @vitejs/plugin-react | MIT |
| concurrently | MIT |
| wait-on | MIT |

---

## Bản thân phần mềm này

Phần mềm này được phát triển tiếp dựa trên dự án thượng nguồn, toàn bộ được phát hành theo **GNU General Public License v3.0**,
chi tiết xem `LICENSE` và `NOTICE` ở thư mục gốc kho mã.
