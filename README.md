# LUMEN PRO - Event Media Controller

**LUMEN PRO** là giải pháp phần mềm Desktop chuyên dụng dành cho người vận hành sự kiện (Event Operator), thay thế các công cụ phức tạp như vMix, OBS hay Resolume bằng một giao diện trực quan, tinh gọn và an toàn tuyệt đối (*Safe-to-Operate*) cho màn hình LED sân khấu và máy chiếu hội trường.

---

## 🌟 Tính năng Nổi bật

### 1. Kiến trúc Chuẩn Broadcast: Dual Monitor (PVW / PGM)
* **Kênh PREVIEW (PVW - Green Tally):** Cho phép xem trước, kiểm tra clip, tua seekbar và cấu hình hành vi kết thúc clip mà không ảnh hưởng tới sân khấu.
* **Kênh PROGRAM (PGM - Red Tally "ON AIR"):** Phản chiếu thời gian thực nội dung đang phát ra màn hình LED cùng đồng hồ đếm ngược (Time Remaining / Elapsed).
* **Bộ trộn Chuyển cảnh (Transition Hub):** Hỗ trợ chuyển tức thì (**CUT 0ms**) hoặc các mức hòa trộn mượt mà (**FAST 0.4s**, **NORMAL 0.8s**, **SLOW 1.6s**).

### 2. Dual-Deck Seamless Playback Engine (Sân khấu)
* Duy trì 2 player phần cứng (Deck A & Deck B) chạy song song trên nền tảng tăng tốc GPU của Chromium.
* **Không bao giờ bị chớp đen** khi đổi clip.
* **Tự động ẩn trỏ chuột (`cursor: none !important;`)** để không bao giờ để lộ thao tác chuột ra màn hình LED.

### 3. Trung tâm Cứu nguy Khẩn cấp (Panic Controls)
* `[SPACE]` / `[ENTER]`: **GO LIVE** (Đẩy nội dung từ PVW ra PGM).
* `[L]`: **SAFE LOGO** (Chuyển êm về Key Visual / Logo sự kiện an toàn).
* `[F]`: **FREEZE** (Đóng băng khung hình hiện tại).
* `[T]`: **FTB (Fade To Black)** (Hạ mờ dần cả hình và âm lượng về nền đen trong 1s).
* `[B]` / `[ESC]`: **BLACKOUT** (Dập đen tức thì).
* `[M]`: **MUTE / UNMUTE** Master Audio.

### 4. Quản lý Đa Màn hình & Tự phục hồi Cáp HDMI (Hot-Plug Resilient)
* Tự động quét và liệt kê danh sách màn hình kết nối qua HDMI/DisplayPort.
* Cho phép chọn màn hình xuất trực tiếp trên thanh điều khiển.
* Bắt sự kiện cắm/rút cáp HDMI để tự định vị lại cửa sổ Sân khấu mà không crash app.
* Kích hoạt `powerSaveBlocker` ngăn Windows bật Screensaver hoặc Sleep trong suốt sự kiện.

### 5. Quản lý Rundown / Cue Sheet Thông minh
* Hỗ trợ Video (`mp4`, `mov`, `webm`, `mkv`) và Hình ảnh (`png`, `jpg`, `svg`, `webp`).
* Thiết lập **End Behavior** cho từng Cue:
  * `HOLD_LAST_FRAME`: Dừng ở khung hình cuối (chuẩn cho slide, video giới thiệu).
  * `LOOP`: Lặp lại vô tận (dành cho countdown, background chờ khách).
  * `AUTO_NEXT`: Tự động nhảy sang cue tiếp theo khi hết video.
  * `FADE_TO_BLACK`: Tự động hạ đen sau khi video kết thúc.

### 6. Âm thanh & Lớp Đồ họa Phủ (Overlays)
* Điều hướng thiết bị xuất âm thanh chuyên biệt (`setSinkId`).
* Cần gạt Master Volume và cặp VU Meter mô phỏng theo dB thực tế.
* Bật/Tắt Watermark Logo sự kiện.
* **Live Marquee Ticker:** Gõ và đẩy chữ chạy thông báo khẩn cấp lên đáy màn hình LED trực tiếp.

---

## 🚀 Hướng dẫn Cài đặt & Khởi chạy

### Yêu cầu Hệ thống
* Node.js v18 trở lên (Khuyến nghị LTS).
* Windows 10/11 hoặc macOS/Linux.

### Cài đặt
```bash
# Cài đặt các gói phụ thuộc
npm install
```

### Khởi chạy
```bash
# Khởi chạy chế độ điều khiển
npm start
```

---

## 📂 Cấu trúc Dự án
```
LUMEN/
├── assets/                    # Tài nguyên mẫu (Logo, Key Visual SVG, Countdown)
├── ideas/
│   └── event_media_controller.md # Tài liệu đặc tả kiến trúc và thiết kế
├── src/
│   ├── main/
│   │   └── index.js           # Tiến trình chính Electron (Display Mgr, IPC, PowerBlock)
│   └── renderer/
│       ├── operator/
│       │   └── index.html     # Dashboard Điều khiển (Dual PVW/PGM, Rundown, Controls)
│       └── stage/
│           └── index.html     # Engine Sân khấu (Dual-Deck, Overlays, Zero Cursor)
├── package.json
└── README.md
```
