# Thử Fisch Live trong 5 phút

Đây là bản POC để thử hội thoại cùng một cơ thể hạt mà Codex có thể tự tạo hình,
chọn màu và chuyển động. Phản ứng chủ động và độ tự nhiên còn đang được đánh giá;
model có thể giữ nguyên hình hoặc im lặng. Không cần đợi khả năng sáng tạo hoàn hảo
mới thử các luồng dưới đây.

## Chuẩn bị một lần

Cần Node.js **22.12+**, npm, **Rust stable cùng compiler của nền tảng**, Edge/Chrome
hoặc Playwright Chromium, và **Codex CLI đã đăng nhập** có hỗ trợ app-server/remote.
Đường CLI đã được kiểm tra với `0.167.0-alpha.4`; bản khác cần xác minh tương thích.
Đây là yêu cầu cài đặt, không phải chứng nhận Windows hoặc GPU của mọi máy.

```sh
git clone https://github.com/fishperson113/agent-expression-runtime.git
cd agent-expression-runtime
npm link
fisch live
```

Nếu đã có checkout, dùng checkout đã cập nhật và chạy `fisch live` trong terminal
rảnh tại project muốn làm việc. Từ checkout Fisch, `npm start` cũng mở Live.
Lần đầu launcher chuẩn bị npm dependencies, gateway Rust, frontend và face model;
đợi thông báo tiến độ. Nó không cài Rust, Codex hoặc browser thay bạn. Nếu thiếu
prerequisite, xem lỗi cụ thể hoặc chạy `fisch doctor`; xem thêm [setup](fisch-live.md#chuẩn-bị-checkout-mới).

## Luồng dùng thử

1. Browser mở với camera **tắt**, Codex chạy trong terminal khởi chạy. Bắt đầu hoặc
   chọn một thread ở terminal; sau đó dùng panel hội thoại hoặc terminal của cùng
   phiên. Nếu Codex hỏi trust/tool permission, đọc yêu cầu của chính Codex trước
   khi quyết định; Fisch không tự bỏ qua chúng.
2. Gửi một câu bình thường, rồi thử: “Dùng cơ thể hạt để góp một ý vào câu chuyện
   về một đám mây đi nghỉ; bạn tự chọn hình, màu và chuyển động.” Đây là yêu cầu
   thử capability, không phải bằng chứng agent luôn tự biểu đạt khi không được nhắc.
3. Chọn **Bật camera** và cấp quyền browser nếu muốn thử quan sát tại máy. Plain
   `fisch live` chuẩn bị phản ứng Native Codex mặc định, không cần tự tạo ledger,
   đặt biến reactive hay bật thêm công tắc. Cấu hình off/backend/budget đã có vẫn
   được tôn trọng. Không xóa usage history để chữa lỗi. “Đã cấu hình” không đồng
   nghĩa đã gọi model hoặc đã nhận phản ứng thành công.
4. Di chuyển rõ ràng, rồi đứng yên và tiếp tục trò chuyện. Quan sát local không
   đợi model; model tự chọn nói, biểu đạt hoặc giữ nguyên. Trường hình học tay/mặt
   không chứng minh hiểu đồ vật, cảm xúc hay giọng nói. Có cooldown/rate cap nên
   không mong mỗi chuyển động đều tạo câu trả lời. Hand tracking là tùy chọn:
   khởi chạy `fisch live --hands`, rồi bật control tương ứng có chủ đích.
5. Thử **Dừng biểu đạt**, **Tắt chuyển động**, tắt camera; text chat vẫn dùng được
   khi camera tắt. **Dừng trả lời** yêu cầu ngắt lượt hiện tại, không hứa server đã
   xác nhận kết thúc. **Dừng toàn bộ**, đóng browser hoặc Ctrl+C ở launcher sẽ đóng
   tài nguyên của phiên. Khởi chạy lại để bắt đầu phiên mới, không tự replay lời cũ.

## Checklist smoke ngắn

- [ ] Browser mở, camera chưa capture; thread Codex nhận được một tin nhắn text.
- [ ] Có thể yêu cầu một hình mới, thấy kết quả hoặc lỗi tool rõ ràng; “turn completed”
      một mình chưa chứng minh biểu đạt đã áp dụng.
- [ ] Khi bật camera có permission rõ ràng; tắt camera làm observation trở thành unknown.
- [ ] Giữ yên không tạo một hàng đợi lời nói; có thể gửi tin mới và dùng các nút dừng.
- [ ] Dừng toàn bộ đóng phiên; lần mở tiếp theo không chạy lại action cũ.

Nếu lỗi, giữ nguyên thông báo, bước đang làm và phiên bản Codex; không gửi token,
credential hoặc ảnh camera để báo lỗi. Ghi rõ mục nào chưa chạy thay vì đánh dấu đạt.

## Giới hạn cần biết trước

**Giọng nói:** mục tiêu là Dictate có sẵn của Codex: ghi âm, xem text rồi gửi. Chưa
chứng minh composer Codex Desktop gửi vào đúng private app-server/thread mà
`fisch live` đang dùng. Không coi CLI `/voice` là dictation-only, và đừng mở một
chat Desktop khác rồi mặc định nó đang điều khiển body này. Nhập text là đường dùng
thử hiện có; không có STT/TTS riêng. Xem [ranh giới dictation](native-dictation-interop.md).

**Cloud:** một lần full MAIN launch sau trust đã dừng trước inference vì sandbox
Cloud che `/tmp/codex-daemon-1000` thành read-only mode `000`, trong khi Codex yêu
cầu `0700`. Đây không phải lỗi đăng nhập hay bằng chứng Fisch inference thất bại.
Không chmod/unmount hoặc tắt sandbox để chữa. Observer-only đã có kiểm thử thật,
nhưng không thay thế nghiệm thu full MAIN launch. Lỗi này cũng không chứng minh
máy local/Windows sẽ gặp cùng tình trạng.

**Chất lượng:** camera thật, mic tiếng Việt, Windows/GPU và mức vui/tự nhiên vẫn cần
người dùng đánh giá trên máy đích. Các lần thử đã có biểu đạt tạo hình thành công,
nhưng cũng có retain, lỗi payload và phản ứng lặp; CI xanh không phải UX đã đạt.
