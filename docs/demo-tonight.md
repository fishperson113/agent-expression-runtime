# Demo tối nay: Live trước, OLV tùy chọn

Luồng để trò chuyện và xem Fisch ngay là **Native Codex + panel text Live**.
OLV hiện là trial backend độc lập, chưa phải lựa chọn agent trong UI. Không cần
Python, OLV, camera hay observer để thử luồng chính. Chuẩn bị/build lần đầu không
tính vào 10–20 phút chơi.

## 1. Mở đúng checkout và đúng project trên Windows

Cập nhật checkout theo [khối cập nhật an toàn](live-windows-qa.md#cập-nhật-checkout-đã-npm-link).
Có thay đổi local thì giữ nguyên, dùng checkout mới; không reset/clean dữ liệu để
chạy demo. Khối dưới dùng Node entry point trực tiếp để tránh shim global trỏ
checkout cũ. Thay hai đường dẫn bằng thư mục thật:

```powershell
$FischCheckout = 'C:\src\agent-expression-runtime'
git -C $FischCheckout rev-parse --short HEAD
node (Join-Path $FischCheckout 'bin\fisch.mjs') --version
node (Join-Path $FischCheckout 'bin\fisch.mjs') doctor
if ($LASTEXITCODE -ne 0) { throw 'Xử lý prerequisite bắt buộc đang MISSING trước.' }
Set-Location -LiteralPath 'C:\src\my-project' -ErrorAction Stop
node (Join-Path $FischCheckout 'bin\fisch.mjs') live --no-assets
```

`doctor` chỉ kiểm tra prerequisite, không chứng nhận login/quota/protocol, MSVC
linker hoặc model đã trả lời. Dependencies local là tùy chọn ở bước doctor:
`live` tự cài dependency locked và build lại gateway/frontend khi source đổi.
`--no-assets` chỉ bỏ tải asset thị giác; cơ thể hạt và expression tools vẫn dùng
được. Không mở `dist/live.html` hoặc chỉ chạy Vite để thay thế launcher: UI tĩnh
không tự có Native binding. Không cần tự xóa `dist` hay chạy `fisch build` trước.
Windows cần Rust/MSVC/SDK và browser như [hướng dẫn Windows](live-windows-qa.md).

## 2. Thử hội thoại, biểu đạt và ngắt trong một phiên

Trong terminal Native vừa mở, chọn hoặc bắt đầu thread. Live không hot-attach một
Codex cũ; panel text chỉ sẵn sàng sau khi thread thật được chọn. Giữ camera tắt.

- Nhập một ý tưởng của chính bạn rồi bấm **Gửi** hoặc **Ctrl/⌘+Enter** trong ô nhập
  (Enter thường xuống dòng). Thử thêm hai lượt nối tiếp, trong
  đó lượt sau nhắc lại ý tưởng trước; xem agent có giữ đúng ngữ cảnh không.
- Nhờ agent dùng Fisch expression tools để biểu đạt ý tưởng đó, rồi đọc
  `expression_status`. Hoặc mở **Cùng sáng tạo**, chép request, tự dán vào panel
  text/terminal và gửi. Chỉ có lời trả lời/ACK chưa chứng minh biểu đạt đã áp dụng;
  xem cả trạng thái tool và hình thực tế.
- Khi đang trả lời, thử **Dừng trả lời**; chờ trạng thái xác nhận. **Dừng biểu đạt**
  chỉ hủy biểu đạt. Trong fullscreen, dùng **Thoát toàn màn hình**; Motion, Cancel
  và **Dừng toàn bộ** vẫn nằm trong vùng điều khiển.
- Thử đổi thread thành công: draft/transcript ở panel phải được xóa. Chuyển thất
  bại giữ draft. Gửi có kết quả chưa rõ thì kiểm tra terminal, không tự gửi lại.
- **Dừng toàn bộ** để đóng phiên. Reload cũng kết thúc phiên Live đang sở hữu;
  chạy lại lệnh để nối lại, camera vẫn tắt và panel không tự replay nội dung cũ.
  Đây không phải xóa lịch sử Native Codex đang được lưu theo cấu hình của nó.

Dành vài phút tự chơi thay vì chỉ quay happy case; ghi cả lúc ngắt không kịp,
hình không liên quan hoặc copy/paste gây khó chịu. Mức vui và hiểu ngữ cảnh thật
vẫn cần người dùng đánh giá. Kịch bản dài hơn: [10–20 phút](live-morning-check.md).

## 3. OLV: trial scripted riêng trên Linux, không phải chat UI mới

Nếu muốn kiểm chứng nhánh tái dùng OSS, chạy [recipe trial OLV](olv-adapter.md#automated-trial-with-an-owned-gateway)
trong checkout thử nghiệm trên **Linux x86_64, Python 3.12**. Nó cần Python venv,
upstream đúng SHA và dependency fixture riêng; chưa xác nhận lock này cho Windows.
Không cài toàn bộ voice/model stack. Recipe tự sở hữu gateway/token và chạy
headless, không yêu cầu lấy pairing token từ phiên Native đang dùng.

Có thể kiểm tra upstream conversation/MCP thật, RGB/motion được script sẵn,
interrupt, late RPC bị chặn và renderer evidence. Không có model thật, persona,
voice, webcam hay mic trong trial này. Hai màu fixture không chứng minh OLV hiểu
hội thoại hoặc tự chọn cảm xúc. Chữ `complete` không thay thế bằng chứng renderer.
Trial không gắn OLV vào panel Live và không thay agent Native của luồng chính.

## Kiến trúc và bằng chứng hiện có

Fisch giữ kiến trúc của mình: [Node bridge của phiên Native](../integrations/live-codex-transport.mjs)
và [broker có giới hạn](../integrations/live-reactive-broker.mjs) điều phối request;
expression vẫn đi qua MCP/gateway và epoch của Fisch. [Adapter OLV](../integrations/olv/adapter.py)
chỉ nối orchestration/MCP upstream vào capability này, bổ sung guard generation và
`expectedEpoch` để kết quả cũ không chiếm lại quyền. Không dựng thêm chat platform,
provider hoặc vòng voice. Backend upstream được tái dùng theo [MIT tại SHA đã pin](https://github.com/Open-LLM-VTuber/Open-LLM-VTuber/blob/992309c0aa19845960228f880013d4685fde93b5/LICENSE);
không sao chép frontend, persona, Live2D hay model assets. [Chi tiết adapter](olv-adapter.md)
phân biệt code upstream thật với ServiceContext/scripted provider chỉ dùng cho fixture.

QA độc lập trên main `8deb667` trong Cloud ngày 10/11/2026:

| Lượt kiểm tra | Kết quả | Giới hạn |
| --- | --- | --- |
| CLI | 16/16 pass | Contract/dispatch, không phải model đã trả lời |
| Native host/UI, gateway bắt buộc | 9/9 pass, 44,29 giây | Native/app-server fixture; không inference thật |
| Python lifecycle | 13/13 pass | Deterministic transport/runtime doubles |
| OLV adapter/render thực | 2/2 pass, không skip, 10,27 giây | Upstream thật + provider scripted + Rust/software WebGL |

Artifact OLV ghi camera off, 0 model calls, GL error 0; raster đích có 4373 pixel
cyan và 2514 pixel orange. SDK write cũ bị chặn `expected_epoch_mismatch`; context
fixture ghi `prior_items` 0 rồi 2 khi recovery. Đây là bằng chứng đường biểu đạt,
ngắt và dữ liệu fixture được truyền tiếp, không chứng minh model hiểu hội thoại.
Các nhóm test có thể lồng nhau; không cộng các hàng thành số ca độc lập.

Gate trước demo sau baseline trên: [#131](https://github.com/fishperson113/agent-expression-runtime/pull/131)
đã merge tại `884ed870`. QA độc lập trên đúng head `5cc38b9` đạt **67/67 test,
5 file, không skip**: cho phép thử Stop lại sau lỗi chắc chắn chưa gửi, và chặn
lỗi cancellation cũ ghi đè owner mới. Đây không phải kết luận chỉ từ CI xanh.
Finding delayed callback của adapter máy vẫn khác với nút Stop-current của người
dùng: AIRI #129 và XState #130 giữ research-only, không bật production; lỗi startup
CI riêng của #130 chưa rõ nguyên nhân. [Evidence theo scope](evidence/demo-tonight-qa.json)
phân biệt baseline, release gate và các giới hạn này.

Profile OLV được QA là Linux x86_64/Python 3.12, `mcp==1.30.0`, `pip check` pass.
Toàn bộ recipe clone upstream mới → venv mới → cài lock/`pip check` → build gateway
→ required trial đã chạy đúng codeblock trên Linux Cloud, với Node/Rust/Playwright
đã chuẩn bị: 2/2 test pass, không skip, 9,57 giây cho lượt test (không phải tổng
thời gian cài đặt). [Evidence đã lọc](evidence/demo-tonight-qa.json) ghi SHA codeblock.
Windows Native thực, chất lượng model, tracking và trải nghiệm vui vẫn chưa được
nghiệm thu ở đây.

Preflight Cloud cùng mốc: Codex `0.167.0-alpha.4` có các flag remote/app-server;
`codex login status` trả 0, xác nhận có account auth, không xác nhận inference,
refresh token hay quota. Không lưu email/token thô. Doctor trên PATH mặc định báo
thiếu Cargo và trả 1; dùng đúng Rust environment sẵn có thì trả 0. Đây không phải
kết quả chạy trên Windows.

Sáu flag `FISCH_REACTIVE_*` của lượt Cloud đều unset: observer trả
`disabled_by_config`, không fetch, reserve hoặc write. Không có đường dẫn
`FISCH_REACTIVE_BUDGET` đang cấu hình; không tìm ledger lịch sử và không kết luận
đã hết ngân sách. Native account auth không thay thế credential observer. Không
cần tạo/reset ledger để thử panel Native cơ bản trên máy của bạn. Tại main
`2c5169c`, QA Cloud có gọi model thật vẫn bị chặn bởi cả approved budget path chưa
được cung cấp và quyền truy cập app-server; không retry, bypass hoặc reset ledger
để vượt qua hai gate này. Đây là giới hạn của lượt QA Cloud, không cấm bạn chủ động
chạy Live bằng tài khoản Native trên máy riêng. OLV ServiceContext/provider thật
cũng chưa được đối soát; fixture đã pass không thay thế các bước đó. Kịch bản
[10–20 phút](live-morning-check.md) vẫn là hướng dẫn để người dùng thử, không phải
bằng chứng đã chạy soak hoặc đạt trải nghiệm vui.
