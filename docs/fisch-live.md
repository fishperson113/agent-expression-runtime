# Fisch Live POC

Fisch Live là trang web local gồm camera debug và cơ thể hạt WebGL, dùng cùng Codex CLI trong terminal thông thường; Herdr là adapter tùy chọn. Bạn trò chuyện trong terminal hoặc panel hội thoại của cùng phiên Native Codex; Codex đọc quan sát có kiểu bằng MCP và tự chọn cách biểu đạt bằng DSL. Camera và phản xạ local không chờ model.

## Hội thoại cùng agent hiện có

Panel text dùng đường Native mặc định; adapter `--agent` legacy tiếp tục nhập
trong terminal. Trong ô nhập, **Enter** xuống dòng; bấm **Gửi** hoặc
**Ctrl+Enter** / **⌘+Enter** để gửi tới thread Native đang được chọn. Shortcut không
bỏ qua trạng thái bận, kết quả chưa rõ hoặc giới hạn input; giữ phím hay đang gõ
IME không tự gửi thêm lượt.
Nó hiển thị user/assistant text thực của turn đang theo dõi, không biến log công cụ
hoặc reasoning thành lời trả lời. Panel chỉ giữ bản sao trong bộ nhớ phiên, không ghi
vào local storage hoặc recording; Native Codex giữ lịch sử theo cấu hình hiện có.
Giới hạn mỗi lần gửi là 16000 byte UTF-8.

**Dừng trả lời** yêu cầu ngắt đúng turn hiện tại; ACK chưa chứng minh turn đã kết
thúc. Nếu kết quả gửi chưa rõ, không tự gửi lại: kiểm tra terminal hoặc khởi chạy
lại Live. Chuyển thread thành công xóa lịch sử và bản nháp ở panel; chuyển thất bại
giữ bản nháp. Reload yêu cầu khởi chạy lại Live để nối lại, không tự replay nội dung.
**Dừng toàn bộ** xóa panel và đóng tài nguyên thuộc phiên.

Camera mặc định tắt và cần bạn bật riêng. Observer camera không nhận nội dung chat
hoặc code; phản ứng tự động không được thêm vào thread coding. Agent Native có thể
chủ động dùng expression tools theo ngữ cảnh hội thoại/công việc của chính nó.

## Khởi chạy trong terminal đã chuẩn bị

Chạy đúng một lệnh:

```sh
fisch live
```

Lệnh chuẩn bị build/gateway, mở browser và Codex trong terminal hiện tại với MCP tạm thời. Workspace là thư mục đang gọi; không cần provider/pane ID hoặc mở Codex trước. Trong Herdr hoặc multiplexer khác, Codex chạy ngay trong pane khởi chạy Live; chỉ `--agent <pane>` mới dùng adapter cũ. Phiên cũ không bị thay thế. Login hiện có được dùng lại; không có planner phụ. Cấu hình global không bị viết lại. Nếu asset thị giác chưa tải được, Live vẫn dùng được camera-off; chuẩn bị asset trước khi bật camera.

Sau `npm link`, lệnh `fisch` có trên PATH. Với checkout mới, chạy bước link một lần sau chuẩn bị; sau đó luôn dùng `fisch live`. `fisch run` và các CLI `fisch express`/`fisch cancel` đã được bỏ; `npm start` trong checkout cũng khởi chạy Live. Xem [hướng dẫn chuyển từ panel](multiplexer.md). Tùy chọn `--agent` chỉ dành cho debug/chọn workspace nguồn tường minh, không cần trong luồng thường ngày.

Launcher mở Edge/Chromium với trang Live và camera mặc định **tắt**. Chọn **Bật camera** để xử lý tại máy. Fisch ở panel trái; camera và hội thoại ở panel phải. Trong terminal/pane Live, chọn hoặc bắt đầu phiên Native Codex trước; sau đó có thể gõ ở panel hội thoại hoặc tiếp tục trong terminal. Nhật ký hoạt động là dữ liệu kỹ thuật riêng, không phải tin nhắn. MCP có thể hỏi quyền tool lần đầu; cấp quyền theo ý bạn. Launcher không sửa global Codex/Herdr config hoặc bypass hook trust.

Đóng cửa sổ browser, chọn **Dừng toàn bộ**, hoặc Ctrl+C tại launcher để dừng camera/gateway/renderer. Đường terminal đóng cả Codex do chính phiên Live sở hữu; các agent không liên quan giữ nguyên. Browser, gateway và agent có đường cleanup độc lập. Herdr giữ vòng đời pane riêng; tool Live không còn dùng được sau khi gateway dừng. Chạy lại Live tạo pairing token mới.

## Chuẩn bị checkout mới

Cần Node 22.12+, npm, Rust stable cùng compiler nền tảng, browser và Codex CLI đã login. Đường terminal kiểm tra với CLI 0.167.0-alpha.4; bản khác cần xác minh tương thích. Gateway browser không cần GTK/WebKit/Tauri UI:

```sh
npm link
fisch live
# Optional hand model, still off until enabled in the browser:
fisch live --hands
# Skip vision downloads for this launch:
fisch live --no-assets
```

Live prepares locked checkout-local npm dependencies before importing them, builds the standalone Rust gateway without Tauri UI dependencies, and prepares the static frontend. First launch can download npm packages, Cargo crates and the pinned face model; progress identifies each step. It never installs Rust, browsers, Codex, global hooks or security settings. An installed Edge/Chrome is reused; alternatively install browser binaries once with `npx playwright install chromium`. Concurrent setup is rejected with a retry hint; Ctrl+C cancels downloads and owned build processes. Missing prerequisites produce a retryable error; use `fisch doctor` to inspect them.

Successful builds are cached in `.runtime/live-setup/` by input and output content. Source, lockfile, asset or output changes invalidate the relevant build; unchanged launches skip compilation. A failed build is not marked ready. Assets are resolved from the installed checkout even when launched in another project. Model downloads come from `storage.googleapis.com`, are bounded to 20 MB and verified against pinned SHA-256 hashes before atomic replacement. Cached models are reused; corrupt models are retried. Network/model failure keeps Live usable camera-off, with a retry hint. `--no-assets` skips preparation, not existing local assets. `FISCH_PREPARE_HANDS=1` remains supported; the CLI flag is the simpler equivalent.

Downloading assets never enables camera or hand tracking. Use the browser controls when wanted; real images remain local. Hand observations are input for agent-authored expressions, not a fixed gesture-to-animation mapping. The static bundle avoids HMR resetting camera state. This remains localhost-only POC hosting.

## Những gì có thể thử

1. Bật camera, di chuyển trong khung: cơ thể orient local theo vị trí. Arrival/departure chỉ thành sự kiện sau khoảng 1 giây ổn định; đổi hướng đầu sau khoảng 700 ms. Độ trễ debounce khác độ trễ render sau sự kiện.
2. Hỏi Codex một câu bình thường. Chỉ dẫn MCP yêu cầu `observe` đầu lượt; agent được yêu cầu chủ động chọn biểu đạt phù hợp bằng `express` cùng câu trả lời thường; mức độ nhất quán vẫn cần holdout thật. Có thể yêu cầu minh họa một khái niệm mới bằng các part hình học. Không có bảng câu hỏi → hình hoặc suy anatomy từ tên part.
3. Hỏi về quan sát hiện tại: agent chỉ được dùng trường world state thật sự hỗ trợ. Smile là hệ số hình học, hướng đầu không phải ánh nhìn, mouthMoving không phải phát hiện giọng nói. Camera tắt/lỗi/stale phải được coi là chưa biết.
4. Thử **Giảm chuyển động**, **Tắt chuyển động**, **Dừng biểu đạt**; các điều khiển dùng được bằng bàn phím. Debug JSON nằm trong vùng mở rộng, không được đọc ra 10 lần/giây bằng live region.
5. Yêu cầu `look` để kiểm thử thị giác: chỉ có ảnh tổng hợp hình tròn/mã số, có indicator và reason. Không dùng tool này để xem mặt thật của bạn.
6. Tắt camera giữa phiên; Codex tiếp tục dùng được và dữ liệu khuôn mặt trở thành unknown.

Không có TTS hoặc STT riêng. `/voice` tiếng Việt chưa được nghiệm thu bằng giọng nói người dùng; nhập chữ là fallback đã thống nhất.

## Quyền riêng tư của POC này

Camera thật chỉ xử lý trong browser, không ghi hình, không thu mic và không lưu screenshot chứa camera. MCP `observe` có thể trả world state có kiểu cho Codex khi tool được gọi. Phản ứng camera tự động dùng bộ quyết định riêng, mặc định tắt; khi được cấu hình và bạn bật điều khiển, một cửa sổ quan sát có kiểu được gửi tới provider đã chọn, không được thêm vào thread coding của Codex. Cửa sổ này có thể gồm tọa độ tay có cấu trúc khi theo dõi tay được bật; không gửi ảnh hoặc âm thanh. `look` bị giới hạn **synthetic-only** cả ở tool contract và gateway/browser implementation. Ảnh tổng hợp có thể được Codex/provider nhận; ảnh camera thật không có đường upload được bật trong bản này. CSP trên cả trang và Worker chỉ cho phép kết nối loopback, chặn cả endpoint logging có trong SDK MediaPipe đã pin. Cài asset qua Node là bước tải vào; camera inference không cần kết nối ngoài máy.

Token đi trong environment, HTTP Authorization và message WebSocket đầu tiên, không nằm trong URL, command line, Git hay file cấu hình. Không xuất credential từ environment khi debug. Các artifact `.runtime/` là local/ignored; evidence trong Git chỉ gồm metadata đã lọc, không có ảnh mặt hoặc payload model/private prompt.

## Delegate thị giác và khả năng phục hồi

Live ưu tiên vision GPU. Một số probe trong lượt Windows/AMD lịch sử kết thúc video track sau vài giây; probe camera thô vẫn ổn định, và các lượt GPU sau cũng có thể chạy ổn. Vì vậy không kết luận đây là lỗi driver phổ quát. Nếu video track của lượt GPU kết thúc bất ngờ, Live thử lại đúng một lần bằng CPU; UI hiển thị delegate đang dùng. Tắt camera bằng nút hoặc dừng phiên hủy cả recovery timer, không tự bật lại.

Nếu GPU báo rõ SwiftShader (dựng hình bằng phần mềm), Live chọn CPU cho thị giác ngay từ đầu; probe Cloud tổng hợp đo CPU nhanh hơn đường GPU software. UI vẫn ghi delegate thực tế. GPU native hoặc không đọc được metadata vẫn giữ lựa chọn GPU và cơ chế fallback hiện có. Đây không phải chứng nhận đạt 24 Hz hay accuracy người thật.

Bằng chứng Cloud mới dùng camera giả không có khuôn mặt, nguồn danh nghĩa 30 FPS, CPU vision và 2.000 hạt: median inference 14,61 → 22,91 Hz, median render 34,06 → 30,87 FPS. Hai soak 30 phút đều pass ổn định/bộ nhớ; đây là đánh đổi tài nguyên trên GPU phần mềm, chưa đạt các mục tiêu 24 Hz / 50 FPS. Xem [số đo đầy đủ](validation.md#vision-pacing-and-reflex-envelope--2026-11-09).

Worker chỉ xử lý một frame mỗi lúc và bỏ backlog. Khi inference xong, Live lấy ngay frame mới nhất đã có từ callback video thay vì chờ callback sau; không xử lý lại cùng media timestamp. Reflex giữ đường cong pose và fade quyền điều khiển, bỏ lớp lọc giá trị trùng lặp. Probe camera-off mặc định cải thiện p95 226,9 → 168,8 ms, vẫn chưa đạt 150 ms; pose kiểm thử lớn hơn đạt 141,6 ms trong mẫu nhỏ, không thay cho nghiệm thu mặc định/native.

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

Đường terminal nối UI Codex đang có qua relay loopback có xác thực vào app-server stdio. Chỉ agent-message delta của thread/turn đang theo dõi tạo nhịp; tool/reasoning/spinner không tạo nhịp, và decay về 0 trong 600 ms. Developer instructions được bổ sung, không thay thế chính sách hiện có. Remote UI/WebSocket phụ thuộc phiên bản CLI và còn thử nghiệm; xem [tài liệu chính thức](https://learn.chatgpt.com/docs/app-server). Không tuyên bố lip-sync hoặc speech detection. Model thật đã trả lời qua TUI trên Cloud với cấu hình tạm thời untrusted/read-only; không đổi trust lưu bền. Xem [audit folder trust](codex-project-trust.md).

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
# Chỉ mô tả gate ngân sách, không mở browser hoặc gọi model:
node scripts/live-preflight.mjs --describe
# Có tiêu hao quota Codex; cần opt-in FISCH_RUN_MODEL_TESTS=1 và ledger gốc còn hạn:
node scripts/live-preflight.mjs
# Bật camera thật, local-only; 60 giây warm-up + 30 phút:
node scripts/live-soak.mjs --camera-local
```

Preflight dùng ledger hiện có tại `.runtime/live-overnight/model-budget.json`
trong checkout Fisch, cùng sổ với holdout. Không tự tạo ledger, đặt lại `used`,
sao chép fixture hay gia hạn deadline để chạy. Chỉ bật `FISCH_RUN_MODEL_TESTS=1`
sau khi ledger đã được đối soát/phê duyệt. Gate kiểm tra trước khi tạo fixture;
mỗi lần khởi động model được reserve một lượt ngay trước dispatch, giới hạn
120 lượt và deadline được kiểm tra lại dưới lock. Lỗi/timeout không tự retry
hoặc hoàn quota. `--describe` chỉ đọc metadata sổ, không xác nhận auth hay model
thực sự chạy được và không chứng minh một file là ledger được phê duyệt.

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

Holdout đóng băng 10 câu thường, chạy hai lượt bằng app-server. Chạy thật cần `FISCH_RUN_MODEL_TESTS=1` và budget JSON hợp lệ ở `.runtime/live-overnight/model-budget.json`; giữ nguyên deadline/counter khi resume. Mỗi turn reserve trước request, tối đa 120, không retry mù, không tự cấp interactive approval. Không xóa lock đang sống; khi crash đối chiếu counter và file `.writing-*` trước phục hồi. Cập nhật Cloud 09/11: sau khi đăng nhập lại chính thức, bộ 20 lượt cố định đã hoàn tất với 20 biểu đạt được nhận/applied/frame-changed và không có rejection trên bản sửa bàn giao controller (PR #35). Tổng đã dùng 51/120, deadline 09/11 06:17:35 UTC. Runner giữ tối đa bốn ảnh body-only mỗi lượt, chụp 150 ms sau tool completion và chỉ lưu mã lỗi có giới hạn. Xem [bằng chứng và giới hạn](validation.md#authenticated-cloud-model-verification--2026-11-09). Không coi frame change là điểm semantic: relevance, visual meaning, consistency và chấm người thật vẫn đang chờ.

Checklist local còn lại: mở `fisch live` từ terminal mới không Herdr; hội thoại thường/illustration/return/cancel; bật camera có chủ đích để đo >=24 Hz và accuracy >=8/10; thử motion-off, keyboard, Windows GPU và Herdr; soak native có GC với <100 MB retained growth; chấm blinded theme recognition >=6/10 và /voice tiếng Việt bằng người thật. Máy chủ sở hữu đã tắt trong lượt Cloud; không có nghiệm thu mới nào cho các mục này.

Mẫu Cloud cuối cho output proxy: khoảng 46 ms tới state replying, 66 ms tới frame
submit tiếp theo và 127 ms về zero sau delta cuối, trong một câu trả lời ngắn thật.
Đây không phải lip-sync/pixel-presentation hoặc chứng nhận mọi lượt. Probe local
reflex tới centroid >2 px đo 172,7 ms có overhead readback; target first-motion
<150 ms chưa được chứng nhận. Xem [bằng chứng latency](evidence/cloud-latency-probes.json).

## Compact filming stage and optional hand perception

Use **Toàn màn hình** for the particle stage and **Thoát toàn màn hình** to leave.
Motion reduction/off, expression cancellation and Stop remain reachable in fullscreen. Voice is outside this demo's
scope; no STT/TTS work or voice acceptance gate is included. Text conversation uses
the existing Codex agent, through its terminal or the Live conversation panel
after selecting a Native thread. No extra agent or model is started.

Prepare the optional local gesture model once with
`FISCH_PREPARE_HANDS=1 node scripts/prepare-live-assets.mjs` (PowerShell: set the
environment variable first). Enable **Cử chỉ tay cho Codex · thử nghiệm** while
camera is off, then start camera explicitly. Stop camera to change that choice.
Face-only mode does not initialize the gesture recognizer. A missing gesture
model reports hand failure while face tracking remains available.

Perception recognizes seven static poses: open palm, closed fist, pointing up,
thumb up, thumb down, victory, I-love-you. The first sufficiently confident hand
wins (up to two detected hands); 0.75 confidence, 250 ms stable evidence, 500 ms
maximum sample gap. Only a stable, bounded pose description is appended to the
typed observation's summary for Codex to read on its next turn. Structured hand
landmarks also have a validated observation contract; an explicitly enabled,
configured observer may receive that structured window. Raw images stay local.
Losing the pose clears its description. The optional diagnostic recorder below
can briefly retain structured coordinates after separate opt-in.
Cancel, session changes and camera stop clear perception state.

There is **no gesture-to-effect table**, intent classifier or phrase-to-geometry
mapping. Perception reports a pose; the semantic agent chooses any illustration
or expression through the existing declarative tools. Hand detection never starts
inference on a timer or auto-executes a semantic effect. Existing local face/
attention controls remain distinct. The sword_formation reference is inspiration
for interaction and staging only. Owner examples of swords/fire are long-term
semantic use cases, not commands hard-coded in this demo. Do not present a
synthetic fixture as a real agent decision.

Model provenance checked 2026-11-09: Google-hosted Gesture Recognizer float16 v1,
SHA-256 `97952348cf6a6a4915c2ea1496b4b37ebabc50cbbf80571435643c455f2b0482`.
[Official task/model download](https://developers.google.com/edge/mediapipe/solutions/vision/gesture_recognizer),
[Apache-2.0 project license](https://github.com/google-ai-edge/mediapipe/blob/master/LICENSE)
and [model asset notice-license declaration](https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/model_maker/models/gesture_recognizer/BUILD)
record the SDK/model resource provenance; downloaded assets retain upstream terms
separately from Fisch MIT code. [Google model card](https://storage.googleapis.com/mediapipe-assets/gesture_recognizer/model_card_hand_gesture_classification_with_faireness_2022.pdf)
limits it to static poses, not waving, whole-body tracking, sign-language
translation or intent/emotion recognition. Lighting/motion blur can reduce
accuracy; extra inference consumes local CPU. No 24 Hz or physical-hand accuracy
claim. Synthetic tests cover confidence, stability, expiry and all seven labels.

Cloud functional evidence: both local models initialize and return zero faces/
hands on a painted blank synthetic frame, handsFailed=false. Fullscreen works;
zero page errors, external requests or active camera stream. Semantic responses
to real hand observations remain unverified because Cloud model auth is blocked.
No real camera/mic or owner-PC access. No voice gate is pending for this scope.

## Local causal diagnostic recording

Under **Quan sát và chẩn đoán**, **Ghi 60 giây** explicitly starts an in-memory
debug capture. It is off by default and does not start camera, observer inference
or networking. It stores quantitative observations without summaries, eligible
events and their observation references, frozen request references, authorization,
decision outcome metadata, effective revocations and existing execution/frame
proxies. It excludes raw media, chat/activity text, prompts and provider output.
Coordinates and IDs still require care when sharing an exported file.

Capture stops on its record/byte quota and marks the preserved prefix incomplete.
It never evicts causal parents to make a truncated suffix look complete. Starting
mid-session may reference pre-capture parents; those gaps are marked rather than
backfilling observations captured before opt-in. **Dừng ghi** retains the prefix
until its original 60-second expiry; **Xóa bản ghi**, full stop, page close and
backgrounding clear it. Expiry is enforced on recorder access and the page's
periodic tick; suspended browser execution cannot guarantee an exact deletion
instant. Nothing is automatically written to disk or uploaded.

**Xuất JSON** downloads the current bounded snapshot only when clicked. That copy
is user-managed and does not inherit the in-memory expiry. A new capture replaces
the previous one. Developer automation can use `fischLive.startRecording()`,
`stopRecording()`, `clearRecording()` and `recordingSnapshot()`; recording cannot
restart after full stop.

The versioned manifest separates wall-clock observation/event timestamps from
monotonic request deadlines and execution times, retaining clock anchors. Unknown
build hashes remain unknown. This is a causal debug journal, not a complete
deterministic replay bundle, particle trajectory or camera-to-photon measurement.


## Reactive call workspace (2026-11-09)

The 2:1 call layout puts a large Fisch panel on the left and your smaller opt-in
local camera plus actual agent activity together on the right. The resting particle body is a fish-inspired
face, not a copy of the reference photo. The bounded log shows observed events,
turns and tool lifecycle, never private model thoughts or raw tool arguments.

Ordinary `fisch live` now runs Codex through the official app-server relay in the
launching terminal, including a Herdr, tmux or other multiplexer pane. It no longer
automatically creates a separate Herdr pane. Start it in a free shell pane; existing
agent sessions are left alone. The old `fisch run` panel launcher has been removed;
`npm start` now launches Live.
Explicit `fisch live --agent <pane>` retains the legacy Herdr adapter; its camera
reflexes work, but agent-triggered camera reactions are unavailable there and the
control stays disabled. No keystrokes are injected into an unrelated agent.

Camera starts off. Automatic camera reactions additionally require a separately
configured data-only provider and an existing approved budget ledger; otherwise
the control stays unavailable. See [provider setup and privacy](reactive-provider.md).
After explicit browser opt-in, stable typed geometric events can produce a frozen
observation window for that provider. Observation summaries are stripped; typed
coordinates, including structured hand observations when available, may remain.
No image or audio is sent. This path never adds camera events, model decisions or
`toolOutput` messages to the selected Native coding thread. Explicit native MCP
`observe` calls remain available and are a separate path.

Typed hand reactions use this same isolated provider after explicit hand-tracking
and reaction opt-in. The versioned event gate and semantic read-sets preserve
hand context; the agent still authors the effect. See [hand events](hand-event-gate.md)
and [synthetic opportunity diagnostics](reactive-opportunities.md) for scope and measurements.

Events coalesce for 750ms after local debounce, expire after five seconds, and
start at most once every 15 seconds/four times per minute. The causal request has
its own five-second deadline and consume-once authorization. Unchanging input and
idle timers do not start inference. A separate 30-second provider watchdog aborts
only the provider request and marks its transport uncertain; it does not extend
the request's execution authority or interrupt a Native Codex turn.

User input first awaits the browser's revocation barrier, then its original Native
RPC is forwarded unchanged. It does not wait for provider cancellation to settle.
A failed or timed-out browser evaluation permanently closes that broker's
controlled-input path and returns an explicit RPC error; late resolution never
silently forwards or replays the input. Stop, camera opt-out, Cancel, reload,
thread selection and new user intent invalidate pending reaction authority. An
unknown provider transport pauses automatic requests while ordinary Native input
remains independent, provided the browser barrier is healthy.

The separate provider receives no chat history or coding-thread identifier and
has no MCP/process/tool executor: requests use `tools=[]`, `tool_choice=none` and
a strict data-only decision schema. The browser causal host and shared compiler
still validate and admit any returned expression. Metadata-only provider receipts
are optional diagnostics, not evidence that an expression executed or that an
unknown request was cancelled. Deterministic tests and camera-off visual checks
do not establish real-camera accuracy, native-GPU performance, semantic quality
or enjoyment. The old Native `TurnStartParams.toolOutput` route is not wired into
current `fisch live`.


Historical verification of the superseded shared-thread increment: 28 focused
relay/reactivity tests passed. These results do not certify the current isolated
provider route.
Linux CI on `c53c335` passed 293 JavaScript tests (4 skipped), production build,
architecture and browser smoke. Windows browser-under-Vitest attempts timed out;
standalone camera-off screenshot rendering succeeded, so no full Windows-browser
pass is claimed. One real `gpt-6.1-sol` synthetic event turn started/completed and
successfully called `observe`, with zero approval requests or camera/audio/image
capture. It chose no `express` call: model-authored reaction animation remains an
open acceptance check. That historical checkpoint reported 97/120 model-test
uses; reconcile the current approved ledger before any new model call.

### Liên kết chuyển động bàn tay

Agent có thể tự khai báo `bind` với `hand.primary.position.x` hoặc
`hand.primary.position.y` qua DSL hiện có. Hai tín hiệu lấy cổ tay của track chính
đang nhìn thấy, ánh xạ tọa độ ảnh chưa mirror bằng `1 - 2 * coordinate`, giới hạn
trong `[-1,1]` như `user.position`. Bàn tay vẫn dùng được khi không thấy mặt.
Không có hiệu ứng cử chỉ mặc định: agent chọn part, gain, clamp và lease như các
binding khác; local compositor cập nhật tọa độ mới mà không đợi model.

Primary đang mất trong cửa sổ hysteresis, tracking lost/error, camera tắt hoặc
snapshot stale trả về signal chưa biết (`null`), để compositor chuyển nhẹ về
neutral theo cơ chế hiện có. LiveBody bỏ snapshot quá 1.500 ms trước compositing.
Track ID chỉ là liên tục hình học ngắn hạn, không phải nhận dạng người; qua giao
chéo/che khuất mơ hồ hệ thống có thể cấp ID mới.

`hands.entities[].confidence` là điểm phân loại handedness do MediaPipe trả về,
không phải độ tin cậy của landmark, track hay ý nghĩa cử chỉ. Không dùng điểm này
để suy ra rằng một chuyển động đã được hiểu chắc chắn.

Hình do người dùng hoặc tác vụ co-create gửi qua đường admission chung được giữ
sau khi animation kết thúc; bộ quyết định quan sát không được thay thế nó.
Trả về avatar chuẩn qua `return_to_face`, hoặc reset/cancel rõ ràng, mới nhường lại
quyền này. Gửi thêm một chuyển động ngắn không tự xóa lease của binding trước đó.
Các handler điều khiển trực tiếp phải gọi `LiveBody.prepareUserMutation()` trước
khi chờ I/O; `LiveBody.admit()` luôn kiểm tra lại hàng rào này trước compilation.
