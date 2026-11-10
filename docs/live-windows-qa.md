# Fisch Live trên Windows: chạy, cập nhật và nghiệm thu

Audit ban đầu ngày 09/11/2026 trên source `56dbffc`; phần khởi chạy/restart đã
được cập nhật qua PR #93 và #97. Tài liệu cho PowerShell/native Windows;
không phải bằng chứng đã chạy trên máy Windows của Dương. Phiên audit chỉ đọc
source, contract tests và help của Codex trên Linux; không mở camera/mic hoặc gọi model.

Thử nhanh: [kịch bản kiểm tra buổi sáng](live-morning-check.md).

## Chuẩn bị và kiểm tra không gọi model

Cần Git, Node.js 22.12+ cùng npm, Rust stable với linker/MSVC và Windows SDK,
Edge/Chrome hoặc Chromium của Playwright, và Codex CLI đã đăng nhập.
Browser Live dùng gateway `--no-default-features`; không cần cài toàn bộ Tauri UI
chỉ để chạy browser. Native Tauri có bộ prerequisite riêng.
[Rust hướng dẫn MSVC](https://rust-lang.github.io/rustup/installation/windows-msvc.html)
chỉ rõ workload Desktop Development with C++ và Windows SDK cần cho linker.

```powershell
node --version
npm.cmd --version
git --version
rustc --version
cargo --version
where.exe codex
codex --version
codex --help | Select-String -Pattern '--remote', '--remote-auth-token-env'
codex app-server --help | Select-String -Pattern '--stdio'
codex login status
```

Đây là kiểm tra version/help/login, không gửi một turn inference. Nếu PowerShell
chặn `codex.ps1`, xem mục shim bên dưới và dùng `codex.cmd` nếu nó có trong kết quả
`where.exe codex`; bản cài native có thể cung cấp `codex.exe`. Help local đã đối chiếu
với CLI `0.167.0-alpha.4`; phiên bản khác cần có các capability trên. Help tồn tại
không chứng nhận toàn bộ protocol tương thích hay model hoạt động.

`fisch doctor` hiện kiểm tra Node, `cargo --version`, `codex --version`, đường dẫn
browser và dependency. Nó **chưa** xác minh login, remote/app-server, linker MSVC
hoặc quyền GPU/camera. Cargo hiện diện chưa đủ để build thành công; lỗi `link.exe`
hoặc SDK cần xử lý theo hướng dẫn Rust, không cài lại Fisch để chữa linker.

## Cập nhật checkout đã npm-link

Đóng phiên Fisch do mình khởi chạy trước khi cập nhật. Khối sau giả định checkout
đang ở `main`, không có thay đổi local. Thay đường dẫn bằng checkout thật:
Chưa có checkout thì dùng [Quick start](../README.md#quick-start) để clone và link lần đầu.

<!-- live-update-commands:start -->
```powershell
$FischCheckout = 'C:\src\agent-expression-runtime'
Set-Location -LiteralPath $FischCheckout -ErrorAction Stop
$Root = git rev-parse --show-toplevel
if ($LASTEXITCODE -ne 0) { throw 'Không đọc được Git root; dừng cập nhật.' }
if ([IO.Path]::GetFullPath($Root) -ne (Get-Location).Path) { throw 'Chọn đúng thư mục gốc checkout Fisch.' }
$Changes = git status --porcelain --untracked-files=all
if ($LASTEXITCODE -ne 0) { throw 'Không kiểm tra được thay đổi local; dừng cập nhật.' }
if ($Changes) { throw 'Giữ lại thay đổi local trước khi cập nhật; không tự stash/reset.' }
$Branch = git symbolic-ref --quiet --short HEAD
if ($LASTEXITCODE -ne 0 -or $Branch -ne 'main') { throw 'Cần checkout main có sẵn; không tự đổi branch.' }
$Upstream = git rev-parse --abbrev-ref --symbolic-full-name '@{u}'
if ($LASTEXITCODE -ne 0 -or $Upstream -ne 'origin/main') { throw 'Kiểm tra upstream; không tự sửa cấu hình Git.' }
git pull --ff-only
if ($LASTEXITCODE -ne 0) { throw 'Chưa fast-forward được; giữ nguyên checkout để kiểm tra.' }
git rev-parse --short HEAD
if ($LASTEXITCODE -ne 0) { throw 'Không đọc được commit vừa cập nhật.' }
```
<!-- live-update-commands:end -->

Chỉ sau khi khối trên hoàn tất mới link và kiểm tra CLI:

```powershell
npm.cmd link
if ($LASTEXITCODE -ne 0) { throw 'npm link chưa thành công; dùng node/bin fallback bên dưới.' }
node .\bin\fisch.mjs --version
node .\bin\fisch.mjs doctor
```

`npm link` tạo liên kết global tới checkout và entry point trong `package.json`;
cập nhật source ở đúng checkout thường không cần uninstall/reinstall CLI. Chạy lại
link khi đổi vị trí checkout hoặc nghi shim trỏ sai. Đây là thao tác link chủ động;
launcher không tự cài global tool hay thay cấu hình Codex. Xem
[npm link](https://docs.npmjs.com/cli/v11/commands/npm-link/).

Sau đó chuyển sang **project muốn Codex làm việc** rồi chạy:

```powershell
Set-Location 'C:\src\my-project'
fisch.cmd live
```

Lần đầu Live tự chuẩn bị dependency locked, gateway và frontend; lần sau dùng
cache khi nội dung không đổi. Không cần chạy `fisch build` mỗi lần. `--hands`
chuẩn bị thêm asset tay; `--no-assets` bỏ tải asset trong lượt đó, không bật media.

## Shim, PATH và lỗi execution policy

```powershell
Get-Command fisch -All
where.exe fisch
npm.cmd prefix -g
```

Windows đặt executable global trực tiếp trong npm prefix; prefix cần nằm trên
PATH của terminal. [Tài liệu npm folders](https://docs.npmjs.com/cli/v11/configuring-npm/folders/)
giải thích vị trí này. Mở terminal mới sau khi cài tool/PATH; không đoán prefix cố định.

Nếu `fisch.ps1` hoặc `npm.ps1` bị chặn, dùng `fisch.cmd`/`npm.cmd` khi có sẵn.
Nếu shim thiếu hoặc trỏ sai, gọi entry point qua Node, vẫn giữ cwd là project:

```powershell
$FischCheckout = 'C:\src\agent-expression-runtime'
Set-Location 'C:\src\my-project'
node (Join-Path $FischCheckout 'bin\fisch.mjs') live --no-assets
```

Đường dẫn tường minh chọn đúng executable theo
[PowerShell command precedence](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_command_precedence).
Không cần đổi ExecutionPolicy, sửa trust hoặc cấp quyền global để thử fallback này.
Nếu chính Node/tool bị policy quản trị chặn, giữ nguyên policy và ghi lại mã lỗi.

## Phiên nào được nối và cách dừng

`fisch live` tạo Native Codex UI và app-server do phiên Live sở hữu, dùng login hiện
có và workspace đang gọi lệnh. Nó không hot-attach một tiến trình Codex đang chạy
hay tự nối lại thread cũ. Muốn dùng lịch sử có sẵn, chọn thread bằng chức năng Codex
trong UI mới; việc resume còn phải kiểm tra trên bản CLI thực tế. Thread cũ/agent
khác không bị thay thế. `fisch run` và các CLI terminal `express`/`cancel` đã được bỏ;
`npm start` trong checkout cũng mở Live. Xem [chuyển đổi từ panel](multiplexer.md)
về adapter Herdr tùy chọn và cách gỡ hook cũ.

Thoát Codex, đóng cửa sổ body, Ctrl+C ở launcher, hoặc Dừng toàn bộ để kết thúc
phiên sở hữu gateway/browser/relay. Dừng biểu đạt chỉ hủy biểu đạt, không đóng
Codex. Windows cleanup dùng `taskkill /PID <owned-pid> /T /F`, không kill theo tên
mọi `node.exe`/`codex.exe`. Khởi chạy lại sinh token/session mới; không tái sử dụng
pairing URL hay replay thao tác chưa chắc đã hoàn tất. Nút Dừng toàn bộ trả mã 0
sau khi cleanup thành công; abort/Ctrl+C trả 130. Đóng trang vẫn khác 0 vì chưa
phân biệt được đóng chủ động với browser lỗi. Nếu báo setup đang chạy,
kiểm tra phiên sở hữu trước; không xóa lock của tiến trình còn sống.

## Camera và observer là hai lựa chọn riêng

Camera khởi đầu tắt. Chuẩn bị/tải model không cấp consent; chỉ bật camera và tay
khi muốn bằng điều khiển browser. Native Codex có login không đồng nghĩa observer
có provider. Observer tự động mặc định off, dùng Responses data-only tách khỏi
coding thread; typed observation có thể rời máy khi đã cấu hình và bật phản ứng.

Cấu hình observer cần endpoint/model đã chọn, credential riêng nếu provider yêu
cầu, và `FISCH_REACTIVE_BUDGET` là **đường dẫn tuyệt đối tới ledger được duyệt đang
có**. Không lấy key từ Codex login, tạo key ví dụ, ghi đè ledger, đặt lại used=0,
tăng limit hoặc gia hạn deadline chỉ để làm nút sáng. Ledger thiếu/hết hạn/hết
lượt phải để provider unavailable. Xem [hợp đồng provider](reactive-provider.md).
Không in toàn bộ environment, auth file hoặc ledger vào log/screenshot hỗ trợ.
Chỉ báo tên capability và reason code đã lọc. Native child loại bỏ các biến
`FISCH_REACTIVE_*`; cấu hình observer phải có trong environment của **launcher**.

## Ma trận QA và giới hạn bằng chứng

| Tình huống | Kết quả cần quan sát | Bằng chứng hiện có / phần còn thiếu |
| --- | --- | --- |
| CLI qua link, đường dẫn có khoảng trắng | Đúng checkout, không cần đổi cwd sang thư mục cài | Contract linked-checkout; CI mới kiểm tra npm-link/help/version trong đường dẫn có khoảng trắng, không chạy Live Windows |
| Update fast-forward, source/lock đổi | Build cache bị invalid đúng, lỗi không được stamp ready | `live-setup.test.mjs`; update trên máy Windows thật chưa thử |
| Thiếu remote/app-server hoặc login | Chẩn đoán đúng capability; không nói doctor đã xác nhận | Help Linux đã đọc; Windows CLI/version thật pending |
| MSVC/SDK thiếu | Cargo build báo prerequisite, không nhầm lỗi npm link | Windows CI build/check Rust; máy sạch thiếu SDK pending |
| Launch từ project khác checkout | Codex dùng cwd project, asset từ checkout | `live-launcher`/`live-terminal` contracts và scripted route Linux |
| Agent cũ đang chạy | Live tạo host riêng; không đóng agent không sở hữu | Source/contract; hai phiên Windows tương tác thật pending |
| Camera deny/off, restart | Không tự bật lại; input chữ vẫn hoạt động | Browser synthetic/permission contracts; thiết bị Windows thật pending |
| Ctrl+C/đóng browser/Stop rồi chạy lại | Đóng tài nguyên sở hữu, không còn gateway cũ, token mới | Linux route/cleanup; Windows process-tree/end-to-end pending |
| Observer chưa cấu hình/ledger hết hạn | Off/unavailable, không gọi provider hoặc tự tạo ledger | Provider/budget pure tests; Windows cấu hình thực pending |

Workflow Windows CI chạy npm build cùng Cargo test/check và smoke npm-link
trong prefix tạm: gọi shim fisch.cmd help/version từ workspace có khoảng trắng,
kiểm tra fallback Node rồi unlink. Smoke không đổi ExecutionPolicy hoặc PATH.
Nó không chạy toàn bộ Native Codex UI, camera thật hay GPU
của người dùng. Lượt Linux chọn lọc trong audit này: 50/50 test qua ở sáu file CLI,
launcher, setup, terminal, reactive-provider và model-budget; không gọi model/media.
Các test launcher-route dùng Native/app-server **fixture có kịch
bản**, MCP/gateway/browser thật trên Linux: không phải nghiệm thu model thật hoặc
trải nghiệm vui 10–20 phút của Dương. Audit này không truy cập máy cá nhân.

## Mã kết thúc Live

Nguyên nhân dừng đã quan sát đầu tiên được giữ lại: nút **Dừng toàn bộ** trả 0;
abort từ launcher, SIGINT hoặc SIGTERM trả 130. Mã thoát tự nhiên của Native
client được giữ nguyên. Gateway/app-server, broker hoặc đánh giá trang bị lỗi
phải kết thúc khác 0. Mỗi lần cleanup dùng chung một promise: chờ toàn bộ tài
nguyên sở hữu, kể cả khi một bước lỗi. Lỗi chính giữ ưu tiên; nếu chỉ cleanup
lỗi thì trả lỗi cố định `live_cleanup_failed`, không in lỗi phụ hay lý do abort.
Nếu cleanup child lỗi mà child không phát sự kiện exit, host vẫn báo lỗi thay
vì chờ vô hạn; kết quả lỗi không chứng nhận process đã được hệ điều hành đóng.

Sự kiện page-close/pagehide không chứng minh người dùng chủ động đóng cửa sổ
thay vì browser bị lỗi, nên giữ mã khác 0. Dùng nút **Dừng toàn bộ** để báo dừng
chủ động thành công. Đây là contract lifecycle; Windows UI/process-tree thực
vẫn pending như ma trận trên.
