# Ý tưởng ứng dụng: LUMEN - Event Media Controller

Đây là bản mô phỏng ý tưởng cho phần mềm điều phối sự kiện tại công ty, thay thế vMix/OBS bằng một giao diện đơn giản, chuyên biệt.

## 1. Mục tiêu (Core Goal)
Xây dựng một ứng dụng Desktop (Electron) giúp người vận hành (Operator) điều khiển nội dung hiển thị ra màn hình lớn (Máy chiếu, LED) một cách tin cậy nhất mà không cần học các công cụ phức tạp.

## 2. Các Tính năng Chính

### Giao diện Điều khiển (Màn hình chính)
- **Library List:** Danh sách các file Ảnh/Video đã chuẩn bị sẵn.
- **Preview Screen:** Một ô nhỏ cho biết cái gì đang được phát ở màn hình phụ.
- **Master Controls:** 
    - Nút **GO LIVE**: Đẩy nội dung đã chọn ra sân khấu.
    - Nút **STOP/BLACK**: Ngắt màn hình ngay lập tức (Xóa nội dung).
    - Nút **FREEZE**: Giữ nguyên hình ảnh cũ để chuẩn bị cái mới.

### Giao diện Sân khấu (Màn hình phụ)
- **Borderless / Fullscreen:** Độ phân giải theo màn hình thật (1080p hoặc 4K).
- **Smooth Transition:** Hiệu ứng Fade mờ dần khi chuyển giữa các clip/hình ảnh.
- **Watermark/Ticker:** Tự động đè logo công ty hoặc dòng chữ thông báo nhỏ ở dưới.

## 3. Lý do chọn Electron
- Tự động hóa việc nhận diện Monitor qua HDMI.
- Giao diện có thể tự thiết kế bằng HTML/CSS để đạt thẩm mỹ cao nhất cho công ty.
- Hiệu năng ổn định cho việc chạy Video offline.

## 4. Kế hoạch Phát triển
1. **Giai đoạn 1:** Build khung Electron, kết nối 2 Monitor.
2. **Giai đoạn 2:** Xây dựng tính năng kéo thả Media và phát cơ bản.
3. **Giai đoạn 3:** Thêm các hiệu ứng chuyển cảnh (Fade) và Overlay (Logo).
