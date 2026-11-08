# Fisch Live POC

Fisch Live là trang web local gồm camera debug và cơ thể hạt WebGL, dùng cùng Codex CLI trong Herdr. Bạn trò chuyện trong terminal; Codex đọc quan sát có kiểu bằng MCP và tự chọn cách biểu đạt bằng DSL. Camera và phản xạ local không chờ model.

## Khởi chạy trên máy Windows đã chuẩn bị

Trong một shell của Herdr, chạy đúng một lệnh:

```sh
fisch live
```

Lệnh tự chuẩn bị asset/build, bật gateway, mở browser và tab **Fisch Live** với Codex + MCP cấu hình tạm thời. Không cần mở Codex trước, chọn pane ID hay truyền tham số. Workspace lấy từ shell đang gọi; khi không có pane trong environment thì dùng pane Herdr đang focus. Phiên Codex cũ nếu có giữ nguyên. Login hiện có được dùng lại; không cần API key mới. Không có planner phụ trong Live.

Trên máy này `fisch` đã có sẵn trên PATH. Với checkout mới, chạy `npm link` một lần sau các bước chuẩn bị bên dưới; sau đó luôn dùng `fisch live`. `fisch run` vẫn mở bản trong panel. Tùy chọn `--agent` chỉ dành cho debug/chọn workspace nguồn tường minh, không cần trong luồng thường ngày.

Launcher mở Edge với trang Live và camera mặc định **tắt**. Chọn **Bật camera** để xử lý tại máy. Quan sát video/landmark ở bên trái, cơ thể ở bên phải. Tiếp tục gõ vào Codex trong tab Fisch Live. MCP có thể hỏi quyền tool lần đầu; cấp quyền theo ý bạn. Launcher không sửa global Codex/Herdr config hoặc bypass hook trust.

Đóng cửa sổ browser, chọn **Dừng toàn bộ**, hoặc Ctrl+C tại launcher để dừng camera/gateway/renderer. Codex và phiên cũ vẫn chạy; tool Live không còn hoạt động sau khi gateway dừng. Chạy lại Live tạo pairing token mới.

## Chuẩn bị checkout mới

Cần Node 22.12+, npm, Cargo/Rust stable, Windows build prerequisites cho gateway hiện có, Herdr và Codex CLI đã login. Trên máy triển khai POC các bước này đã được tự động chạy:

```sh
npm ci
cargo build --locked --manifest-path src-tauri/Cargo.toml
node scripts/prepare-live-assets.mjs
```

Asset preparation lấy model Face Landmarker phiên bản cố định, kiểm tra SHA-256 và copy WASM của package đã pin. Asset nằm trong `public/live-assets/` (ignored), được phục vụ từ localhost; inference không tải video/ảnh lên CDN. Lần đầu tải model cần mạng. Build frontend bằng `npm run build` có cả `index.html` và `live.html`. Launcher tạo build mới và phục vụ bằng preview local để thay đổi code khi làm việc không tự reset camera qua HMR; đây không phải production web hosting công khai.

## Những gì có thể thử

1. Bật camera, di chuyển trong khung: cơ thể orient local theo vị trí. Arrival/departure chỉ thành sự kiện sau khoảng 1 giây ổn định; đổi hướng đầu sau khoảng 700 ms. Độ trễ debounce khác độ trễ render sau sự kiện.
2. Hỏi Codex một câu bình thường. Chỉ dẫn MCP yêu cầu `observe` đầu lượt; agent tự chọn `express` khi hữu ích. Có thể yêu cầu minh họa một khái niệm mới bằng các part hình học. Không có bảng câu hỏi → hình hoặc suy anatomy từ tên part.
3. Hỏi về quan sát hiện tại: agent chỉ được dùng trường world state thật sự hỗ trợ. Smile là hệ số hình học, hướng đầu không phải ánh nhìn, mouthMoving không phải phát hiện giọng nói. Camera tắt/lỗi/stale phải được coi là chưa biết.
4. Thử **Giảm chuyển động**, **Tắt chuyển động**, **Dừng biểu đạt**; các điều khiển dùng được bằng bàn phím. Debug JSON nằm trong vùng mở rộng, không được đọc ra 10 lần/giây bằng live region.
5. Yêu cầu `look` để kiểm thử thị giác: chỉ có ảnh tổng hợp hình tròn/mã số, có indicator và reason. Không dùng tool này để xem mặt thật của bạn.
6. Tắt camera giữa phiên; Codex tiếp tục dùng được và dữ liệu khuôn mặt trở thành unknown.

Không có TTS hoặc STT riêng. `/voice` tiếng Việt chưa được nghiệm thu bằng giọng nói người dùng; nhập chữ là fallback đã thống nhất.

## Quyền riêng tư của POC này

Camera thật chỉ xử lý trong browser, không ghi hình, không thu mic và không lưu screenshot chứa camera. Chỉ world state có kiểu được gửi qua gateway cho Codex. `look` bị giới hạn **synthetic-only** cả ở tool contract và gateway/browser implementation. Ảnh tổng hợp có thể được Codex/provider nhận; ảnh camera thật không có đường upload được bật trong bản này. CSP trên cả trang và Worker chỉ cho phép kết nối loopback, chặn cả endpoint logging có trong SDK MediaPipe đã pin. Cài asset qua Node là bước tải vào; camera inference không cần kết nối ngoài máy.

Token đi trong environment, HTTP Authorization và message WebSocket đầu tiên, không nằm trong URL, command line, Git hay file cấu hình. Không xuất credential từ environment khi debug. Các artifact `.runtime/` là local/ignored; evidence trong Git chỉ gồm metadata đã lọc, không có ảnh mặt hoặc payload model/private prompt.

## Delegate thị giác và khả năng phục hồi

Live ưu tiên vision GPU. Một số probe trên máy AMD này kết thúc video track sau vài giây; probe camera thô vẫn ổn định, và các lượt GPU sau cũng có thể chạy ổn. Vì vậy không kết luận đây là lỗi driver phổ quát. Nếu video track của lượt GPU kết thúc bất ngờ, Live thử lại đúng một lần bằng CPU; UI hiển thị delegate đang dùng. Tắt camera bằng nút hoặc dừng phiên hủy cả recovery timer, không tự bật lại.

Để chọn CPU từ đầu khi cần:

```powershell
$env:FISCH_VISION_DELEGATE = 'CPU'
node bin/fisch.mjs live --agent <pane-id>
```

Probe ngắn ghi nhận khoảng 8–10 mẫu thị giác/giây trên máy này, chưa đạt mục tiêu 24 FPS. Render FPS được đo riêng; không dùng FPS camera danh nghĩa 30 để thay cho throughput inference. Số đo soak cuối cùng được ghi riêng trong validation.

## Hợp đồng Live

World state v1 có sessionId, sequence, timestamp, camera status, quality dựa trên độ ổn định tracking, pose/expression hoặc null, turn và summary. Gateway giữ snapshot mới nhất; event history tối đa 64 bản ghi, cursor độc lập và gap detection. Quan sát quá 1.5 giây thành stale. Hook/context read không tiêu thụ cursor của agent.

Live extension được bọc trong program v1:

```json
{
  "body": {
    "type": "live",
    "program": null,
    "configuration": {
      "controls": [
        {"type":"orient","id":"attention","part":"body","toward":{"entity":"user"},"maxDeg":20,"smoothMs":100}
      ],
      "poses": [],
      "lifetimeMs": 60000
    }
  },
  "policy": "replace"
}
```

`program` là AST legacy như assemble/parallel/sequence hoặc null để giữ hình. Config được kiểm tra trước admission. `bind` chỉ vào part được khai báo; `orient` xoay body/part theo user; `reflex` hiện chỉ chạy action pose transform có giới hạn. Agent có thể tạo geometry bất kỳ trong assemble; reflex chưa hỗ trợ program geometry/macro lồng nhau. `poses` là gesture transform tường minh.

Ưu tiên theo từng channel: nền < reflex < bind/orient < pose agent. Legacy posture ghi cùng root channel cũng thắng lớp local. Ghi trùng trong cùng lớp bị từ chối; additive chưa hỗ trợ. Config có lease tối đa 5 phút, tối đa 16 binding/orient và 16 reflex, không recursion. Thiếu/stale signal về neutral; part mất thì binding bị bỏ. Cancel giữ macro đã commit; phiên mới reset registry. Xem [schema quan sát](../src/contracts/live.schema.json), [schema điều khiển](../src/contracts/live-control.schema.json) và [hướng dẫn agent](../integrations/live-instructions.md).

## Hooks và nhịp chữ

Runner của Fisch đã cài/trust có thể giao lifecycle qua private IPC của pane Live. Launcher không tự sửa/cấp trust; `/hooks` vẫn thuộc quyền người dùng. Module context hook có deadline 180 ms, nhưng native context injection chưa được xác nhận. Đường được hỗ trợ hiện tại là **observe-first qua MCP**.

Nhịp chữ Herdr chỉ là proxy thử nghiệm, mặc định tắt. Để thử:

```powershell
$env:FISCH_LIVE_RHYTHM = 'proxy'
node bin/fisch.mjs live --agent <pane-id>
```

Proxy lọc một số spinner/tool/redraw, đo phần text assistant tăng và decay về 0 sau 600 ms. TUI hoặc phiên bản Codex khác có thể làm sai phân loại; không tuyên bố lip-sync, token stream chính xác hay latency <250 ms trên mọi lượt. Trạng thái UI ghi rõ off/experimental. Không chuyển raw terminal text sang browser/model để làm ngữ cảnh camera.

## Kiểm thử và bằng chứng

```sh
npx vitest run --maxWorkers=1
npm run build
npm run check:architecture
cargo test --locked --manifest-path src-tauri/Cargo.toml
node scripts/live-acceptance.mjs
# Có tiêu hao quota Codex, chỉ ảnh tổng hợp:
node scripts/live-preflight.mjs
# Bật camera thật, local-only; 60 giây warm-up + 30 phút:
node scripts/live-soak.mjs --camera-local
```

Chạy các bài browser tuần tự trên máy này. Preflight Codex native đã gọi observe/look và đọc đúng mã số ngẫu nhiên trong ảnh; phiên Herdr thật đã gọi observe/express/look. Nghiệm thu gateway/MCP bao phủ macro sau cancel, reload, invalid config, ảnh tổng hợp và cooldown. [Evidence chức năng](evidence/live-acceptance.json) ghi rõ cold/warm và headless software rendering; không dùng nó làm benchmark GPU native.

Regression cuối: 221 JS tests / 41 files, 16 Rust tests pass. [Soak native 30 phút](evidence/live-soak.json) giữ camera liên tục, không có egress ngoài máy; private memory sau GC tăng 37,3 MB. FPS mẫu 58–60, frame p95 17,1–29,4 ms; chưa chứng nhận ngưỡng 20 ms xuyên suốt. Xem kết quả và giới hạn ở [validation](validation.md). Human recognition 6/10, quan sát đúng 8/10, độ phân tâm và tiếng Việt qua mic chưa có nghiệm thu người dùng. Không tự coi compiler pass là bằng chứng biểu cảm dễ hiểu.

Xem [plan và ledger commit](fisch-live-plan.md) để biết các quyết định, giới hạn và thay đổi so với PRD.
