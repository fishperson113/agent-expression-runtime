# Fisch — Báo cáo Related Work và Cơ sở Thiết kế

**Ngày tổng hợp:** 07/11/2026. **Phạm vi:** expressive motion, social robotics, behavioral animation và cách chúng liên hệ với particle expression runtime của Fisch.

## 1. Mục đích và cách đọc

Báo cáo trả lời câu hỏi: **Fisch đang xây dựng trên những ý tưởng nào, đã áp dụng đến đâu, và còn điều gì phải tự kiểm chứng?** Đây là tài liệu lưu dấu quyết định thiết kế, không phải một systematic literature review hay tuyên bố về tính mới học thuật.

Mốc implementation được đối chiếu: `9863ba3` (07/11/2026), gồm continuous presence, generated performance, adaptive Braille và prepared idle scenes. Các phép đo bên dưới giữ nguyên phạm vi lịch sử; không phải lần kiểm định mới. Phần đề xuất trước implementation đã được bỏ khỏi bản hướng dẫn hiện hành để tránh nhầm với trạng thái HEAD.

Ba loại liên hệ được phân biệt trong báo cáo:

- **Ảnh hưởng đến thiết kế:** ý tưởng đã được dùng để định hướng bản nâng cấp trong phiên làm việc này.
- **Tham chiếu trải nghiệm:** sản phẩm giúp mô tả cảm giác mong muốn; chưa chứng minh Fisch dùng cùng thuật toán.
- **Đối chiếu bổ sung:** tài liệu liên quan được tìm khi tổng hợp báo cáo; không mặc định đó là nguồn đã được đọc khi code cũ được viết.

Việc đọc nguồn chủ yếu ở mức abstract, trang chính thức và phần mô tả implementation được dẫn. Chưa rà soát toàn bộ PDF, supplementary materials hay đánh giá có hệ thống các video sản phẩm. Tham khảo ý tưởng khác với sao chép code; đợt nâng cấp này không đưa source code hay model weights của các project tham khảo vào Fisch.

## 2. Fisch đang giải quyết bài toán gì?

Fisch là một cơ thể bằng particle cho coding agent. Nó nhận sự kiện tương tác, cho model tạo hình học và hành vi khai báo, rồi thực thi chúng bằng runtime local. Mục tiêu là truyền đạt sự chú ý, sắc thái và trạng thái tương tác qua chuyển động, bao gồm khi đang làm việc hoặc idle.

Những ràng buộc riêng của project:

- Hình có thể đổi thành mặt, tay, sinh vật hoặc cấu trúc trừu tượng; không giới hạn ở một avatar có bộ xương cố định.
- Môi trường sử dụng chính hiện tại là pane Herdr với colored Braille; chuyển động nhỏ nhìn được trong WebGL có thể biến mất ở đây.
- Model chọn cách diễn nhưng không sinh executable code. Runtime kiểm tra dữ liệu, giữ giới hạn và bảo đảm cơ chế hủy/thay thế.
- Chuyển động local tiếp tục giữa các sự kiện; không cần gọi model mỗi frame hoặc mỗi lần idle.
- Biểu cảm là hành vi trình diễn. Nó không chứng minh agent có cảm xúc, ý thức hay trạng thái tâm lý tương ứng.

Xem [README](../README.md), [hình học particle](swarm-geometry.md), [planner](expression-planner.md) và [kiến trúc](architecture.md). Các bản ghi validation cũ được ghi rõ là lịch sử; mô tả hành vi hiện hành được đối chiếu theo mốc implementation trên.

## 3. Bản đồ các dòng related work

| Dòng nghiên cứu / sản phẩm | Nguồn tiêu biểu | Điều liên quan đến Fisch | Loại liên hệ |
| --- | --- | --- | --- |
| Behavioral animation của đàn hạt | Reynolds / Boids [R1] | Chuyển động tập thể từ tương tác local | Đối chiếu nền tảng của cơ chế có sẵn |
| Expressive motion với ít bậc tự do | Knight / Computational Laban Effort [R2] | Mô tả chất lượng chuyển động thay vì chỉ vị trí | Đối chiếu bổ sung cho Effort có sẵn |
| Ý nghĩa của timing | Zhou và cộng sự [R3] | Nhịp, tăng tốc, giữ và hồi phục là tín hiệu | Ảnh hưởng đến thiết kế |
| Pipeline animation cho robot | Ribeiro & Paiva / Nutty [R4] | Ghép nhiều nguồn chuyển động dưới giới hạn chung | Ảnh hưởng đến thiết kế |
| Idle motion trong tương tác | Casso và cộng sự / Buddy [R5] | Idle cũng truyền đạt trạng thái; tốc độ cần hợp ngữ cảnh | Ảnh hưởng đến thiết kế |
| Expressive và functional movement | Apple / ELEGNT [R6] | Chuyển động biểu đạt chú ý và ý định trên hình phi nhân dạng | Ảnh hưởng đến thiết kế |
| Gesture và tính hài hước | Semantic Gesture in Robot Humor [R7] | Sự rõ ràng và phù hợp quyết định hiệu quả | Ảnh hưởng đến thiết kế |
| Perception với hình thể hạn chế | Reachy Mini perception study [R8] | Đánh giá sắc thái tổng quát và độ phù hợp | Ảnh hưởng đến tiêu chí đánh giá |
| Controller robot companion | Reachy Mini conversation app [R9] | Idle breathing, một điểm điều khiển, chuyển tiếp mượt | Tham khảo implementation |
| Sức sống qua chuyển động cơ thể | Microduck [R10] | Tham chiếu trải nghiệm do người dùng đưa ra | Tham chiếu sản phẩm |
| Animation thành robot động lực học | Animated Cassie [R11] | Chuyển ý đồ animation sang chuyển động khả thi | Đối chiếu bổ sung |

## 4. Phân tích từng nhóm

### 4.1. Boids: particle sống động nhưng chưa đủ để có biểu cảm

Reynolds mô tả đàn chuyển động từ các actor tương tác bằng thông tin local. Nguồn của chính tác giả là [bài SIGGRAPH 1987](https://www.red3d.com/cwr/papers/1987/boids.html) và [giải thích Boids](https://www.red3d.com/cwr/boids/) [R1].

Fisch đã có `TargetBoids`: attraction về target hình học, cùng separation/alignment/cohesion nhẹ trong từng nhóm part. Đây là biến thể phục vụ giữ silhouette, không phải tái lập nguyên bản đàn tự do. Giới hạn neighbor checks, damping và speed cap là quyết định kỹ thuật của project. Boids giải thích chất chuyển động của hạt; nó không tự quyết định nhân vật đang chú ý, nghiêm túc hay đùa.

**Code:** [boids.ts](../src/core/geometry/boids.ts), [mô tả swarm](swarm-geometry.md).

### 4.2. Laban / Effort: chất lượng của hành động

Luận án của Heather Knight mô tả Computational Laban Effort để điều chỉnh chuyển động tác vụ, với Time, Weight, Space và Flow; nghiên cứu hướng đến robot ít bậc tự do. [Nguồn CMU](https://publications.ri.cmu.edu/expressive-motion-low-degree-freedom-robots) [R2].

Fisch đã có các tham số `effort.time`, `effort.weight`, `effort.flow` và shape quality. Sự tương ứng này giúp đặt code trong dòng expressive motion; không chứng minh các transfer function của Fisch tương đương CLE. Đây là nguồn đối chiếu thêm trong báo cáo, không phải bằng chứng về lịch sử tham khảo của code cũ.

Project cần tự kiểm tra người xem có nhận ra các khác biệt dự kiến hay không. Xem [admission và Effort](admission.md), [đánh giá perception](effort-evaluation.md) và [scheduler](../src/core/runtime/scheduler.ts).

### 4.3. Timing: cùng đường đi vẫn có thể truyền đạt khác nhau

Zhou và cộng sự giữ đường chuyển động cố định, thay timing và nghiên cứu cách người xem suy ra những thuộc tính như sự tự tin hoặc tính tự nhiên. [Expressive Robot Motion Timing](https://arxiv.org/abs/1802.01536) [R3].

Fisch áp dụng ở mức ý tưởng: pose cần một nhịp hành động đọc được, có thời lượng và recovery; thay đổi tọa độ liên tục chưa đủ. Generated performance dùng các beat có duration, nội suy và hồi phục về neutral. Smoothstep, recovery 450 ms và mức thay đổi timing hiện tại là lựa chọn của project, không phải tham số đã được bài báo xác nhận cho Braille.

**Code:** [PresenceMotion](../src/core/runtime/presence.ts).

### 4.4. Nutty: một pipeline ghép chuyển động

Ribeiro và Paiva trình bày pipeline tạo, kết hợp và blend các nguồn animation, cùng motion filter giới hạn chuyển động. [Nutty-based Robot Animation](https://arxiv.org/abs/1904.02898) [R4].

Ảnh hưởng đến Fisch là tách nguồn ý đồ khỏi thực thi: model tạo hình/choreography, controller local phát hành vi, compositor ghép với chuyển động nền. Fisch không tích hợp Nutty, không dùng controller vật lý của nó và không có đầy đủ motion filtering cho robot thật. Các giới hạn transform, quyền sở hữu channel và kiểm tra part binding là cách hiện thực riêng.

**Code:** [scheduler](../src/core/runtime/scheduler.ts), [formation/compositor](../src/core/geometry/morph.ts).

### 4.5. Buddy: idle motion có tác động, nhưng cần tiết chế

Nghiên cứu của Casso và cộng sự dùng Buddy với 15 người tham gia, thay tần số chuyển động khi robot kể các câu chuyện buồn. Kết quả gợi ý tần số phù hợp với sắc thái có ý nghĩa đối với tương tác. [Nguồn nghiên cứu](https://arxiv.org/abs/2209.00983) [R5].

Fisch lấy đây làm lý do để thiết kế idle có chủ ý: chuyển động nhẹ, khoảng nghỉ và intensity giảm dần. Mẫu nhỏ, bối cảnh hẹp và hình thể khác biệt khiến kết quả chưa thể chuyển thẳng sang agent Braille. Không có kết luận rằng chuyển động nhiều hơn luôn tốt hơn.

**Code:** [interaction body](../integrations/interaction-body.mjs), [presence](../src/core/runtime/presence.ts).

### 4.6. ELEGNT: biểu cảm không đòi hỏi khuôn mặt người

ELEGNT nghiên cứu robot dạng đèn, kết hợp mục tiêu chức năng và biểu cảm. So sánh trong sáu kịch bản cho thấy chuyển động expressive cải thiện engagement và một số đánh giá về robot, đặc biệt ở tác vụ xã hội. [Bài nghiên cứu](https://arxiv.org/abs/2501.12493) [R6].

Fisch giữ khả năng biểu đạt bằng toàn bộ hình thể: không bắt buộc có mắt, miệng hay skeleton. Model có thể tạo bộ phận và trực tiếp chỉ định part nào chuyển động. Đây là định hướng thiết kế; Fisch chưa tái lập user study hoặc utility optimization của ELEGNT.

**Code:** [planner instructions/schema](../integrations/expression-plan.mjs), [geometry types](../src/core/geometry/types.ts).

### 4.7. Gesture và humor: rõ nghĩa, đúng lúc

Nghiên cứu HRI 2024 về NAO báo cáo semantic gesture có thể tăng cảm nhận hài hước, với hiệu quả phụ thuộc vào độ rõ và tính phù hợp. [Bản tác giả tại UCL](https://discovery.ucl.ac.uk/id/eprint/10194649/) [R7].

Fisch dùng nguyên tắc này cho sắc thái “meme”: model tự chọn hình và cách cường điệu theo ngữ cảnh. Các ví dụ người dùng đưa ra không trở thành danh mục animation cố định. Khi gặp thất vọng hoặc lỗi, planner được hướng tới sự chú ý điềm tĩnh. Chưa có user study chứng minh các biểu cảm hiện tại buồn cười hoặc phù hợp trên Braille.

**Code:** [planner instructions](../integrations/expression-plan.mjs).

### 4.8. Reachy Mini perception: đo điều người dùng thật sự nhận ra

Preprint của Rogel, Yadollahi và Laban dùng 100 người tham gia đánh giá 10 clip Reachy Mini. Người xem nhận ra sắc thái tổng quát theo valence/arousal tốt hơn nhiều nhãn cảm xúc chính xác. [Nguồn](https://arxiv.org/abs/2605.12786) [R8].

Điều này định hướng cách đánh giá Fisch: hỏi có thấy chú ý, phù hợp, sinh động và gây phân tâm hay không, thay vì mặc định mọi nhãn `mood` đều được nhận diện đúng. Chưa chuyển bộ câu hỏi hay kết quả của nghiên cứu này thành một benchmark đã được xác nhận cho Fisch.

### 4.9. Reachy Mini implementation và Microduck: hai vai trò khác nhau

Implementation được kiểm tra của Reachy Mini mô tả idle breathing, control loop dùng monotonic clock, một điểm phát lệnh chuyển động và blending khi thay đổi; listening có thể giảm chuyển động. [moves.py](https://huggingface.co/spaces/pollen-robotics/reachy_mini_conversation_app/blob/main/src/reachy_mini_conversation_app/moves.py) [R9]. Fisch tham khảo cách tổ chức vòng đời chuyển động, không chép module này. Link `main` có thể thay đổi; nội dung mô tả phản ánh thời điểm kiểm tra.

Microduck là tham chiếu trải nghiệm do người dùng nêu: hình thể và chuyển động có thể tạo sức hấp dẫn ngoài năng lực hội thoại. [Trang chính thức](https://pollen-robotics.com/microduck/) và [repository](https://github.com/pollen-robotics/microduck) mô tả robot biped cùng hướng học behavior/sim-to-real [R10]. Chưa phân tích controller cụ thể để xác định nguồn gốc cảm giác “có hồn”; không gán kiến trúc Reachy hoặc Fisch cho Microduck.

### 4.10. Animated Cassie: animation cần một lớp thực thi khả thi

Animated Cassie kết hợp thiết kế animation, tối ưu động lực học và controller đứng/đi để đưa chuyển động expressive lên robot hai chân. [Nguồn IROS 2020](https://arxiv.org/abs/2009.02846) [R11].

Đây là đối chiếu thêm: ý đồ biểu cảm cần đi qua một runtime có ràng buộc. Fisch xử lý hình học và giới hạn phần mềm, không mô phỏng contact physics, cân bằng biped, reinforcement learning hay sim-to-real. Bài này chưa được dùng để triển khai một thuật toán riêng trong đợt nâng cấp.

## 5. Từ related work đến quyết định trong Fisch

| Quyết định | Cơ sở liên quan | Đã hiện thực | Giới hạn còn lại |
| --- | --- | --- | --- |
| Giữ silhouette bằng particle có target | Boids [R1] + yêu cầu hình học của project | Target-aware steering trong từng part | Không bảo đảm collision-free hoặc optimal assignment |
| Có lớp presence chạy local | Buddy [R5], Reachy [R9] | Root motion, smoothing, intensity decay | Root-only từng bị người dùng đánh giá quá khó phân biệt |
| Model tạo choreography theo ngữ cảnh | ELEGNT [R6], phản hồi người dùng | Performance score và part ID tường minh | Không có vô hạn hành vi mới trong mỗi score |
| Working thay pose qua thời gian | Timing [R3], Nutty [R4] | Nhiều clip, recovery, chọn theo activity, tránh lặp liền | Clip vẫn có thể lặp trong phiên dài |
| Không suy đoán anatomy từ tên part | Free-form geometry + yêu cầu người dùng | Transform chỉ áp dụng trên binding được khai báo | Model phải khai báo đúng part và pivot |
| “Meme” là phong cách, không là preset | Humor [R7] | Guidance cho model về tương phản và timing | Chưa có đánh giá hài hước của người dùng |
| Idle không gọi model theo timer | Quyết định chi phí/vòng đời riêng của project | Score phát trong bộ nhớ; không phát sinh inference | Giảm tính mới nếu idle kéo dài |
| Hủy hoặc đổi lượt không dùng score cũ | Thiết kế lifecycle riêng của project | Admission, generation checks và clear score | Cần mở rộng soak và kiểm tra tương tác native |
| Đánh giá perception trên Braille thật | Reachy perception [R8] + phản hồi sản phẩm | Capture và kiểm tra kỹ thuật ban đầu | Chưa có human acceptance hoặc comparative study |

Các giới hạn số như tối đa ba clip, tám part trong clip, khoảng nghỉ clip working được runtime giới hạn tối đa sáu giây là **tham số kỹ thuật hiện tại của Fisch**. Không coi đó là kết luận từ các nghiên cứu.

## 6. Project thực sự kế thừa gì?

Fisch kết hợp ba nhóm ý tưởng: chuyển động particle có hành vi local; biểu đạt bằng chất lượng/timing của chuyển động; và pipeline tách ý đồ biểu cảm khỏi lớp thực thi có giới hạn. Implementation tại mốc trên dùng model để viết một score khai báo, rồi thực thi local trên hình học tự do trong pane coding agent.

Đây là mô tả cách tích hợp của project, không phải tuyên bố rằng tổ hợp này mới về học thuật. Chưa làm novelty search đủ rộng để đưa ra tuyên bố như vậy.

Các nền tảng triển khai như TypeScript, Three.js, Tauri, Node.js và công cụ build/test là dependency phần mềm, khác với related work về expressive behavior. Phiên bản được quản lý trong [package.json](../package.json) và lockfile. Trích dẫn paper hoặc repository không đồng nghĩa được cấp quyền sử dụng code/assets của nguồn đó; license của sản phẩm Fisch vẫn theo trạng thái được ghi trong README.

## 7. Bằng chứng lịch sử và câu hỏi mở

Đợt nâng cấp đã có full suite 177 test pass, sau đó thêm một test positive-path và chạy lại nhóm idle/planner 19 test pass. Build, architecture check và kiểm tra whitespace đã pass. Test kỹ thuật xác nhận validation, binding, nội suy, hủy và stale-result handling; không đo được cảm giác sinh động của con người.

Một lần chạy Codex thật tạo geometry cùng ba clip trong khoảng 33 giây; một lần trước đó timeout ở 45 giây. Đây là quan sát riêng lẻ, chưa đủ để xác nhận latency production. Capture so sánh 60 giây cho thấy khác biệt ở từng bộ phận. Telemetry pane xác nhận nhiều clip được phát local mà không tăng số lần inference trong lúc phát.

Các artifact hiện nằm trong thư mục ignored `.runtime/`, **không được Git lưu và sẽ không đi theo lần push thông thường**:

- `generative-performance.mp4`: cùng geometry/seed, so sánh ambient-only với articulated performance.
- `performance-poses.png`: những pose đại diện để nhìn khác biệt.
- `performance-capture.json`: timeline clip của lần capture.
- `generated-performance.json`: một output model dùng cho đánh giá, không phải thư viện preset.

### Lần so sánh A/B trực quan 75 giây

Video `.runtime/ab-expression-study.mp4` so sánh A (runtime hiện tại với ambient-only) và B (cùng runtime, bật performance score do model tạo). Giữ nguyên geometry, seed 42, 2.000 particle mỗi bên, camera, flow và timeline; chỉ thay việc bật/tắt score. Capture 20 FPS, dùng viewport 348 × 344 và mapping Braille 87 cột × 43 hàng lấy từ pane tại thời điểm chạy. Bản trình bày có cả particle render và preview các Braille mask bằng chấm phóng lớn; đây không phải quay màn hình font terminal 1:1.

Timeline gồm working từ 0–40 giây, idle từ 40–60 giây, rồi working từ 60–75 giây. Video có nhãn state, clip và đồng hồ. Model output được tái sử dụng; không có inference trong lúc playback. Protocol cùng hash của score nằm ở `.runtime/ab-study-protocol.json`; script tái tạo local là `.runtime/render-ab-study.mjs` và `.runtime/compose-ab-study.py`.

Đây là ablation trực quan, dùng một geometry và vị trí A/B cố định. Chưa blind, randomize/counterbalance hoặc thu đánh giá người xem; chưa có kết quả về preference hay statistical significance. Video giúp quan sát khác biệt chứ chưa xác nhận B tốt hơn A.

### Lịch sử sampler area-peak (đã được thay làm mặc định)

Phản hồi tiếp theo của người dùng cho thấy pane thật nhìn thưa và khó đọc hơn video. Kiểm tra `integrations/pane-display.mjs` tìm thấy mỗi chấm Braille chỉ lấy một pixel ở góc vùng nguồn. Với viewport 348 × 344 thu về 87 × 43 ô, mỗi chấm đại diện khoảng 2 × 2 pixel; nét mảnh nằm ngoài điểm lấy mẫu có thể biến mất hoặc nhấp nháy khi dịch chuyển nhỏ.

Bản sửa trước `9863ba3` chọn pixel sáng nhất vượt ngưỡng trong toàn bộ footprint của từng chấm, không mở rộng tín hiệu sang chấm bên cạnh. Giữ nguyên 2.000 particle, cỡ chấm và ngưỡng nền. Trên cùng một frame của geometry đang chạy, số chấm được giữ tăng từ 440 lên 1.307. Đây là phép đo một frame, không phải mức cải thiện phổ quát. Conversion p95 đo riêng khoảng 9,1 ms ở viewport này trong một lần chạy local; chưa đại diện cho toàn bộ frame hoặc mọi kích thước pane.

Ảnh đối chiếu nằm ở `.runtime/braille-density-comparison.png`, số liệu và các mask ở `.runtime/braille-density-comparison.json`. Các test mới kiểm tra nét lệch điểm lấy mẫu, độ ổn định khi hạt di chuyển trong footprint, màu, background và pixel biên ở tỷ lệ không nguyên. Full suite 181 test, build và architecture check đã pass sau bản sửa. Preview Braille trong video A/B cũ phản ánh sampler trước bản sửa; cần render lại khi muốn đánh giá pipeline mới.

Cần kiểm chứng tiếp: độ rõ ở kích thước Braille thực tế; mức phân tâm khi làm việc dài; độ phù hợp của humor; phản ứng khi latency cao; reduced motion; real-time soak và khả năng giữ cảm giác mới trong phiên kéo dài. Kết quả từ robot vật lý không tự động chứng minh các thuộc tính này trên terminal.

## 8. Tài liệu tham khảo

| Mã | Tài liệu / nguồn chính | Thông tin |
| --- | --- | --- |
| R1 | [Flocks, Herds, and Schools: A Distributed Behavioral Model](https://www.red3d.com/cwr/papers/1987/boids.html) | Craig W. Reynolds; SIGGRAPH, 1987 |
| R2 | [Expressive Motion for Low Degree-of-Freedom Robots](https://publications.ri.cmu.edu/expressive-motion-low-degree-freedom-robots) | Heather Knight; luận án CMU, 2016; CMU-RI-TR-16-51 |
| R3 | [Expressive Robot Motion Timing](https://arxiv.org/abs/1802.01536) | Allan Zhou và cộng sự; HRI 2017; bản arXiv 2018 |
| R4 | [Nutty-based Robot Animation — Principles and Practices](https://arxiv.org/abs/1904.02898) | Tiago Ribeiro, Ana Paiva; 2019 |
| R5 | [The Effect of Robot Posture and Idle Motion on Spontaneous Emotional Contagion during Robot-Human Interactions](https://arxiv.org/abs/2209.00983) | Isabel Casso và cộng sự; SCRITA workshop, 2022 |
| R6 | [ELEGNT: Expressive and Functional Movement Design for Non-anthropomorphic Robot](https://arxiv.org/abs/2501.12493) | Yuhan Hu và cộng sự; preprint, 2025 |
| R7 | [Semantic Gesture in Robot Humor: A New Dimension to Enhance the Humor Expression](https://discovery.ucl.ac.uk/id/eprint/10194649/) | HRI Companion 2024; bản accepted manuscript tại UCL; DOI 10.1145/3610978.3640710 |
| R8 | [Emotional Expression in Low-Degrees-of-Freedom Robots: Assessing Perception with Reachy Mini](https://arxiv.org/abs/2605.12786) | Amit Rogel, Elmira Yadollahi, Guy Laban; preprint, 2026 |
| R9 | [Reachy Mini conversation app: moves.py](https://huggingface.co/spaces/pollen-robotics/reachy_mini_conversation_app/blob/main/src/reachy_mini_conversation_app/moves.py) | Pollen Robotics; implementation tham khảo, kiểm tra 07/11/2026 |
| R10 | [Microduck](https://pollen-robotics.com/microduck/), [source repository](https://github.com/pollen-robotics/microduck) | Pollen Robotics; sản phẩm/source chính thức, kiểm tra 07/11/2026 |
| R11 | [Animated Cassie: A Dynamic Relatable Robotic Character](https://arxiv.org/abs/2009.02846) | Zhongyu Li, Christine Cummings, Koushil Sreenath; IROS 2020 |

## 9. Cách duy trì báo cáo

Khi thêm nguồn mới, ghi rõ phát hiện của nguồn, phạm vi đã đọc, ảnh hưởng cụ thể đến quyết định và đường dẫn code tương ứng. Khi tái sử dụng code/assets, bổ sung commit/version cùng thông tin license riêng. Khi có đánh giá người dùng, ghi protocol, số người tham gia, điều kiện renderer và kết quả, thay vì thay thế chúng bằng test tự động.

Phụ lục giữ lại nhật ký và kế hoạch của đợt nâng cấp đầu tiên để bảo toàn lịch sử. Các mốc cũ bên trong phụ lục cần được đọc theo thời điểm, không thay cho trạng thái tổng hợp ở trên.

## 10. Cập nhật: Braille theo thời gian và idle scene tự do

### 10.1. Phạm vi yêu cầu và lựa chọn của người dùng

Người dùng bổ sung ghi chú nghiên cứu về tone-mapping, dithering và animation; đồng thời phản hồi rằng một khuôn mặt với một động tác lặp lại chưa đủ sinh động. Lựa chọn đã xác nhận: **không gọi model khi idle**, chỉ diễn trong pane bằng hình/chuyển động hoặc chữ ngắn, không thông báo ngoài pane và không âm thanh.

Các con số trong ghi chú người dùng là kết quả do người dùng cung cấp, chưa được tái lập nguyên trạng. Baseline mới của project là area-peak sampler trong `193fa15`, khác baseline lấy một pixel được ghi chú nêu. Không gán sẵn mức giảm nhấp nháy 40% cho bản mới.

### 10.2. Nghiên cứu bổ sung

| Nguồn chính | Điều được kiểm tra | Liên hệ và giới hạn |
| --- | --- | --- |
| [R12 — dapple](https://github.com/queelius/dapple) | Nhiều backend terminal, preprocessing contrast/gamma/dither và capability detection | Hữu ích để phân biệt preprocessing với encoding. Chưa xác minh xếp hạng “autocontrast tác động lớn nhất” trong một benchmark độc lập |
| [R13 — Scalar Spatiotemporal Blue Noise Masks, EGSR 2022](https://www.ea.com/technology/news/egsr-2022-blue-noise) | Phân bố noise trong không gian/thời gian, ổn định khi temporal filtering | Không suy ra rằng đổi noise mask mỗi frame sẽ làm Braille ổn định hơn; terminal hiện không có TAA. Bản này dùng Bayer cố định, không tích hợp STBN assets |
| [R14 — ASCII characters are not pixels](https://alexharri.com/blog/ascii-rendering) | Sampling theo hình dạng glyph và tăng tương phản ranh giới | Là hướng tham khảo cho glyph matching. Chưa chạy thuật toán đó trên particle của Fisch, nên chưa kết luận hơn/kém Braille |
| [R15 — Chafa configuration API](https://hpjansson.org/chafa/ref/chafa-ChafaCanvasConfig.html), [release 1.16.0](https://github.com/hpjansson/chafa/releases/tag/1.16.0) | Preprocessing, symbol maps, dithering, nhiều đường xuất terminal | Giữ làm baseline/tùy chọn sau; không thêm dependency Chafa trong đợt này |
| [R16 — Unicode 16, Chapter 22](https://www.unicode.org/versions/Unicode16.0.0/core-spec/chapter-22/) | Các nhóm ký hiệu đồ họa legacy/terminal | Không bật octant mặc định khi chưa kiểm tra font và Herdr thực tế. Không khẳng định tình trạng tương thích của mọi terminal |

Tên `img2dots` trong ghi chú chưa được nối chắc chắn với một repository/phiên bản nguồn chính, nên pipeline cụ thể gán cho nó chưa được dùng làm bằng chứng độc lập ở đây. Floyd–Steinberg không được chọn cho đường animation mặc định; ảnh hưởng khuếch tán không gian là lý do kỹ thuật để cân nhắc, nhưng đợt benchmark bên dưới không chạy implementation Floyd–Steinberg.

### 10.3. Pipeline Braille được triển khai

Implementation mới: [braille-renderer.mjs](../integrations/braille-renderer.mjs), được [pane-display.mjs](../integrations/pane-display.mjs) giữ riêng một instance theo output/session.

1. Tính signal trên toàn footprint của mỗi chấm. Dùng mean density cộng 25% peak để bảo vệ nét mảnh; tách nền tối cố định của renderer trước khi tính signal. Noise floor vẫn tồn tại để không khuếch đại nền, nhưng không còn dùng một ngưỡng sáng cố định làm quyết định on/off cho mọi chấm.
2. Tính phân vị 98% trên signal foreground, làm mượt exposure khoảng 450 ms. Đây là lựa chọn kỹ thuật của project; foreground percentile giúp không lấy phân vị bằng zero khi vật thể chỉ chiếm ít diện tích.
3. Áp lũy thừa 1,5 lên density chuẩn hóa để phân biệt vùng dày và lớp vỏ thưa. Đây là đường cong density mang tính trình bày, không phải tuyên bố hiệu chỉnh gamma vật lý chính xác của terminal.
4. So với Bayer 4 × 4 cố định theo tọa độ. Thêm hysteresis 0,10; signal biến mất thật thì chấm tắt ngay, không giữ trail trên nền rỗng.
5. Giữ hue, làm mượt màu ô khoảng 120 ms rồi lượng tử hóa ANSI color. Reset history khi đổi viewport, tiếp tục sau một khoảng ngắt dài hoặc bắt đầu session mới. Gửi cả frame Braille trong một lần write để tránh chia header/body thành hai đợt output.

API `brailleFrame` vẫn dùng được cho ảnh đơn. Animation cần giữ `BrailleRenderer` qua các frame; live `drawFrame` đã làm điều đó. Sự ổn định được kiểm tra riêng bằng input tĩnh, near-threshold chatter, blank-frame clearing và reset viewport; không chỉ dựa trên animation có chuyển động thật.

Style mặc định là `adaptive`. Có thể đặt biến môi trường khi khởi chạy `FISCH_BRAILLE_STYLE=peak` để giữ glyph density theo area-peak trước đây; đây là lựa chọn về trình bày, không thay geometry, scene hay số lần gọi model. Biến này hiện đọc từ môi trường shell, không từ `.env`.

`fisch status` có `rendering` để kiểm tra style đang thực sự chạy, exposure, viewport và số lit dots. Đây là metadata để đối chiếu live với video; không phải điểm đánh giá thẩm mỹ.

### 10.4. Benchmark trên hình động

Fixture là hai geometry native Codex đã ghi trong `docs/evidence/interaction-smoke.json`, không phải ảnh nguồn của một thư viện khác. Mỗi trường hợp có 20 warmup frame và 100 frame đo ở 20 FPS. Tất cả variant nhận đúng cùng RGB frame, camera, particle count và thời điểm.

Metric chính: tổng số ô có mask thay đổi chia cho tổng số ô có hình trong union của hai frame liên tiếp. Nó bao gồm pulse, boids và chuyển động có chủ ý; không đo riêng “flicker không mong muốn” hay preference. Cũng lưu active-dot change, độ phủ và thời gian chuyển đổi để không che mất tradeoff.

| Fixture / pane | Baseline area-peak hiện tại | Tone + Bayer + hysteresis | Giảm tương đối theo metric ô |
| --- | --- | --- | --- |
| Praise / 40 × 14 | 26,4% | 16,5% | khoảng 38% |
| Frustration / 40 × 14 | 16,7% | 10,4% | khoảng 38% |
| Praise / 87 × 43 | 44,7% | 33,5% | khoảng 25% |
| Frustration / 87 × 43 | 27,9% | 21,7% | khoảng 22% |

Đây là mẫu ngắn trên hai fixture, không phải bảo đảm giảm 40% cho mọi scene. Tone-mapping chủ động giảm độ phủ lớp vỏ; với metric bit-dot đã chuẩn hóa, một số trường hợp pane nhỏ có tỷ lệ thay đổi cao hơn baseline dày đặc. Vì vậy không suy ra mọi metric hoặc mọi chi tiết đều tốt hơn. Cần người dùng so sánh độ đọc được của hình và độ phân tâm thực tế.

Số liệu đầy đủ: `.runtime/braille-animation-benchmark.json`; script tái tạo: `.runtime/benchmark-braille.mjs`. Thời gian đo local, có lúc chạy đồng thời với test/build, không phải benchmark cách ly để chứng nhận performance. Preview ban đầu ở `.runtime/braille-animation-contact.png` được tạo trước lần cân bằng 25% peak cuối cùng; xem video/demo mới khi đánh giá cấu hình cuối.

### 10.5. Idle phát triển bằng nội dung đã chuẩn bị

Schema model có thêm `idleScenes`: tối đa ba cảnh, mỗi cảnh có ID tự do, thời điểm đủ điều kiện, caption tùy chọn và geometry program riêng. Model chuẩn bị các cảnh trong **cùng lần phản ứng với tương tác thật**; không tạo request theo timer idle. Caption được kiểm tra control characters và clip theo bề rộng pane. Không có gửi chat, âm thanh hay notification API trong director.

[IdleScenes](../integrations/idle-scenes.mjs) đổi toàn bộ assembly theo thời gian idle/done, ưu tiên cảnh eligible ít được phát gần đây, tránh lặp ngay và có khoảng nghỉ 22–33 giây. Khi phát lại, runtime chỉ thay nhịp và phase trong giới hạn motion đã được model khai báo, giữ nguyên geometry/pivot/amplitude và không sửa dữ liệu gốc. Không có danh mục “wink”, “wave”, “BRB” hoặc phân loại anatomy trong production code.

Khi user quay lại/working, khôi phục program tương tác và flow trước cảnh idle. Tin nhắn mới, manual replacement và cancel xóa scene continuation cũ đúng thứ tự. Cảnh lỗi bị bỏ qua, không retry mỗi frame. Authored motion của cảnh idle được giữ hoạt động sau mốc 30 giây; không bị policy settling cũ đóng băng. Motion-off chặn chuyển sang cảnh mới.

Một lần chạy Codex thật trong trạng thái working đã tạo hình chính phi khuôn mặt và hai cảnh khác trong khoảng 44 giây, bên trong deadline 45 giây nhưng rất sát giới hạn. Tên và ý tưởng cảnh do model chọn. Đây không phải latency guarantee; tăng độ phong phú output vẫn có rủi ro timeout, cần tiếp tục tối ưu.

Giới hạn quan trọng: số cảnh và nội dung là hữu hạn trong mỗi lượt. Playback local có thể biến tấu, nhưng không tự sáng tạo ngữ nghĩa/geometry hoàn toàn mới mãi mãi khi đã cấm idle inference. Tương tác thật tiếp theo có thể chuẩn bị một tập cảnh mới. Nếu model trả `idleScenes: []` hoặc generation thất bại, vẫn có fallback presence nhưng không có cảnh mới để phát.

Cache cảnh hiện chỉ nằm trong RAM. Một lần khởi chạy mới chưa nhận tương tác thật sẽ có fallback ban đầu; không tự nạp fixture đánh giá thành thư viện gesture hay gọi model lúc idle để lấp cache.

### 10.6. Kiểm chứng và phần tiếp theo

Full suite đã đạt 195 test sau khi thêm biến tấu phase/tempo và style tương thích. Sau khi gộp test renderer vào file idle-planner để giữ change set trong giới hạn mười file, nhóm regression renderer/idle/pane 48 test đã pass. Build và architecture boundary check đã pass. Test bao phủ việc phát nhiều geometry mà không tăng model calls, không bỏ sót scene eligible, restore/clear, caption injection, motion-off, rejected scenes và chuyển động sau hơn 30 giây idle.

Demo `.runtime/idle-evolution-demo.mp4` dùng cùng nguồn RGB ở hai nửa so sánh renderer và phát cảnh do native model đã chuẩn bị. Timeline demo được ghi rõ ở tốc độ 2×: 120 giây mô phỏng thành 60 giây video, có giai đoạn working → idle → quay lại working. `.runtime/idle-demo-protocol.json` ghi số cảnh và kiểm tra không có inference trong playback. Artifact `.runtime/` vẫn ignored và không đi theo push Git thông thường.

Các hướng chưa triển khai: chiếu particle trực tiếp lên lưới dot, giữ group/importance metadata tới bước raster, benchmark Chafa/octant/blue-noise với font thật, đo native terminal output/backpressure và đánh giá dài với người dùng. Nếu thêm importance, phải do model/host khai báo tường minh; không suy ra mắt/miệng từ tên part. Direct projection cần được đối chiếu về silhouette, motion continuity và chi phí, không mặc định tốt hơn chỉ vì ít một bước sampling.
