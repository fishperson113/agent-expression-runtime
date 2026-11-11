# Chat trực tiếp trong Fisch

POC: chạy `fisch live --panel` từ workspace muốn dùng, với Codex CLI đã đăng nhập.
Panel sở hữu một Codex app-server/thread riêng: gõ tại đây, nhận text streaming và
Dừng trả lời trong cùng thread. Không cần chuyển sang TUI. Plain `fisch live`
vẫn là terminal fallback; `fisch desktop` vẫn là MCP cho hội thoại bên ngoài.
Không nhúng/scrape Desktop và không tự nối vào một conversation đang chạy ở đó.

`fisch live --panel --thread <id>` yêu cầu resume rõ ràng một thread đã lưu, đã
ngừng dùng ở client khác. Không tự chọn thread, không fallback sang thread mới
nếu resume lỗi. Context do Codex lưu; panel chưa nhập toàn bộ lịch sử cũ để hiển thị.
Reload/đóng trang cần khởi chạy lại; không tự replay yêu cầu hoặc approval cũ.

Mục **Yêu cầu và công cụ** hiển thị Native tool events và yêu cầu lựa chọn/câu hỏi.
Chỉ Accept một lần sau khi đọc command/cwd hoặc diff đầy đủ tương ứng; không có
Accept-for-session hay thay policy tự động. Thiếu chi tiết, secret question hoặc
loại chưa hỗ trợ bị từ chối/hiển thị không hỗ trợ. Submitted không phải Native ACK,
execution hay renderer completion. Kết quả chưa rõ không được tự gửi lại.

Cấu hình sandbox/approval hiện có được giữ nguyên. Relay token ở host, không vào
browser. Observer vẫn là lane data-only riêng, có nhật ký riêng; chỉ public brief
được chia sẻ, không đưa camera vào coding history. Camera vẫn tắt tới khi cho phép.
Không STT/TTS mới; voice, Windows và trải nghiệm tự nhiên chưa được nghiệm thu.

Thiết kế dùng lại adapter Fisch, tham khảo ranh giới server/RPC của
[T3 Code](https://github.com/pingdotgg/t3code/blob/main/docs/internals/overview.md);
không nhập cả stack hay sao chép code. Test fixture không phải Codex model thật;
trạng thái nghiệm thu thật phải ghi exact head, thread/turn, receipt và hình hiển thị.
