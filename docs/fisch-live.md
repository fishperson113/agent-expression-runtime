# Fisch Live POC

Fisch Live là trang web local gồm camera debug và cơ thể hạt WebGL, dùng cùng Codex CLI trong terminal thông thường; Herdr là adapter tùy chọn. Bạn trò chuyện trong terminal; Codex đọc quan sát có kiểu bằng MCP và tự chọn cách biểu đạt bằng DSL. Camera và phản xạ local không chờ model.

## Khởi chạy trong terminal đã chuẩn bị

Chạy đúng một lệnh:

```sh
fisch live
```

Lệnh chuẩn bị build/gateway, mở browser và Codex trong terminal hiện tại với MCP tạm thời. Workspace là thư mục đang gọi; không cần provider/pane ID hoặc mở Codex trước. Nếu Herdr thật sự sẵn sàng, adapter mở tab Fisch Live riêng. Phiên cũ không bị thay thế. Login hiện có được dùng lại; không có planner phụ. Cấu hình global không bị viết lại. Nếu asset thị giác chưa tải được, Live vẫn dùng được camera-off; chuẩn bị asset trước khi bật camera.

Sau `npm link`, lệnh `fisch` có trên PATH. Với checkout mới, chạy bước link một lần sau chuẩn bị; sau đó luôn dùng `fisch live`. `fisch run` vẫn mở bản trong panel. Tùy chọn `--agent` chỉ dành cho debug/chọn workspace nguồn tường minh, không cần trong luồng thường ngày.

Launcher mở Edge/Chromium với trang Live và camera mặc định **tắt**. Chọn **Bật camera** để xử lý tại máy. Quan sát video/landmark ở bên trái, cơ thể ở bên phải. Tiếp tục gõ vào Codex trong terminal/pane Live. MCP có thể hỏi quyền tool lần đầu; cấp quyền theo ý bạn. Launcher không sửa global Codex/Herdr config hoặc bypass hook trust.

Đóng cửa sổ browser, chọn **Dừng toàn bộ**, hoặc Ctrl+C tại launcher để dừng camera/gateway/renderer. Đường terminal đóng cả Codex do chính phiên Live sở hữu; các agent không liên quan giữ nguyên. Browser, gateway và agent có đường cleanup độc lập. Herdr giữ vòng đời pane riêng; tool Live không còn dùng được sau khi gateway dừng. Chạy lại Live tạo pairing token mới.

## Chuẩn bị checkout mới

Cần Node 22.12+, npm, Rust stable cùng compiler nền tảng, browser và Codex CLI đã login. Đường terminal kiểm tra với CLI 0.167.0-alpha.4; bản khác cần xác minh tương thích. Gateway browser không cần GTK/WebKit/Tauri UI:

```sh
npm ci
npm link
fisch build
# Linux/macOS hoặc chưa có Chromium Playwright:
npx playwright install chromium
# Tùy chọn cho camera, cần mạng ở bước tải model:
node scripts/prepare-live-assets.mjs
```

Asset preparation lấy model Face Landmarker phiên bản cố định, kiểm tra SHA-256 và copy WASM của package đã pin. Asset nằm trong `public/live-assets/` (ignored), được phục vụ từ localhost; inference không tải video/ảnh lên CDN. Lần đầu tải model cần mạng. Build frontend bằng `npm run build` có cả `index.html` và `live.html`. Launcher tạo build mới và phục vụ bằng preview local để thay đổi code khi làm việc không tự reset camera qua HMR; đây không phải production web hosting công khai.

## Những gì có thể thử

1. Bật camera, di chuyển trong khung: cơ thể orient local theo vị trí. Arrival/departure chỉ thành sự kiện sau khoảng 1 giây ổn định; đổi hướng đầu sau khoảng 700 ms. Độ trễ debounce khác độ trễ render sau sự kiện.
2. Hỏi Codex một câu bình thường. Chỉ dẫn MCP yêu cầu `observe` đầu lượt; agent được yêu cầu chủ động chọn biểu đạt phù hợp bằng `express` cùng câu trả lời thường; mức độ nhất quán vẫn cần holdout thật. Có thể yêu cầu minh họa một khái niệm mới bằng các part hình học. Không có bảng câu hỏi → hình hoặc suy anatomy từ tên part.
3. Hỏi về quan sát hiện tại: agent chỉ được dùng trường world state thật sự hỗ trợ. Smile là hệ số hình học, hướng đầu không phải ánh nhìn, mouthMoving không phải phát hiện giọng nói. Camera tắt/lỗi/stale phải được coi là chưa biết.
4. Thử **Giảm chuyển động**, **Tắt chuyển động**, **Dừng biểu đạt**; các điều khiển dùng được bằng bàn phím. Debug JSON nằm trong vùng mở rộng, không được đọc ra 10 lần/giây bằng live region.
5. Yêu cầu `look` để kiểm thử thị giác: chỉ có ảnh tổng hợp hình tròn/mã số, có indicator và reason. Không dùng tool này để xem mặt thật của bạn.
6. Tắt camera giữa phiên; Codex tiếp tục dùng được và dữ liệu khuôn mặt trở thành unknown.

Không có TTS hoặc STT riêng. `/voice` tiếng Việt chưa được nghiệm thu bằng giọng nói người dùng; nhập chữ là fallback đã thống nhất.

## Quyền riêng tư của POC này

Camera thật chỉ xử lý trong browser, không ghi hình, không thu mic và không lưu screenshot chứa camera. Chỉ world state có kiểu được gửi qua gateway cho Codex. `look` bị giới hạn **synthetic-only** cả ở tool contract và gateway/browser implementation. Ảnh tổng hợp có thể được Codex/provider nhận; ảnh camera thật không có đường upload được bật trong bản này. CSP trên cả trang và Worker chỉ cho phép kết nối loopback, chặn cả endpoint logging có trong SDK MediaPipe đã pin. Cài asset qua Node là bước tải vào; camera inference không cần kết nối ngoài máy.

Token đi trong environment, HTTP Authorization và message WebSocket đầu tiên, không nằm trong URL, command line, Git hay file cấu hình. Không xuất credential từ environment khi debug. Các artifact `.runtime/` là local/ignored; evidence trong Git chỉ gồm metadata đã lọc, không có ảnh mặt hoặc payload model/private prompt.

## Delegate thị giác và khả năng phục hồi

Live ưu tiên vision GPU. Một số probe trong lượt Windows/AMD lịch sử kết thúc video track sau vài giây; probe camera thô vẫn ổn định, và các lượt GPU sau cũng có thể chạy ổn. Vì vậy không kết luận đây là lỗi driver phổ quát. Nếu video track của lượt GPU kết thúc bất ngờ, Live thử lại đúng một lần bằng CPU; UI hiển thị delegate đang dùng. Tắt camera bằng nút hoặc dừng phiên hủy cả recovery timer, không tự bật lại.

Để chọn CPU từ đầu khi cần:

```powershell
$env:FISCH_VISION_DELEGATE = 'CPU'
fisch live
```

Probe Windows lịch sử ghi nhận khoảng 8–10 mẫu thị giác/giây, chưa đạt mục tiêu 24 FPS. Render FPS được đo riêng; không dùng FPS camera danh nghĩa 30 để thay cho throughput inference. Số đo soak cuối cùng được ghi riêng trong validation.

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

Ưu tiên theo từng channel: nền < reflex < bind/orient < pose agent. Legacy posture ghi cùng root channel cũng thắng lớp local. Ghi trùng trong cùng lớp bị từ chối; additive chưa hỗ trợ. Config có lease tối đa 5 phút, tối đa 16 binding/orient và 16 reflex, không recursion. Thiếu/stale signal về neutral; part mất thì binding bị bỏ. Hết quyền điều khiển thì fade về lớp dưới, không giữ neutral write vĩnh viễn. UI cancel cách ly epoch cũ và thu hồi controller; gesture cũ không tự replay qua session change. Yêu cầu tường minh mới có thể nối lại và khôi phục macro đã commit. Xem [schema quan sát](../src/contracts/live.schema.json), [schema điều khiển](../src/contracts/live-control.schema.json) và [hướng dẫn agent](../integrations/live-instructions.md).

## Mặt nghỉ và biểu đạt

Mặt nghỉ được biên dịch từ curve/ellipsoid với role mắt, lông mày, miệng khai báo rõ. Local attention/working/replying/waiting không chờ model và không coi nhập chữ là microphone listening. Agent tự chọn pose bằng DSL hoặc dựng illustration rồi dùng `return_to_face`. Không có bảng prompt → hình, suy anatomy từ tên part bất kỳ, hoặc inference lúc idle. ACK admission không chứng minh ảnh có ý nghĩa.

## Hooks và nhịp chữ

Đường terminal nối UI Codex đang có qua relay loopback có xác thực vào app-server stdio. Chỉ agent-message delta của thread/turn đang theo dõi tạo nhịp; tool/reasoning/spinner không tạo nhịp, và decay về 0 trong 600 ms. Developer instructions được bổ sung, không thay thế chính sách hiện có. Remote UI/WebSocket phụ thuộc phiên bản CLI và còn thử nghiệm; xem [tài liệu chính thức](https://learn.chatgpt.com/docs/app-server). Không tuyên bố lip-sync hoặc speech detection. CLI/body đã khởi chạy trên Cloud, nhưng model reply vẫn bị policy mạng chặn.

Runner của Fisch đã cài/trust có thể giao lifecycle qua private IPC của pane Live. Launcher không tự sửa/cấp trust; `/hooks` vẫn thuộc quyền người dùng. Module context hook có deadline 180 ms, nhưng native context injection chưa được xác nhận. Đường được hỗ trợ hiện tại là **observe-first qua MCP**.

Nhịp chữ Herdr chỉ là proxy thử nghiệm, mặc định tắt. Để thử:

```powershell
$env:FISCH_LIVE_RHYTHM = 'proxy'
fisch live
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

Lượt native trước đây: 221 JS tests / 41 files, 16 Rust tests pass. [Soak native 30 phút](evidence/live-soak.json) giữ camera liên tục, không có egress ngoài máy; private memory sau GC tăng 37,3 MB. FPS mẫu 58–60, frame p95 17,1–29,4 ms; chưa chứng nhận ngưỡng 20 ms xuyên suốt. Kết quả lịch sử này không chứng nhận code Cloud mới. Xem [validation](validation.md) và [ledger Cloud](live-cloud-run.md). Human recognition 6/10, quan sát đúng 8/10, độ phân tâm và tiếng Việt qua mic chưa có nghiệm thu người dùng. Không tự coi compiler pass là bằng chứng biểu cảm dễ hiểu.

Xem [plan và ledger commit](fisch-live-plan.md) để biết các quyết định, giới hạn và thay đổi so với PRD.

## Chẩn đoán, fixture và holdout Cloud

Debug giữ tối đa 64 sự kiện theo turn/epoch/sequence: nhận, admission, scheduler applied, frame submission và hash geometry thay đổi. Hai mục cuối là proxy, không phải điểm content relevance hay chứng nhận mắt người. Không ghi prompt riêng tư, tool payload, credential hoặc ảnh camera.

```sh
# Gateway-only, không cần GTK/WebKit:
cargo test --locked --no-default-features --bin fisch-gateway --manifest-path src-tauri/Cargo.toml
# 60 giây warm-up + 30 phút; không mở thiết bị thật:
node scripts/live-soak.mjs --synthetic-camera
# Không gọi model:
node scripts/live-holdout.mjs --describe
```

Fixture có nhãn rõ và khóa nút mở camera. Nó đi qua observation aggregator nhưng không chạy Face Landmarker, nên không chứng minh 24 Hz inference hoặc accuracy người thật. Linux private memory dùng tổng Private_* trong smaps_rollup của các browser process; lỗi đọc được ghi unknown.

Holdout đóng băng 10 câu thường, chạy hai lượt bằng app-server. Chạy thật cần `FISCH_RUN_MODEL_TESTS=1` và budget JSON hợp lệ ở `.runtime/live-overnight/model-budget.json`; giữ nguyên deadline/counter khi resume. Mỗi turn reserve trước request, tối đa 120, không retry mù, không tự cấp interactive approval. Không xóa lock đang sống; khi crash đối chiếu counter và file `.writing-*` trước phục hồi. Lượt Cloud này dùng 2/120, chưa hoàn tất holdout thật vì chatgpt.com bị chặn. Không coi fixture là model pass. Điểm relevance, visual meaning và consistency còn chờ đánh giá thật.

Checklist local còn lại: mở `fisch live` từ terminal mới không Herdr; hội thoại thường/illustration/return/cancel; bật camera có chủ đích để đo >=24 Hz và accuracy >=8/10; thử motion-off, keyboard, Windows GPU và Herdr; soak native có GC với <100 MB retained growth; chấm blinded theme recognition >=6/10 và /voice tiếng Việt bằng người thật. Máy chủ sở hữu đã tắt trong lượt Cloud; không có nghiệm thu mới nào cho các mục này.
