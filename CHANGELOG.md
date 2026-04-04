# Changelog

Tất cả các thay đổi quan trọng của dự án **LUMEN** sẽ được ghi lại tại đây.

## [1.0.0] - 2026-04-04

### ✨ Những tính năng mới (Added)
- **Hệ thống Menu Operator (Dashboard):** Giao diện Premium mô phỏng chính xác bản mẫu (Mockup) với phong cách Glassmorphism và Neon Glow.
- **Cơ chế đồng bộ hóa (Heartbeat Sync):** Sử dụng IPC để truyền tín hiệu thời gian thực (16:9) giữa Stage và Dashboard, đảm bảo không lệch pha.
- **Thư viện Media thông minh:** Cho phép kéo thả (Drag & Drop) và nạp file media trực tiếp vào ứng dụng; dữ liệu được tự động lưu trữ (Persistence) qua `localStorage`.
- **Mô phỏng 16:9 Aspect Ratio:** Khung xem trước trên Dashboard được khóa ở tỷ lệ màn hình rộng chuẩn Tivi.
- **Hiệu ứng Chuyển cảnh (Cross-fade):** Triển khai kỹ thuật Layer A/B để chuyển đổi video mượt mà trong 0.8 giây, không bị giật hay đen màn hình.
- **Hỗ trợ đa màn hình:** Tự động phát hiện màn hình phụ (HDMI/Projector) để mở cửa màng Stage toàn màn hình.

### 🛡️ Bản vá kỹ thuật & Tối ưu (Optimized)
- **Memory Management:** Tối ưu hóa việc dọn dẹp RAM thông qua các lệnh `pause()` và xóa `src` thủ công khi chuyển clip, tránh rò rỉ bộ nhớ (Memory Leak) cho các show diễn dài.
- **Fix Scaling:** Sửa lỗi tràn màn hình của các tệp ảnh/video độ phân giải cực cao (4K/8K) trên cả Stage và Dashboard.
- **Security Logic:** Cấu hình `webSecurity: false` để cho phép nạp tài nguyên trực tiếp từ đường dẫn tệp cục bộ.

### ⌨️ Điều khiển & Phím tắt (Control)
- Hệ thống Hotkeys chuyên nghiệp cho các lệnh GO LIVE (Space), BLACKOUT (Esc), FREEZE (F).
- Thanh công cụ Overlay tích hợp để tắt/bật Logo và cập nhật nội dung Ticker (chữ chạy) tức thì.

---
© 2026 LUMEN Project. Powered by ggviet Electronics & Media.
