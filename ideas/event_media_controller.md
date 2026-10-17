# LUMEN - Event Media Controller (Đặc tả Kiến trúc & Thiết kế Thực chiến)

LUMEN là phần mềm Desktop chuyên dụng dành cho người vận hành sự kiện (Event Operator), thay thế các phần mềm phức tạp như vMix, OBS hay Resolume bằng một giải pháp tinh gọn, an toàn tuyệt đối (*Safe-to-Operate*) và tối ưu hóa cho màn hình LED / máy chiếu hội trường.

---

## 1. Tầm nhìn & Mục tiêu Cốt lõi
* **Không làm gián đoạn sân khấu (Zero Stage Disruption):** Tuyệt đối không lộ con trỏ chuột, không để lộ màn hình Desktop Windows, không bị ngắt quãng khi rút/cắm lại cáp HDMI, không để máy tính tự động bật chế độ ngủ (Sleep/Screensaver).
* **Quy trình chuẩn Broadcast:** Vận hành theo nguyên lý **Preview (PVW) & Program (PGM)** - Chuẩn bị và kiểm tra kỹ trước khi đưa nội dung ra sân khấu.
* **Cứu nguy tức thì (Panic & Fail-Safe Controls):** Cung cấp các nút phản xạ khẩn cấp 1-chạm: Blackout, Freeze, Fade to Black (FTB), Safe Logo.
* **Công thái học (Ergonomics):** Giao diện Dark Mode tương phản cao, hỗ trợ bàn phím số (Numpad) và phím tắt chuyên biệt để thao tác chính xác trong phòng tối.

---

## 2. Đánh giá & Kiến trúc Công nghệ: Vì sao chọn Electron?

Hội đồng thẩm định đã đối soát và kết luận: **Mô hình Hybrid trên nền Electron là giải pháp tối ưu nhất** cho bài toán này vì các lý do:
1. **Tốc độ phát triển & Giao diện hiện đại:** Tận dụng HTML5, CSS3 GPU Transitions và Flexbox/Grid để tạo giao diện điều khiển đẳng cấp studio nhanh hơn gấp nhiều lần so với C++/Qt.
2. **Khả năng quản lý Multi-Display mạnh mẽ:** Electron cung cấp API `screen.getAllDisplays()` và cơ chế định vị cửa sổ `BrowserWindow` không viền (`frame: false`, `fullscreen: true`) chuẩn xác đến từng pixel của màn hình phụ.
3. **Tối ưu phần cứng Chromium:** Kích hoạt các cờ tăng tốc GPU (`--enable-gpu-rasterization`, `--ignore-gpu-blocklist`, `--enable-zero-copy`) giúp giải mã và crossfade mượt mà nội dung 1080p và 4K.
4. **Chống ngủ hệ điều hành:** Tích hợp `powerSaveBlocker.start('prevent-display-sleep')` ngăn hệ điều hành tự động tắt màn hình LED.

---

## 3. Kiến trúc Luồng Dữ liệu & IPC

```
┌─────────────────────────────────────────────────────────────┐
│                 ELECTRON MAIN PROCESS                       │
│  - Display Manager (Hotplug detection, display selector)    │
│  - PowerSaveBlocker (Prevent OS sleep & screensaver)        │
│  - IPC Router (Bidirectional event bus)                     │
└──────────────────────┬───────────────────────┬──────────────┘
                       │                       │
      IPC (Events)     ▼                       ▼   IPC (Events)
┌──────────────────────────────┐       ┌──────────────────────────────┐
│       OPERATOR WINDOW        │       │         STAGE WINDOW         │
│  (Màn hình điều khiển chính) │       │  (Màn hình phụ LED/Projector)│
│  - Rundown / Cue Library     │       │  - Cursor: none (Ẩn trỏ chuột)│
│  - PVW Player (Xem trước)    │       │  - Dual-Deck A/B Video Engine│
│  - PGM Mirror (Sân khấu)     │       │  - Seamless Crossfade Layer  │
│  - Audio Monitor & Sink ID   │       │  - Safe Logo Overlay Layer   │
│  - Emergency Action Center   │       │  - Live Marquee Ticker Layer │
│  - Ticker & Watermark Editor │       │  - Freeze & Blackout Cover   │
└──────────────────────────────┘       └──────────────────────────────┘
```

---

## 4. Đặc tả Chi tiết các Khối Chức năng

### 4.1. Hệ thống Preview & Program (PVW / PGM)
* **Kênh Preview (Màn hình xanh lá - Green Tally):**
  * Nằm bên trái giao diện chính.
  * Hiển thị media đang được chọn trong Thư viện / Rundown.
  * Cho phép Operator tua seekbar, kiểm tra âm thanh trước bằng tai nghe (Cue Channel) mà không làm ảnh hưởng đến sân khấu.
* **Kênh Program (Màn hình đỏ - Red Tally "ON AIR"):**
  * Nằm bên phải giao diện chính.
  * Phản chiếu chính xác khung hình đang phát ra màn hình LED ngoài sân khấu.
  * Hiển thị đồng hồ đếm ngược thời gian còn lại của clip (Remaining Time) và thanh tiến trình thời gian thực.
* **Bộ trộn Chuyển cảnh (Transition Controls):**
  * **GO LIVE (Phím Space / Numpad Enter):** Kích hoạt chuyển cảnh mượt mà từ PVW sang PGM bằng hiệu ứng Auto-Fade.
  * **CUT:** Chuyển tức thì (0ms) giữa 2 nguồn phát.
  * **Thời gian Fade linh hoạt:** Lựa chọn giữa 0.5s, 1.0s hoặc 2.0s.

### 4.2. Kiến trúc Dual-Deck Seamless Playback Engine (Sân khấu)
Để loại bỏ hiện tượng nháy đen hoặc giật hình khi chuyển video trong trình duyệt:
* Cửa sổ Sân khấu duy trì **2 Player phần cứng (Deck A và Deck B)**.
* Khi Deck A đang phát trực tiếp (`opacity: 1`), Deck B sẽ load trước nội dung mới ở trạng thái ngầm (`opacity: 0`).
* Khi nhận lệnh **GO LIVE**:
  1. Deck B bắt đầu phát (`DeckB.play()`).
  2. Kích hoạt hiệu ứng CSS crossfade chuyển đổi opacity trong khoảng thời gian đã cài đặt.
  3. Khi hoàn tất fade, Deck A được tạm dừng và giải phóng tài nguyên.

### 4.3. Quản lý Thư viện Kịch bản (Rundown / Cue Sheet)
* **Hỗ trợ định dạng:** MP4, WebM, MOV, PNG, JPG, JPEG, SVG, WebP.
* **Cấu hình cho từng Cue Item:**
  * **End Behavior (Hành vi khi hết video):**
    * `HOLD_LAST_FRAME`: Đóng băng tại khung hình cuối (lý tưởng cho slide, intro thuyết trình).
    * `LOOP`: Lặp lại vô tận (dành cho video background đón khách, countdown).
    * `AUTO_NEXT`: Tự động nhảy sang mục tiếp theo trong Rundown.
    * `FADE_TO_BLACK`: Tự động hạ đen sau khi hết clip.
  * **Scaling Mode (Tỉ lệ màn hình):** `Contain` (giữ tỉ lệ gốc), `Cover` (lấp đầy khung LED), `Stretch` (kéo dãn theo độ phân giải màn hình).

### 4.4. Hệ thống Cứu nguy Khẩn cấp (Panic Center)
* **SAFE LOGO (Phím L):** Chuyển êm màn hình về Key Visual / Logo sự kiện chính thức, dập tắt âm thanh video ngay lập tức.
* **BLACKOUT (Phím B / Esc):** Dập tắt toàn bộ hình ảnh và mute âm thanh tức thì (0ms).
* **FADE TO BLACK - FTB (Phím T):** Hạ mờ dần cả hình ảnh và âm lượng về nền đen trong 1 giây.
* **FREEZE (Phím F):** Đóng băng khung hình hiện tại trên sân khấu, cho phép Operator tự do thao tác trên dashboard mà sân khấu không bị biến động.

### 4.5. Định tuyến Âm thanh & Giám sát (Audio Routing)
* Tách biệt 2 luồng âm thanh độc lập qua API `HTMLMediaElement.setSinkId()`:
  * **Cue Output (Tai nghe Operator):** Nghe thử âm thanh của clip đang ở Preview.
  * **Master Output (FOH / Mixer hội trường):** Xuất âm thanh của clip Program ra cổng HDMI hoặc Soundcard chuyên dụng.
* **Master Volume Fader & VU Meter:** Điều chỉnh âm lượng tổng trực tiếp và hiển thị mức âm thanh trực quan.

### 4.6. Lớp Đồ họa Phủ (Overlay Graphics)
* **Logo / Watermark:** Hiển thị logo chương trình ở góc màn hình với độ mờ trong suốt tùy chỉnh.
* **Live Ticker (Chữ chạy Marquee):** Nhập trực tiếp nội dung thông báo khẩn cấp (vd: thông báo di dời xe, thông báo giờ ăn trưa) và đẩy lên chân màn hình LED mà không làm ngắt video đang phát.

### 4.7. Sơ đồ Phím tắt Công thái học
* `Space` / `Numpad Enter`: **GO LIVE** (Chuyển nội dung từ PVW ra PGM).
* `KeyB` / `Numpad -`: **BLACKOUT** (Dập đen khẩn cấp).
* `KeyF` / `Numpad *`: **FREEZE** (Đóng băng khung hình).
* `KeyL` / `Numpad 4`: **SAFE LOGO** (Về hình nền an toàn).
* `KeyT` / `Numpad +`: **FADE TO BLACK** (Hạ đen êm).
* `KeyM` / `Numpad /`: **MUTE / UNMUTE** Master Audio.
