# Thử Fisch Live trong 10–20 phút

Dành cho Dương trên Windows/PowerShell. Chuẩn bị và build lần đầu không tính vào
thời gian chơi; ghi riêng thời gian chờ chuẩn bị. Không cần bật camera để thử co-create; không có voice trong lượt này.
Đây là kịch bản nghiệm thu của người dùng, chưa phải bằng chứng đã thấy vui.

## Lấy bản mới và mở đúng phiên

Đóng phiên Fisch cũ do mình mở. Dùng nguyên [khối cập nhật an toàn](live-windows-qa.md#cập-nhật-checkout-đã-npm-link)
trong checkout Fisch thật: nó chỉ cho phép checkout sạch, ở gốc repo, nhánh `main`
đang theo `origin/main`, rồi `pull --ff-only`. Có thay đổi local, sai nhánh/upstream
hoặc lịch sử phân kỳ thì dừng; giữ nguyên dữ liệu, không tự stash/reset/clean.
Nếu muốn thử ngay khi checkout đang có thay đổi, giữ nguyên checkout đó và clone
vào một thư mục mới theo [Quick start](../README.md#quick-start); không tái dùng
thư mục chứa dữ liệu cũ. Sau đó chạy khối link/version/doctor ngay bên dưới. Lưu SHA Git vừa in ra:
`Fisch 0.1.0` có thể không đổi giữa nhiều commit, không đủ để nhận diện bản mới.

`doctor` trả khác 0 khi thiếu prerequisite bắt buộc thì xử lý mục MISSING trước.
Panel/Herdr là tùy chọn cho Live. Doctor không chứng nhận login, remote protocol,
linker MSVC hay model đã phản hồi; xem [kiểm tra prerequisite](live-windows-qa.md#chuẩn-bị-và-kiểm-tra-không-gọi-model).

Từ **project muốn Codex làm việc**, không phải bắt buộc checkout Fisch:

```powershell
Set-Location -LiteralPath 'C:\src\my-project' -ErrorAction Stop
fisch.cmd live
```

Lần đầu lệnh tự chuẩn bị dependency/build và face asset; không cần `fisch build`
trước. Download thất bại vẫn có thể tiếp tục camera-off. Nếu chỉ muốn thử chữ và
co-create, `fisch.cmd live --no-assets` bỏ tải vision trong lượt đó. Muốn thử tay,
dùng `fisch.cmd live --hands` ở lượt sau; không ghép `--hands --no-assets`.
Nếu shim chưa đúng, dùng [Node fallback](live-windows-qa.md#shim-path-và-lỗi-execution-policy),
vẫn giữ cwd là project. Không cần đổi ExecutionPolicy.

Live mở Native Codex/host riêng trong terminal hiện tại, dùng login có sẵn;
không hot-attach tiến trình Codex cũ. Browser không tự gửi nội dung bạn gõ ở
Cùng sáng tạo. Nếu clipboard không dùng được, chọn/chép request đang hiện rồi
tự dán vào terminal. Chỉ bắt đầu bấm giờ chơi sau khi Live mở xong.

## Kịch bản và điều cần nhìn

| Phút | Thao tác | Điều cần quan sát / khi chưa đạt |
| --- | --- | --- |
| 0–2 | Trong terminal Native Codex mới, chọn/bắt đầu phiên rồi nhập một câu của chính bạn. Mở **Agent và cách dùng** trên trang. | Gateway đã nối và Native đã chọn phiên là hai trạng thái riêng. Camera vẫn tắt. “Đã chọn phiên” chưa chứng minh model trả lời; câu trả lời thực và hoạt động tool mới là bằng chứng. Nếu vẫn chờ, kiểm tra terminal, không mở thêm controller. |
| 2–5 | Mở **Cùng sáng tạo**, nhập một ý tưởng của bạn, một dòng; mục tiêu tùy chọn. Bấm **Nguyên tác**, tự dán vào terminal và gửi. | “Đã chép; chưa gửi” đúng trước khi dán. Codex dùng `playground_state` rồi `playground_edit`; chỉ coi đã lưu khi tool trả `committed` và UI xác nhận lịch sử. Chỉ có text/ACK hoặc hạt tự chuyển động chưa đủ. |
| 5–8 | Chọn một thay đổi bạn thật sự muốn, dùng **Chỉnh ý tưởng**, dán/gửi; sau đó dùng **Hoàn tác** tương tự. | Hình có thay đổi liên quan tới ý định, lịch sử tăng sau commit; undo quay về bản đã lưu trước. Tạo hình cần giữ bản sắc qua các lượt. “Đã lưu” là lịch sử trong phiên, không đảm bảo mọi frame bị đóng băng. |
| 8–10 | Nếu bắt gặp trạng thái đang xử lý, bấm **Dừng biểu đạt** một lần, rồi nhờ Codex đọc lại state. | Không báo đã lưu mới nếu chưa hoàn tất. Nếu uncertain/recoveryRequired, đừng gửi lại request cũ tự động. Chỉ dùng **Phục hồi** khi đồng ý xóa lịch sử trong phiên, rồi tạo mới. Nếu không kịp ngắt, ghi “chưa thử”, không tính pass. |
| 10–15 | Chơi tự do theo tò mò của bạn: tạo, sửa, undo hoặc nói chuyện. Không cần theo kịch bản mẫu. | Bạn có muốn tiếp tục không? Hình có liên quan và có điều bất ngờ thú vị không? Ghi cả khoảnh khắc chán, hiểu nhầm hoặc phải vật lộn với copy/paste. Không chỉ chọn happy case để quay video. |
| Tùy chọn, tối đa 2 phút | Xem **Quan sát và phản ứng**. Chỉ bấm **Bật camera** nếu muốn; có thể từ chối quyền hoặc dùng **Tắt camera** bất kỳ lúc nào. | Camera opt-in và observer độc lập. Native có login không làm observer sẵn sàng. Observer chưa cấu hình/thiếu hoặc hết ngân sách thì giữ off; co-create vẫn thử được. Khi đã sẵn sàng, chỉ bật **Phản ứng theo camera** nếu đồng ý gửi typed observations tới provider riêng. Không kỳ vọng mỗi cử động đều tạo phản ứng. |
| 1–2 phút cuối | Bấm **Dừng toàn bộ**, xem mã thoát, rồi chạy lại `fisch.cmd live` nếu muốn kiểm tra restart. | Dừng thành công trả 0; Ctrl+C/abort trả 130; đóng trang giữ khác 0 vì có thể là browser lỗi. Lượt mới camera-off, ý tưởng/request/lịch sử cũ không tự phục hồi. Đừng coi mất lịch sử qua restart là lưu trữ bền. |

Nếu camera bị từ chối, thử tiếp phần chữ; không tìm cách bỏ qua quyền. Nếu ngân
sách observer hết hạn, không tăng limit, reset used hay gia hạn ledger để làm nút
sáng. Không tự bật ghi chẩn đoán hoặc xuất JSON; một bản ghi 60 giây cũng không
chứng minh trải nghiệm trọn phiên. Không chia sẻ token/URL pairing, prompt riêng,
key hoặc ledger khi báo lỗi. Hướng dẫn observer: [provider và ngân sách](reactive-provider.md).

## Ghi lại kết quả ngắn

Ghi SHA Git, thời gian chờ setup, phút thực chơi, số tạo/remix/undo đã commit, thao tác chưa thử,
trạng thái observer/camera, một điều thích và một điều khó chịu. Tự chấm
“muốn chơi tiếp?” và mức vui 1–5; không có điểm chuẩn đã được người dùng xác nhận.
Dừng nếu thấy khó chịu; **Dừng toàn bộ** luôn nằm trong vùng nhìn thấy.

## Bằng chứng và phần chưa kiểm thử

Mốc nền `30a0993`: Windows CI đã chạy npm-link trong prefix tạm, gọi `fisch.cmd`
help/version và Node fallback từ workspace có khoảng trắng, build và Cargo
check/test. Đây không phải Windows Native Live với login, camera hay GPU thật.
Linux/Cloud đã chạy launcher → Native fixture → MCP/gateway/browser thật, các
ca ngắt/restart/token mới/xóa draft và journal; không gọi model hoặc media thật.

Bản hướng dẫn này bổ sung Windows CI kiểm tra chính khối Git cập nhật bằng repo
giả lập: fast-forward và các trường hợp phải dừng mà không ghi đè local.
Các lệnh help/version/doctor được chạy lại trên Cloud. `live` và các lựa chọn
được kiểm tra qua CLI dispatch và route fixture; chưa chạy model/camera/mic thật
hoặc máy cá nhân. Ý nghĩa hình, độ chính xác tracking và vui 10–20 phút vẫn cần
Dương thử. Xem [hợp đồng co-create](playground-session.md) khi cần chẩn đoán sâu.
