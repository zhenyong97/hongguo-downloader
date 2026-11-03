# 🎬 Trình tải phim ngắn Hongguo (bản desktop cho Windows)

<div align="center">

![Nền tảng](https://img.shields.io/badge/N%E1%BB%81n%20t%E1%BA%A3ng-Windows%2010%20%2F%2011%20x64-blue?style=for-the-badge&logo=windows)
![Công nghệ](https://img.shields.io/badge/C%C3%B4ng%20ngh%E1%BB%87-Electron%20%2B%20React%20%2B%20Node.js-47848F?style=for-the-badge&logo=electron)
![Giấy phép](https://img.shields.io/badge/Gi%E1%BA%A5y%20ph%C3%A9p%20m%C3%A3%20ngu%E1%BB%93n%20m%E1%BB%9F-GPL--3.0-orange?style=for-the-badge)

**Duyệt · Tìm kiếm · Tải hàng loạt · Xem trực tuyến · Gộp một chạm · Dọn dẹp ổ đĩa**

Giải mã luồng CENC-AES-CTR thuần · Chất lượng gốc, không watermark · Vừa tải vừa xem · Tích hợp sẵn ffmpeg

</div>

---

## 📖 Giới thiệu

Công cụ desktop Windows dành cho **phim ngắn Hongguo (Hồng Quả — kênh phim ngắn của Fanqie Novel / hệ novelread)**.

Ứng dụng dùng kiến trúc **Electron + React + Node.js**, tích hợp sẵn giao thức API phim ngắn của hệ ByteDance cùng
**engine giải mã luồng CENC-AES-CTR thuần (native)**: có thể duyệt/tìm kiếm phim, tải hàng loạt theo tập đã chọn và tự động giải mã thành
MP4 không watermark; kết hợp trình phát tích hợp, xem trực tuyến và gộp một chạm, tạo thành vòng khép kín «khám phá → tải → xem → dọn dẹp».

Ngoài Hongguo, ứng dụng còn có nguồn thứ hai là **PineDrama** (qua API reelfren).

> **Nguồn gốc và tuyên bố sửa đổi**: Kho mã này là **phiên bản đã sửa đổi** của
> [327044572/hongguo-downloader](https://github.com/327044572/hongguo-downloader) (sửa đổi từ tháng 9/2026),
> được tuyên bố theo Điều 5(a) của GPL-3.0. Chi tiết các thay đổi xem tại [NOTICE](NOTICE);
> toàn bộ phiên bản này tiếp tục được cấp phép theo **GPL-3.0**.

---

## 🖼️ Xem trước giao diện

### 🔍 Duyệt — tìm phim như lướt kho phim

Lọc và duyệt theo phân loại (phim người đóng / phim hoạt hình / phim AI / truyện tranh) và thể loại (đô thị / phản công / cổ trang / huyền huyễn…);
thẻ phim hiển thị ảnh bìa, tổng số tập và **tiến độ đã tải** (huy hiệu xanh ở góc trên bên phải), phía dưới phân trang theo số trang thực tế.

<img src="docs/screenshots/01-browse.jpg" width="860" alt="Trang duyệt">

### 📺 Chi tiết phim — mở ra là lấy đủ tất cả các tập

Mở bất kỳ phim nào là tự động phân tích toàn bộ các tập, hiển thị trạng thái từng tập dạng lưới; hỗ trợ chọn nhanh 10 tập đầu / 30 tập đầu / 30 tập cuối,
hoặc dùng cú pháp khoảng (ví dụ `1-50`, `1-10, 25, 30-45`) để chọn hàng loạt, hoặc bấm «Phát ngay».

<img src="docs/screenshots/02-browse-detail.jpg" width="860" alt="Chi tiết phim">

### 🔎 Tìm kiếm — chỉ cần nhập tên phim

Nhập tên phim, trình duyệt tích hợp sẽ dò (sniff) kết quả tìm kiếm; bấm vào thẻ là vào thẳng phần chọn tập để tải.

<img src="docs/screenshots/03-search.jpg" width="860" alt="Tìm kiếm phim">

### ▶️ Trình phát — vừa tải vừa xem

Tải xong tập nào là xem được tập đó, không cần đợi tải hết cả phim. Thanh trên cùng lần lượt có **công tắc phát liên tục, chế độ tương thích, tự xoá sau khi xem**,
tải các tập chưa xong và gộp xuất file; với tập chưa tải, bấm một cái là **xem trực tuyến** (không ghi ra ổ đĩa).

<img src="docs/screenshots/04-player.jpg" width="860" alt="Trình phát">

### 🗂️ Quản lý phim — chuyển phim / xem dung lượng / xoá

«Chuyển phim» mở bảng quản lý: có thể tìm theo tên phim, xem tiến độ đã tải và dung lượng ổ đĩa của từng phim,
xoá file cục bộ hoặc gỡ khỏi danh sách theo từng phim; phía dưới còn có lối vào dọn dẹp hàng loạt.

<img src="docs/screenshots/05-player-series.jpg" width="860" alt="Bảng quản lý phim">

### 🔗 Gộp — nhanh hoặc tương thích

Khi gộp toàn bộ tập có thể chọn hai chế độ: **Gộp nhanh** (nối trực tiếp giữ chất lượng gốc, xong trong vài giây) hoặc
**Gộp tương thích** (chuyển mã sang H.264, máy tính/trình phát nào cũng phát được).

<img src="docs/screenshots/06-merge-dialog.jpg" width="860" alt="Chọn định dạng gộp">

### 📋 Quản lý tải xuống — hàng đợi và điều khiển

Phía trên hiển thị theo thời gian thực «Đang chạy / Hoàn tất / Thất bại»; thanh công cụ hỗ trợ **bắt đầu tất cả, tạm dừng tất cả,
thử lại toàn bộ mục lỗi, chọn các mục lỗi, quét thư mục để đăng ký bổ sung, gộp một chạm phim này** và nhiều thao tác khác.

<img src="docs/screenshots/07-downloads.jpg" width="860" alt="Quản lý tải xuống">

### ⚙️ Cài đặt — thư mục / đặt tên / số luồng / proxy

Thư mục tải, mẫu đặt tên file, số luồng tải đồng thời tối đa, cùng proxy mạng (theo hệ thống / chỉ định thủ công / buộc kết nối trực tiếp);
lưu xong là có hiệu lực ngay, không cần khởi động lại.

<img src="docs/screenshots/08-settings.jpg" width="860" alt="Cài đặt">

---

## ✨ Tổng quan tính năng

### 1. 🔍 Khám phá phim

| Cách | Mô tả |
|---|---|
| **Duyệt** (khuyên dùng) | Lọc theo phân loại (phim người đóng / phim hoạt hình / phim AI / truyện tranh) + thể loại, duyệt danh sách của trang chính thức dạng thẻ, có phân trang (24 phim mỗi trang) |
| **Tìm kiếm** | Nhập tên phim, trình duyệt tích hợp dò kết quả tìm kiếm, bấm vào thẻ ảnh bìa là dùng được |
| **Dán link / ID** | Hỗ trợ link chia sẻ từ App, đoạn văn bản dài có kèm lời dẫn, hoặc `series_id` dạng số thuần |

- Mở bất kỳ phim nào là tự động lấy **danh sách toàn bộ tập** (tên phim, ảnh bìa, tổng số tập, tiêu đề và `vid` của từng tập) và ghi vào hồ sơ phim cục bộ
- Việc dò chỉ dựa vào `series_id` trong link, không phụ thuộc tên class giao diện của trang, nên khó bị hỏng khi trang đổi giao diện
- Khi thất bại có thể bật «Hiện cửa sổ trình duyệt» để xử lý thủ công
- Nguồn thứ hai **PineDrama** được lấy qua API reelfren (`src/native/reelfren.js`)

### 2. 🎯 Chọn tập và tải xuống

- **Chọn nhanh**: chọn tất cả / đảo chọn / bỏ chọn / 10 tập đầu / 30 tập đầu / 30 tập cuối
- **Cú pháp khoảng**: `1-50`, `1-10, 25, 30-45`, `1, 3, 5, 7, 9`
- **Chọn từng tập**: tích từng tập trên lưới huy hiệu
- **Tải đồng thời**: 1~10 luồng song song (mặc định 3), hàng đợi tự động nối tiếp
- **Giải mã native**: dẫn xuất khoá `spade_a` + giải mã luồng CENC-AES-CTR, xuất thẳng MP4 chuẩn, không cần chuyển mã lần hai
- **Chống hỏng file**: ghi trước ra `.enc.tmp`, chỉ đổi tên thành `.mp4` khi giải mã thành công, mất mạng giữa chừng cũng không để lại file dở dang

### 3. ▶️ Phát

**Trình phát tích hợp** (mục «Phát» ở thanh bên trái)

- Phát trực tiếp các tập đã tải về máy, **tải xong tập nào xem được tập đó**, không cần đợi tải hết cả phim
- **Phát xong tự chuyển tập kế tiếp**; nếu tập kế tiếp đang tải thì hiển thị tiến độ và **tự động phát tiếp** khi tải xong
- **Xem tiếp từ chỗ dừng**: nhớ mỗi phim đang xem đến tập nào, giây thứ mấy
- **Phím tắt**: `Space` phát/tạm dừng · `←` `→` lùi/tiến 5 giây · `↑` `↓` tập trước/tập sau · `A` bật/tắt phát liên tục
- **Bảng quản lý phim**: mở bằng «Chuyển phim», có thể tìm kiếm, chuyển phim, xem dung lượng từng phim, xoá file hoặc gỡ khỏi danh sách

**Xem trực tuyến (không ghi ra ổ đĩa)**

- Tập chưa tải **bấm một cái là xem trực tuyến**, không ghi vào thư mục tải
- Cách thực hiện: video mã hoá CENC không thể đưa thẳng cho trình phát, nên ứng dụng **«tải + giải mã» ngay trong bộ nhớ**,
  rồi cung cấp cho trình phát qua giao thức tuỳ biến `hongguo-stream://` theo Range
- Bộ nhớ đệm tối đa 300MB, tự động loại bỏ theo LRU, hỗ trợ kéo thanh tiến độ, có thể xoá sạch bằng một chạm

**Chế độ tương thích (khắc phục «màn hình đen nhưng có tiếng»)**

- Video của nền tảng mã hoá **HEVC**, Chromium trên Windows chỉ giải mã được bằng phần cứng;
  khi card đồ hoạ không hỗ trợ hoặc bị danh sách đen GPU chặn sẽ xảy ra «có tiếng nhưng màn hình đen»
- Lớp thứ nhất: chủ động bật giải mã HEVC của nền tảng và nới lỏng danh sách đen GPU
- Lớp thứ hai: nếu vẫn không giải mã được, tự động dùng ffmpeg tích hợp **chuyển mã tập đó sang H.264** rồi phát và lưu đệm
  - Tự dò bộ mã hoá: `nvenc` / `qsv` / `amf` / `mf` được kiểm tra lần lượt bằng cách **mã hoá thử một khung hình thật**, không dùng được thì quay về `libx264`
  - Bộ đệm chuyển mã tối đa 4GB, tự động loại bỏ
- Giao diện có công tắc «Chế độ tương thích bật/tắt» (mặc định bật)

### 4. 📋 Quản lý tải xuống

- **Theo dõi trạng thái**: đang chờ / đang tải / hoàn tất / thất bại / đã dừng
- **Tiến độ thời gian thực**: đã tải / tổng dung lượng, thanh tiến độ phần trăm
- **Bắt đầu tất cả / tạm dừng tất cả**: tạm dừng sẽ huỷ các tác vụ đang chạy và xoá hàng đợi; bắt đầu sẽ đưa các tác vụ chưa xong vào hàng đợi lại
- **Chỉ báo đồng thời theo thời gian thực**: «Đang tải đồng thời N / giới hạn»
- **Tự chạy tiếp khi khởi động**: mở phần mềm là tự tiếp tục các tác vụ lần trước chưa tải xong
- **Thử lại toàn bộ mục lỗi bằng một chạm**
- **Thao tác với tác vụ**: dừng / thử lại / mở thư mục / xoá
- **Quét thư mục để đăng ký bổ sung**: đưa các file đã có trên ổ đĩa nhưng không có trong danh sách trở lại danh sách tác vụ (tự phục hồi khi mất bản ghi tác vụ)

### 5. 🔗 Gộp một chạm

Gộp các tập đã tải của một phim thành một file MP4 duy nhất, tiện xem liền một mạch, không phải chuyển từng tập.

- Lối vào: nút `Gộp một chạm phim này` trên thanh công cụ «Quản lý tải xuống», nút `Gộp và xuất toàn bộ tập` ở trang trình phát
- **Gộp nhanh**: ffmpeg nối bằng sao chép luồng (`-c copy`), không mất chất lượng và cực nhanh (198 tập khoảng **17 giây**)
- **Gộp tương thích**: chuyển mã sang H.264, máy tính/trình phát nào cũng phát được (chậm hơn)
- Trước khi gộp kiểm tra **dung lượng ổ đĩa** và **tính đồng nhất của mã hoá**, sau khi gộp kiểm tra file đầu ra có đọc được không
- Sắp xếp theo số tập, tự bỏ qua các tập chưa tải; **gộp theo file thực tế trên ổ đĩa** (kể cả file mồ côi không có bản ghi tác vụ)
- Tích hợp sẵn ffmpeg, người dùng không cần tự cài

### 6. 🧹 Dọn dẹp ổ đĩa

- **Xoá theo phim**: trong bảng quản lý phim, xoá toàn bộ file cục bộ của phim đó bằng một chạm (gồm cả file đã gộp, file tạm còn sót, thư mục rỗng cũng bị xoá theo)
- **Xoá từng tập** + công tắc **tự xoá sau khi xem**: vừa xem vừa dọn, ổ đĩa không bị đầy
- **Khi xoá tác vụ có thể tích chọn** «Đồng thời xoá file cục bộ», kèm hiển thị dung lượng sẽ được giải phóng
- **Thống kê dung lượng**: hiển thị theo thời gian thực dung lượng cục bộ đang dùng (ví dụ `5.21 GB / 655 file`), hỗ trợ «Xoá tất cả đã tải»
- Sau khi xoá file vẫn **giữ lại hồ sơ phim**, sau này vẫn có thể xem trực tuyến hoặc tải lại
- Gỡ khỏi danh sách và xoá file là hai thao tác độc lập, không lo xoá nhầm

### 7. ⚙️ Cài đặt

- **Thư mục tải**: bất kỳ ổ đĩa / ổ cứng di động nào, tự động lưu theo cấu trúc `thư mục tải/PhimNganHongguo/tên phim/` (máy đã có thư mục `Phim ngắn Hongguo` từ bản trước thì tiếp tục dùng thư mục đó)
- **Mẫu đặt tên file**: `tên phim số tập` / `tên phim số tập tiêu đề` / `chỉ tên phim`, hỗ trợ `{series_title}` `{vid_index}` `{ep_title}`
- **Số luồng đồng thời tối đa**: 1~10 (mặc định 3), lưu là có hiệu lực ngay
- **Proxy mạng**:
  - Ba chế độ: **theo hệ thống** (biến môi trường) / **chỉ định thủ công** (hỗ trợ tài khoản mật khẩu) / **buộc kết nối trực tiếp**
  - Có sẵn các cổng proxy phổ biến (Clash 7890 / V2rayN 10809 / Shadowsocks 1080 / Burp 8080)
  - «Kiểm tra kết nối» xác minh ngay và hiển thị thời gian phản hồi
  - Lưu xong là **có hiệu lực ngay, không cần khởi động lại**, áp dụng cho phân tích API, tải video và tải ảnh trong cửa sổ

---

## 💻 Người dùng phổ thông: dùng trực tiếp

1. Tải **bản zip không cần cài đặt**, giải nén vào thư mục bất kỳ
2. Nhấp đúp vào **`TrinhTaiPhimNganHongguo.exe`** vừa giải nén
3. Không cần cài Node.js hay môi trường nào khác

> Dữ liệu ứng dụng được lưu tại `%APPDATA%\hongguo-downloader\`, gỡ cài đặt/xoá thư mục chương trình sẽ không làm mất lịch sử tải và cài đặt.

---

## 🛠️ Nhà phát triển: chạy cục bộ và đóng gói

### Yêu cầu môi trường

- Windows 10 / 11 x64
- Node.js >= 18 (khuyên dùng 20.x / 22.x)
- npm >= 9

### Phát triển cục bộ

```powershell
git clone https://github.com/327044572/hongguo-downloader.git
cd hongguo-downloader
npm install
npm run dev        # khởi động đồng thời frontend Vite và client Electron
```

### Đóng gói

```powershell
# 1) Chuẩn bị ffmpeg tích hợp (khoảng 88MB, không đưa vào repo, chỉ cần chạy một lần)
node scripts/setup-ffmpeg.js

# 2) Môi trường không có quyền quản trị cần chạy một lần (xem mục «giải nén winCodeSign thất bại» bên dưới)
node scripts/setup-winCodeSign.js

# 3) Đóng gói theo nhu cầu
npm run build             # bộ cài NSIS
npm run build:zip         # bản zip không cần cài đặt (khuyên dùng để phân phối)
npm run build:dir         # chỉ thư mục chạy không cần cài dist/win-unpacked
npm run build:portable    # file exe di động đơn lẻ
npm run zip               # chỉ nén lại win-unpacked đã có
```

**Đóng gói chéo từ macOS/Linux**: `scripts/setup-ffmpeg.js` cũng chạy được trên macOS/Linux (dùng lệnh `unzip` của hệ thống).
Có thể build bản Windows ngay trên macOS; trên Apple Silicon **bắt buộc** thêm cờ `--x64`:

```bash
node scripts/setup-ffmpeg.js
npm run build:react
npx electron-builder --win --dir --x64     # thư mục dist/win-unpacked
npx electron-builder --win nsis --x64      # bộ cài NSIS
```

### So sánh sản phẩm đóng gói

| Sản phẩm | Dung lượng | Mô tả |
|---|---|---|
| `TrinhTaiPhimNganHongguo-1.1.0-win-x64.zip` | ~158 MB | **Bản zip không cần cài đặt**: giải nén là dùng, khởi động nhanh nhất, **khuyên dùng để phân phối** |
| `TrinhTaiPhimNganHongguo-Setup-1.1.0.exe` | ~116 MB | **Bộ cài NSIS**: tạo shortcut, đổi được thư mục cài, gỡ cài đặt được |
| `TrinhTaiPhimNganHongguo-1.1.0-BanDiDong.exe` | ~108 MB | **File di động đơn lẻ**: nhấp đúp là dùng, nhưng mỗi lần khởi động phải tự giải nén nên chậm hơn |
| `win-unpacked/` | ~421 MB | Thư mục bản không cần cài đặt chưa nén (nguồn của file zip) |

> Trong zip đã có sẵn thư mục cấp cao nhất `TrinhTaiPhimNganHongguo-1.1.0/`, giải nén sẽ không làm file nằm vương vãi.

### Phát hành lên GitHub Release

**Lưu ý**: API tài sản (asset) của GitHub Release sẽ **lọc bỏ các ký tự không phải ASCII trong tên file**
(gh CLI và gọi API trực tiếp đều như vậy). Tên sản phẩm cục bộ hiện đã là ASCII; script dưới đây sao chép
chúng sang tên asset thống nhất `hongguo-downloader-*` trước khi tải lên:

```powershell
node scripts/prepare-release-assets.js      # tạo dist/release/ (tên ASCII)
gh release create v1.1.0 `
  --title "Trình tải phim ngắn Hongguo v1.1.0" `
  --notes-file release-notes.md `
  dist/release/*
```

| Sản phẩm cục bộ | Tên asset trên Release |
|---|---|
| `TrinhTaiPhimNganHongguo-1.1.0-win-x64.zip` | `hongguo-downloader-1.1.0-win-x64.zip` |
| `TrinhTaiPhimNganHongguo-Setup-1.1.0.exe` | `hongguo-downloader-1.1.0-Setup.exe` |
| `TrinhTaiPhimNganHongguo-1.1.0-BanDiDong.exe` | `hongguo-downloader-1.1.0-portable.exe` |

---

## ❓ Câu hỏi thường gặp

### Trang phát bị màn hình đen nhưng có tiếng

Video được mã hoá **HEVC** mà card đồ hoạ/driver của bạn không hỗ trợ giải mã phần cứng. Ứng dụng đã tích hợp «chế độ tương thích»:
khi phát sẽ tự động phát hiện, nếu không giải mã được hình thì dùng ffmpeg chuyển mã sang H.264 rồi phát (lần đầu chuyển mã mất vài giây, các lần sau dùng bộ đệm).

Bạn cũng có thể bấm «Chế độ tương thích» trên trang phát để kiểm tra trạng thái công tắc, hoặc bấm «Chuyển mã rồi phát» trên khung hình.

### Kéo thanh tiến độ trên file lớn đã gộp bị giật

Chromium hỗ trợ seek hạn chế với video HEVC rất dài. Bản thân file gộp vẫn nguyên vẹn (thời lượng/mã hoá đều đã được kiểm tra),
**xem liên tục từ đầu không có vấn đề gì**; khi cần tua, hãy dùng danh sách tập trong trình phát (seek từng tập bình thường),
hoặc mở bằng trình phát cục bộ như PotPlayer / VLC.

### Chép sang máy khác thì không có hình

Hãy đảm bảo dùng phiên bản mới nhất (đã tích hợp chế độ tương thích). Nếu vẫn lỗi, kiểm tra «Chế độ tương thích» trên trang phát có đang «bật» không.

### Đóng gói trên Windows thất bại: `Cannot create symbolic link`

`winCodeSign-2.6.0.7z` chứa hai symbolic link dành cho **macOS**
(`darwin/10.12/lib/libcrypto.dylib`, `libssl.dylib`). Trên Windows, tạo symbolic link cần
quyền quản trị hoặc «Developer Mode»; với quyền thường, 7-Zip sẽ thoát với mã 2 khiến quá trình đóng gói bị dừng.

Cách khắc phục (chọn một):

1. **Khuyên dùng**: trỏ thư mục cache tới `.eb-cache` đã được giải nén sẵn (đã có trong repo,
   `scripts/setup-winCodeSign.js` cũng giải nén vào đây). Biến môi trường mà electron-builder nhận là
   `ELECTRON_BUILDER_CACHE`:
   ```powershell
   node scripts/setup-winCodeSign.js      # nếu .eb-cache đã sẵn sàng sẽ bỏ qua
   $env:ELECTRON_BUILDER_CACHE = "$PWD\.eb-cache\"
   npm run build
   ```
   (Thiếu symbolic link của macOS không ảnh hưởng tới việc đóng gói Windows, thực tế chỉ dùng `windows-10/` và `rcedit-*.exe`)

   > Lưu ý: mỗi cửa sổ terminal mới đều phải đặt lại biến môi trường này,
   > nếu không electron-builder sẽ quay về thư mục cache mặc định `%LOCALAPPDATA%\electron-builder\Cache`,
   > giải nén lại và lại thất bại.
2. Chạy terminal với quyền quản trị, hoặc bật «Developer Mode» của Windows rồi đóng gói trực tiếp.

### Đóng gói báo lỗi `Access is denied`

Ứng dụng đang chạy và chiếm dụng file trong `dist/win-unpacked`. Hãy thoát hẳn chương trình rồi đóng gói lại.

### Sau khi nâng cấp danh sách tải trống trơn, nhưng file vẫn còn

Bấm «Quản lý tải xuống → Quét thư mục để đăng ký bổ sung», hoặc khởi động lại ứng dụng (khi khởi động sẽ tự khôi phục bản ghi từ ổ đĩa).
Chỉ cần file còn, bản ghi có thể dựng lại được.

---

## 📂 Cấu trúc dự án

```text
├── main.js                       # Tiến trình chính Electron: phân tích API, điều phối tải, giải mã, gộp,
│                                 #   luồng bộ nhớ cho xem trực tuyến, chuyển mã tương thích, dọn file
├── preload.js                    # Cầu nối IPC (contextBridge)
├── index.html                    # Điểm vào tiến trình renderer
├── vite.config.js
├── src/
│   ├── App.jsx                   # Giao diện chính và điều hướng thanh bên
│   ├── main.jsx
│   ├── index.css                 # Style toàn cục và biến theme
│   ├── store.js                  # Lưu trữ cục bộ (cài đặt / tác vụ / hồ sơ phim / tiến độ xem / bản ghi gộp)
│   ├── native/
│   │   ├── hongguo.js            # Giao thức lõi: phân tích API, dẫn xuất khoá spade_a,
│   │   │                         #   giải mã CENC-AES-CTR (bản file + bản bộ nhớ)
│   │   └── reelfren.js           # Nguồn PineDrama qua API reelfren
│   └── components/
│       ├── Browse.jsx            # Trang duyệt: phân loại / thể loại / phân trang / ngăn kéo chi tiết
│       ├── SearchPanel.jsx       # Trang tìm kiếm (dò bằng trình duyệt nhúng)
│       ├── HongguoDownload.jsx   # Trang tải: chuyển giữa tìm kiếm/link, chọn tập, gửi tác vụ
│       ├── Player.jsx            # Trình phát: phát cục bộ/trực tuyến, phát liên tục, chế độ tương thích, quản lý phim
│       ├── DownloadManager.jsx   # Quản lý tải: hàng đợi, tiến độ, gộp, xoá, đăng ký bổ sung
│       ├── Settings.jsx          # Cài đặt: thư mục, đặt tên, số luồng, proxy
│       └── icons.jsx             # Thư viện icon SVG
├── scripts/
│   ├── dev.js                    # Trình khởi chạy chế độ phát triển (Vite + Electron)
│   ├── setup-ffmpeg.js           # Tải ffmpeg tích hợp (không đưa vào repo; chạy được trên Windows/macOS/Linux)
│   ├── setup-winCodeSign.js      # Giải nén sẵn winCodeSign, né giới hạn symbolic link
│   ├── make-zip.js               # Đóng bản zip không cần cài đặt (kèm thư mục cấp cao nhất)
│   ├── prepare-release-assets.js # Tạo asset tên ASCII cho GitHub Release
│   └── verify-best-def.js        # Script debug: kiểm tra logic chọn luồng theo độ nét (parseModelVideo)
├── build/
│   ├── icon.png                  # Icon ứng dụng
│   └── ffmpeg/                   # ffmpeg tích hợp
│                                 #   file nhị phân do setup-ffmpeg.js tạo ra (không đưa vào repo)
│                                 #   văn bản giấy phép (COPYING.* / LICENSE.md / FFMPEG-NOTICE.txt) được đưa vào repo cùng mã nguồn
├── NOTICE                        # Tuyên bố nguồn gốc và sửa đổi (GPL-3.0 §5a)
├── THIRD-PARTY-NOTICES.md        # Danh sách giấy phép thành phần bên thứ ba
├── docs/screenshots/             # Ảnh chụp giao diện dùng cho README
├── dist/                         # Đầu ra đóng gói (.gitignore)
└── 红果视频刷访问量/             # 附带的协议分析与播放量研究工具集
```

---

## ⚖️ Miễn trừ trách nhiệm

1. Công cụ này chỉ dành cho **học tập, trao đổi và sao lưu cá nhân**, nghiêm cấm dùng cho vi phạm bản quyền thương mại, phát tán trái phép hoặc bất kỳ hành vi nào xâm phạm quyền lợi của bên thứ ba.
2. Hongguo và các nền tảng thuộc hệ Fanqie nắm toàn bộ bản quyền tác phẩm; nội dung lấy được qua phần mềm này vẫn thuộc bản quyền của nền tảng gốc và tác giả.
3. Chính sách API của nền tảng có thể thay đổi bất cứ lúc nào; nếu việc phân tích bị hỏng, vui lòng theo dõi cập nhật của kho mã thượng nguồn.
4. Người dùng tự chịu mọi hậu quả phát sinh từ việc sử dụng phần mềm này.

---

## 📄 Giấy phép mã nguồn mở và thành phần bên thứ ba

### Phần mềm này

Dự án này được phát triển tiếp dựa trên [327044572/hongguo-downloader](https://github.com/327044572/hongguo-downloader),
**toàn bộ được phát hành theo [GNU General Public License v3.0 (GPL-3.0)](LICENSE)**.

Là một phiên bản sửa đổi của GPL-3.0, kho mã này tuân thủ các yêu cầu sau:

| Yêu cầu | Cách thực hiện |
|---|---|
| Giữ nguyên giấy phép và thông báo bản quyền | [`LICENSE`](LICENSE) ở thư mục gốc repo (toàn văn GPL-3.0) |
| **Nêu rõ đã sửa đổi và ngày sửa đổi** (§5a) | [`NOTICE`](NOTICE) ở thư mục gốc repo, liệt kê nội dung sửa đổi và thời điểm bắt đầu |
| Toàn bộ tiếp tục cấp phép theo GPL-3.0 (§5c) | Kho mã này và mọi sản phẩm đóng gói đều theo GPL-3.0, không thêm hạn chế nào khác |
| Cung cấp mã nguồn tương ứng khi phân phối bản nhị phân (§6) | Mã nguồn công khai trong kho mã này; địa chỉ mã nguồn của thành phần bên thứ ba xem bên dưới |

### Thành phần bên thứ ba

| Thành phần | Giấy phép | Mô tả |
|---|---|---|
| Electron / React / axios | MIT | Phụ thuộc lúc chạy |
| **FFmpeg** | **GPLv3** | Tích hợp sẵn (dùng để gộp và chuyển mã), mã nguồn xem tại [ffmpeg.org](https://ffmpeg.org/download.html) |

- Danh sách đầy đủ giấy phép bên thứ ba: [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md)
- Gói phân phối đã kèm theo: `LICENSE.txt`, `NOTICE.txt`, `THIRD-PARTY-NOTICES.md` (cùng thư mục với chương trình chính),
  cùng các file của FFmpeg trong `resources/bin/`: `COPYING.GPLv3` / `COPYING.GPLv2` /
  `COPYING.LGPLv2.1` / `LICENSE.md` / `FFMPEG-NOTICE.txt`

> Tham số build của FFmpeg tích hợp có `--enable-gpl --enable-version3`, vì vậy giấy phép của nó là GPLv3.
> Phần mềm này chỉ gọi giao diện công khai của FFmpeg qua dòng lệnh, không sửa đổi mã nguồn FFmpeg.
