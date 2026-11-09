# Fisch Live POC

Fisch Live là trang web local gồm camera debug và cơ thể hạt WebGL, dùng cùng Codex CLI trong terminal thông thường; Herdr là adapter tùy chọn. Bạn trò chuyện trong terminal; Codex đọc quan sát có kiểu bằng MCP và tự chọn cách biểu đạt bằng DSL. Camera và phản xạ local không chờ model.

## Khởi chạy trong terminal đã chuẩn bị

Chạy đúng một lệnh:

```sh
fisch live
```

Lệnh chuẩn bị build/gateway, mở browser và Codex trong terminal hiện tại với MCP tạm thời. Workspace là thư mục đang gọi; không cần provider/pane ID hoặc mở Codex trước. Trong Herdr hoặc multiplexer khác, Codex chạy ngay trong pane khởi chạy Live; chỉ `--agent <pane>` mới dùng adapter cũ. Phiên cũ không bị thay thế. Login hiện có được dùng lại; không có planner phụ. Cấu hình global không bị viết lại. Nếu asset thị giác chưa tải được, Live vẫn dùng được camera-off; chuẩn bị asset trước khi bật camera.

Sau `npm link`, lệnh `fisch` có trên PATH. Với checkout mới, chạy bước link một lần sau chuẩn bị; sau đó luôn dùng `fisch live`. `fisch run` vẫn mở bản trong panel. Tùy chọn `--agent` chỉ dành cho debug/chọn workspace nguồn tường minh, không cần trong luồng thường ngày.

Launcher mở Edge/Chromium với trang Live và camera mặc định **tắt**. Chọn **Bật camera** để xử lý tại máy. Fisch ở panel trái; camera và nhật ký hoạt động agent ở panel phải. Tiếp tục gõ vào Codex trong terminal/pane Live. MCP có thể hỏi quyền tool lần đầu; cấp quyền theo ý bạn. Launcher không sửa global Codex/Herdr config hoặc bypass hook trust.

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

Camera thật chỉ xử lý trong browser, không ghi hình, không thu mic và không lưu screenshot chứa camera. Chỉ world state có kiểu được gửi qua gateway cho Codex. `look` bị giới hạn **synthetic-only** cả ở tool contract và gateway/browser implementation. Ảnh tổng hợp có thể được Codex/provider nhận; ảnh camera thật không có đường upload được bật trong bản này. CSP trên cả trang và Worker chỉ cho phép kết nối loopback, chặn cả endpoint logging có trong SDK MediaPipe đã pin. Cài asset qua Node là bước tải vào; camera inference không cần kết nối ngoài máy.

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

Holdout đóng băng 10 câu thường, chạy hai lượt bằng app-server. Chạy thật cần `FISCH_RUN_MODEL_TESTS=1` và budget JSON hợp lệ ở `.runtime/live-overnight/model-budget.json`; giữ nguyên deadline/counter khi resume. Mỗi turn reserve trước request, tối đa 120, không retry mù, không tự cấp interactive approval. Không xóa lock đang sống; khi crash đối chiếu counter và file `.writing-*` trước phục hồi. Cập nhật Cloud 09/11: sau khi đăng nhập lại chính thức, bộ 20 lượt cố định đã hoàn tất với 20 biểu đạt được nhận/applied/frame-changed và không có rejection trên bản sửa bàn giao controller (PR #35). Tổng đã dùng 51/120, deadline 09/11 06:17:35 UTC. Runner giữ tối đa bốn ảnh body-only mỗi lượt, chụp 150 ms sau tool completion và chỉ lưu mã lỗi có giới hạn. Xem [bằng chứng và giới hạn](validation.md#authenticated-cloud-model-verification--2026-11-09). Không coi frame change là điểm semantic: relevance, visual meaning, consistency và chấm người thật vẫn đang chờ.

Checklist local còn lại: mở `fisch live` từ terminal mới không Herdr; hội thoại thường/illustration/return/cancel; bật camera có chủ đích để đo >=24 Hz và accuracy >=8/10; thử motion-off, keyboard, Windows GPU và Herdr; soak native có GC với <100 MB retained growth; chấm blinded theme recognition >=6/10 và /voice tiếng Việt bằng người thật. Máy chủ sở hữu đã tắt trong lượt Cloud; không có nghiệm thu mới nào cho các mục này.

Mẫu Cloud cuối cho output proxy: khoảng 46 ms tới state replying, 66 ms tới frame
submit tiếp theo và 127 ms về zero sau delta cuối, trong một câu trả lời ngắn thật.
Đây không phải lip-sync/pixel-presentation hoặc chứng nhận mọi lượt. Probe local
reflex tới centroid >2 px đo 172,7 ms có overhead readback; target first-motion
<150 ms chưa được chứng nhận. Xem [bằng chứng latency](evidence/cloud-latency-probes.json).

## Compact filming stage and optional hand perception

Use **Toàn màn hình** for the particle stage; Escape restores the controls. Motion
reduction/off remain available before entering. Voice is outside this demo's
scope; no STT/TTS work or voice acceptance gate is included. Conversation still
runs in the existing Codex terminal.

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
typed observation's summary for Codex to read on its next turn; images and hand
landmarks remain local and unpersisted. Losing the pose clears its description.
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


## Reactive call workspace (2026-11-09)

The 2:1 call layout puts a large Fisch panel on the left and your smaller opt-in
local camera plus actual agent activity together on the right. The resting particle body is a fish-inspired
face, not a copy of the reference photo. The bounded log shows observed events,
turns and tool lifecycle, never private model thoughts or raw tool arguments.

Ordinary `fisch live` now runs Codex through the official app-server relay in the
launching terminal, including a Herdr, tmux or other multiplexer pane. It no longer
automatically creates a separate Herdr pane. Start it in a free shell pane; existing
agent sessions are left alone. `fisch run` keeps its existing panel workflow.
Explicit `fisch live --agent <pane>` retains the legacy Herdr adapter; its camera
reflexes work, but agent-triggered camera reactions are unavailable there and the
control stays disabled. No keystrokes are injected into an unrelated agent.

Camera starts off. Reactions also default off and remain unavailable without an
explicit, separately configured data-only observer and an existing approved budget
ledger. Native Codex conversation keeps its user-initiated turns and MCP tools;
camera events never create Native turns or `toolOutput` notices. The retired
camera-polling API always reports disabled/stopped.

When opted in, the observer receives a bounded typed window: up to four observations
and eight events, including structured hand landmarks when available, with summaries
removed. It receives no camera images, audio, chat/code history, tools or MCP access.
Its fixed Responses request uses `tools:[]`, `tool_choice:none` and `store:false`;
the host validates declarative JSON decisions before admission. Instructions alone
are not the capability boundary. See [configuration and privacy](reactive-provider.md).

Eligible semantic events coalesce for a finite 750 ms, expire after five seconds,
and dispatch at most four times per rolling minute with a 15-second cooldown.
Compatible new frames remain valid; changed presence, track dependencies, user
intent or a new semantic event revoke old authority. The browser semantic deadline
is five seconds from request creation. The separate 30-second transport watchdog
limits a hanging provider; it does not extend the action lease. Slow-loop liveness
under changing scenes needs its own evaluation, not a claim inferred from local FPS.

User input crosses the browser intent/revocation barrier before Native forwarding.
It does not wait for provider cancellation. Successful correlated Native turn ACKs
establish steering ownership even before the started notification. Failed or stale
ACKs cannot revive a turn. Barrier/browser failure returns an explicit error rather
than silently replaying input. Unknown observer transport pauses new observer work;
stop, camera opt-out, Cancel, reload and thread changes revoke old apply rights.

Deterministic and synthetic browser evidence distinguishes decision admission,
scheduler application and frame-change proxies. A proxy does not prove semantic
relevance, physical camera latency, native-GPU performance or human enjoyment.
A short diagnostic capture is also not evidence of an entire 20-minute session.

### Historical shared-thread experiment (retired)

At `c53c335`, the earlier camera path used standalone `toolOutput`; 28 focused
relay/reactivity tests and Linux CI passed 293 JavaScript tests (four skipped).
Windows browser-under-Vitest attempts timed out; standalone camera-off rendering
succeeded. One real synthetic `gpt-6.1-sol` event turn returned `observe`, without
`express`. That result proves neither the new isolated observer nor expressive
animation quality. Its recorded 97/120 budget snapshot is historical, not a current
remaining allowance. Reconcile the approved cumulative ledger before any real call;
never reset it or infer provider access from a Codex login. The original unrelated
output's provenance remains unresolved, and PR #51 stays draft.

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
