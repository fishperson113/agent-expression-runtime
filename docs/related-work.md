# Fisch — Báo cáo Related Work và Cơ sở Thiết kế

**Ngày tổng hợp:** 07/11/2026. **Phạm vi:** expressive motion, social robotics, behavioral animation và cách chúng liên hệ với particle expression runtime của Fisch.

## 1. Mục đích và cách đọc

Báo cáo trả lời câu hỏi: **Fisch đang xây dựng trên những ý tưởng nào, đã áp dụng đến đâu, và còn điều gì phải tự kiểm chứng?** Đây là tài liệu lưu dấu quyết định thiết kế, không phải một systematic literature review hay tuyên bố về tính mới học thuật.

Tại thời điểm viết, nền Git là `cd48ad0` trên `main`; các thay đổi về continuous presence và generated performance đang ở working tree, chưa commit/push. Remote `origin/main` được kiểm tra trực tiếp và cũng ở `cd48ad0`.

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

Xem [README](../README.md), [hình học particle](swarm-geometry.md), [planner](expression-planner.md) và [kiến trúc](architecture.md). Một số tài liệu cũ mô tả các giai đoạn POC trước đây; phần ánh xạ code dưới đây phản ánh working tree tại ngày tổng hợp.

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

Các giới hạn số như tối đa ba clip, tám part trong clip, khoảng nghỉ working tối đa sáu giây là **tham số kỹ thuật hiện tại của Fisch**. Không coi đó là kết luận từ các nghiên cứu.

## 6. Project thực sự kế thừa gì?

Fisch kết hợp ba nhóm ý tưởng: chuyển động particle có hành vi local; biểu đạt bằng chất lượng/timing của chuyển động; và pipeline tách ý đồ biểu cảm khỏi lớp thực thi có giới hạn. Hướng mới trong working tree dùng model để viết một score khai báo, rồi thực thi local trên hình học tự do trong pane coding agent.

Đây là mô tả cách tích hợp của project, không phải tuyên bố rằng tổ hợp này mới về học thuật. Chưa làm novelty search đủ rộng để đưa ra tuyên bố như vậy.

Các nền tảng triển khai như TypeScript, Three.js, Tauri, Node.js và công cụ build/test là dependency phần mềm, khác với related work về expressive behavior. Phiên bản được quản lý trong [package.json](../package.json) và lockfile. Trích dẫn paper hoặc repository không đồng nghĩa được cấp quyền sử dụng code/assets của nguồn đó; license của sản phẩm Fisch vẫn theo trạng thái được ghi trong README.

## 7. Bằng chứng hiện có và câu hỏi mở

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

### Sửa mất nét khi chuyển sang Braille

Phản hồi tiếp theo của người dùng cho thấy pane thật nhìn thưa và khó đọc hơn video. Kiểm tra `integrations/pane-display.mjs` tìm thấy mỗi chấm Braille chỉ lấy một pixel ở góc vùng nguồn. Với viewport 348 × 344 thu về 87 × 43 ô, mỗi chấm đại diện khoảng 2 × 2 pixel; nét mảnh nằm ngoài điểm lấy mẫu có thể biến mất hoặc nhấp nháy khi dịch chuyển nhỏ.

Bản sửa chọn pixel sáng nhất vượt ngưỡng trong toàn bộ footprint của từng chấm, không mở rộng tín hiệu sang chấm bên cạnh. Giữ nguyên 2.000 particle, cỡ chấm và ngưỡng nền. Trên cùng một frame của geometry đang chạy, số chấm được giữ tăng từ 440 lên 1.307. Đây là phép đo một frame, không phải mức cải thiện phổ quát. Conversion p95 đo riêng khoảng 9,1 ms ở viewport này trong một lần chạy local; chưa đại diện cho toàn bộ frame hoặc mọi kích thước pane.

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

<details>
<summary>Phụ lục — Nhật ký research, triển khai và kế hoạch nâng cấp gốc</summary>

## Fisch: continuous expressive movement — historical implementation notes

Research and implementation proposal, 2026-11-07. Status: continuous presence and experimental model-authored articulated performances implemented; human acceptance remains pending.

## Revision after user feedback: generated performances

The first delivery mainly added root movement. User feedback found the difference too subtle and working too static. Wink, fingers and waving were examples of the desired clarity, not a request for a fixed gesture library. The revision therefore adds a model-authored performance score instead of named animation presets.

Additional research: [Semantic Gesture in Robot Humor, HRI 2024](https://discovery.ucl.ac.uk/id/eprint/10194649/) reports that semantic gestures improved perceived humor in an online survey of NAO performances, with effectiveness linked to clarity and appropriateness. This supports readable contextual exaggeration, not indiscriminate joking. Together with ELEGNT and motion-timing research below, it motivates clear preparation/action/recovery, contrasting poses and occasional playful exaggeration while preserving a composed response to frustration. Generalizing these robot findings to Braille remains a design hypothesis.

Implemented changes:

- Planner output can include `performance: { clips: [...] }` or null. Each clip has an arbitrary ID, matching activity (`working`/`idle`), a gap and two to four timed poses. Poses explicitly reference generated part IDs and declare pivot, translation, Euler rotation and scale. No production code interprets IDs as gesture names or infers eyes/hands from shape or name.
- Up to three clips, eight unique bound parts per clip, bounded transforms and durations, unique clip IDs, valid final-assembly references and stable per-part pivots are validated before installation. Older responses without a score retain the ambient fallback.
- A shared local controller interpolates model-authored poses, inserts neutral recovery, varies timing modestly and chooses another eligible clip when more than one exists. Working gaps are capped at six seconds; idle gaps at fifteen. Activity transitions recover and select matching behavior. No timer calls the model to invent another idle gesture.
- Geometry formation applies articulated transforms to a reusable display buffer. It preserves base geometry, explicit particle groups and stable bindings; repeated sampling does not accumulate offsets. The same path feeds browser and terminal renderers.
- Scores install only after their exact model geometry is accepted. New messages, interrupted/needs-user cues, manual replacement and cancel clear stale continuation. Cancel preserves its displayed snapshot before clearing the score. Manual control can explicitly supply a validated score through the local `fisch express` envelope (`body` plus `performance`); this is host metadata, not a new executable AST primitive.
- The planner is instructed to create visible changes appropriate to low-resolution Braille, with compact outputs and a playful/meme-like attitude when appropriate. Geometry and actions remain model choices. Work does not select a predetermined serious face or indicate invented progress.

Validation for this revision:

- 177 tests across 31 files passed; the previous standalone presence tests were consolidated into the existing idle-planner test file to stay within the ten-file workspace change limit. A targeted 44-test regression run also passed after final timing/cancel adjustments.
- A final 19-test idle/planner run additionally covered successful score installation through the automatic planner callback as well as stale-score rejection. All passed. Build, architecture and whitespace checks passed; changed functions remain within 50 lines across ten changed files.
- Native signed-in Codex generated a six-part composition and three valid clips in approximately 33 seconds: two different working performances and one idle performance. The model chose their names and deformations. One earlier, less compact generation hit the existing 45-second deadline; compact generation guidance was added. One success is not a latency guarantee.
- `.runtime/generative-performance.mp4` compares ambient-only and generated articulation for the identical generated geometry, seed and timeline (45 seconds working, then 15 seconds idle). `.runtime/performance-poses.png` shows selected peak deformations, and `.runtime/performance-capture.json` records the actual clip timeline. These are ignored local artifacts, not a checked-in gesture library. The final capture uses quiet pulse matching the listener's normal starting flow.
- Native-renderer stills visibly differ in individual-part shape, unlike the initial whole-body motion comparison. Actual Herdr Braille legibility and perceived humor still require user judgment. A small in-memory score can repeat over long sessions; novel choreography is generated on subsequent real interaction/task events, not from an unbounded background model loop.
- The attached pane was restarted with the new implementation. The native-model-generated geometry and score were submitted through the local manual evaluation envelope and accepted. Live telemetry observed four clips played while working, with zero additional planner attempts during local playback. This is an evaluation of generated behavior, not a claim of fresh native-hook delivery after that restart.

Further work should evaluate recognition and distraction in actual pane sizes, improve generation latency, and consider refreshing an exhausted score only during sustained work under an explicit inference budget. This revision does not claim unlimited novel behavior or measured human preference.

## Implemented first slice

The shared scheduler now samples `PresenceMotion` each frame. Seeded, differently paced oscillations drive small root yaw, roll, translation and breath, with smoothed energy based on activity and existing mood/intensity. Geometry sampling composes this pose without modifying semantic baseline values or submitting replacement programs. This first slice uses continuous procedural motion; sparse glances and anatomical actions remain milestone 2 work.

Idle slows authored part-motion phase to rest after 30 seconds in idle, preserving topology, part groups and animation metadata. Activity can resume that phase. Explicit cancel retains its existing snapshot behavior. Ambient motion yields smoothly while shape/posture channels are actively owned by semantic gestures.

Manual expression pauses inference while local presence continues. Terminal launch accepts environment variable `FISCH_MOTION=normal|reduced|off` (normal by default). Set it in the launching shell; this setting is not currently read from `.env`. Embedded hosts can set `engine.state.presenceIntent.mode`; browser renderer reduced-motion preference also reduces authored motion phase and ambient amplitude. Off holds the current ambient pose and renderer animation clock; it does not cancel a pending inference request or remove the current geometry. Browser reduced-motion continues existing treatment of flow and boids.

`fisch status` exposes `planner.ambient`: mode, energy, suppression flag, sampled pose and update time. The local controller has no inference, timers or growing action queue. Restart Fisch to load source changes; the attached development pane was restarted and its previous expression restored for this rollout.

Validation completed:

- 172 tests across 32 files passed, including added coverage of deterministic motion, minute-long idle presence, smooth suppression, clock gaps, motion-off rendering, reduced motion, topology-preserving settling and manual/inference separation.
- TypeScript/Vite build, core architecture boundary check and whitespace check passed. Vite retains its bundle-size advisory.
- A 60-second deterministic paired terminal-renderer capture is available at ignored local path `.runtime/liveliness-comparison.mp4` (committed implementation on the left, upgrade on the right; identical rabbit, seed and activity timeline). A still was inspected for framing; the clip has not received human preference scoring. Small subsequent changes to accessibility inheritance, phase-wrap handling and intensity decay were covered by tests after capture.
- Local controller microbenchmark: 18,999 samples after warmup, p50 approximately 0.0017 ms, p95 0.0024 ms. Shared geometry sampling for 2,000 particles, 5,000 samples after warmup: committed p95 1.15 ms, upgrade p95 1.13 ms. These noisy local measurements do not establish a speedup or full-frame budget; sampling alone exceeds the proposed 1 ms target on this run. Report: `.runtime/liveliness-performance.json`.
- Live reattachment returned ambient telemetry in normal mode and accepted restoration of the previous expression with zero planner attempts. Actual Braille legibility, sustained distraction assessment, full browser visual comparison and a real-time 30-minute soak remain unverified.

The earlier source findings below describe the pre-upgrade implementation. The remaining architecture and milestones are the continuation plan, not claims that all behaviors already shipped.

## Product objective

Make Fisch feel present between explicit reactions: quiet posture adjustments, attention shifts, asymmetric secondary movement and continuous transitions. Idle should remain visibly alive without creating new LLM requests or replacing the current silhouette. Stillness remains a deliberate behavior, including a user-controlled motion-off mode.

## Research and limits of evidence

- [Microduck official product](https://pollen-robotics.com/microduck/) and [source](https://github.com/pollen-robotics/microduck): a physical biped with learned behaviors and sim-to-real training. Useful embodiment reference. The inspected material does not establish a specific idle-emotion architecture or prove that its appeal comes from one algorithm. Do not attribute a layered animation design to Microduck without inspecting its controller further.
- [ELEGNT, Hu et al., 2025](https://arxiv.org/abs/2501.12493): the lamp-robot study compares expressive and functional motion in six scenarios and reports stronger engagement with expressive movement, especially social tasks. Supports designing attention and intention through motion without requiring a humanoid face. It does not validate Fisch's proposed parameters.
- [Expressive Robot Motion Timing, Zhou et al.](https://arxiv.org/abs/1802.01536): varying timing along the same path changes perceived confidence, naturalness and task properties. Supports treating acceleration, holds and recovery as expressive controls instead of adding more poses.
- [Idle motion and emotional contagion, Casso et al., 2022](https://arxiv.org/abs/2209.00983): Buddy's idle frequency affected participant movement/posture; questionnaire results suggest slow, context-coherent movement can support naturalness. This workshop study is not evidence that more motion always improves interaction.
- [Nutty-based Robot Animation, Ribeiro and Paiva, 2019](https://arxiv.org/abs/1904.02898): a programmable pipeline composes and blends motion sources, with a filter enforcing motion limits. Supports a single motion compositor and bounded trajectories.
- [Reachy Mini movement implementation](https://huggingface.co/spaces/pollen-robotics/reachy_mini_conversation_app/blob/main/src/reachy_mini_conversation_app/moves.py): documents sequential primary moves, one actuator control point, monotonic timing, infinite idle breathing, and blended transitions. Listening can suppress idle movement. This is a related Pollen implementation, not Microduck's controller.
- [Reachy Mini expression perception, Rogel et al., 2026](https://arxiv.org/abs/2605.12786): 100 participants evaluated 10 clips; broad valence/arousal were easier to recover than exact emotion names. Preprint evidence favors evaluating perceived affect and appropriateness instead of expecting reliable recognition of every mood label.

The architectural choices below are engineering proposals informed by these sources. Research review covered abstracts, official descriptions and the linked implementation; it is not a systematic review or a visual evaluation of Microduck's film.

## Findings in this checkout

1. `integrations/interaction-body.mjs`: `tick()` updates baseline every two seconds. After 30 seconds of idle, `settle()` freezes part motion; only low pulse and approximately 0.6% grow oscillation remain. The two-second gate limits baseline updates, not renderer FPS or existing sine motion.
2. `src/terminal/runtime.ts`: `settle()` calls scheduler cancellation. `src/core/runtime/scheduler.ts` invokes `ParticleFormation.freeze()`.
3. `src/core/geometry/morph.ts`: freezing replaces the animated cloud with static sampled positions, clears part metadata and resets particle groups. Semantic articulation cannot continue from those discarded parts.
4. `src/core/geometry/sampling.ts`: each part's translation and rotation share one sine wave. Stable IDs and pivots exist, but there is no blink scale, gaze target, anticipation/hold/recovery envelope or parent-child follow-through.
5. `integrations/planner-bridge.mjs`: manual expression pauses the planner and also gates `body.tick()`. Pausing inference currently suppresses local baseline behavior as a side effect.
6. `integrations/expression-plan.mjs`: mood, intensity and target are emitted, but local `react()` retains intensity only. Idle movement does not differentiate playful, focused or concerned character.
7. `tests/idle-planner.test.mjs` explicitly requires freezing once. This is intentional existing policy, not evidence of a broken hook.
8. `src/adapters/three-renderer.ts`: framing fits the current particle extent each frame. Hypothesis to test: fit scaling can attenuate a grow cue or cause framing variation during articulation. Do not assume a visible defect without paired renders.
9. Existing target-boid dynamics provide particle follow motion. They do not alone define meaningful gaze, posture or action timing. Braille may hide movements that remain visible in the reference renderer.

## Proposed architecture

Keep event-driven inference. Add a local continuous motion controller, shared by terminal and browser rendering, with a single compositor.

| Layer | Inputs | Output / ownership |
| --- | --- | --- |
| Semantic expression | Actual user/task events, bounded planner | Base geometry, explicit gesture, mood and attention intent |
| Attention and posture | Lifecycle, most recent interaction, explicit target | Root orientation, lean, weight shift |
| Vital movement | Seed, elapsed monotonic time, energy | Quiet breathing and smoothly varying posture |
| Secondary action | Available articulation bindings, context | Blink, ear follow-through, small glance, recover |
| Compositor | Layers, ownership masks, limits | One bounded pose/target buffer for renderer and boids |

Processing order: base geometry and authored part motion; permitted local part offsets; root pose; target-boid response; final rendering. Keep simulation state separate from fit-to-view coordinates. Share the same sampled pose across renderers.

The controller must not repeatedly submit replacement AST programs for breathing: that would contend with semantic gestures, reset transitions and consume admission capacity. Sample small local offsets at frame time into reusable buffers. The integration bridge supplies intent; core motion code does not depend on provider modules.

## Behavioral vocabulary

| Context | Proposed continuous behavior | Occasional behavior |
| --- | --- | --- |
| Idle | Relaxed posture, low-amplitude breath, slow weight shift | Short glance away and return, ear adjustment if bound |
| New message / listening | Orient and lean toward user, reduce wandering | Tiny acknowledging nod; fewer secondary actions |
| Working | Stable task-facing posture, restrained motion | Small posture adjustment; no fake progress or success |
| Waiting for user | User-facing orientation with a held expectant pose | Sparse, bounded attention cue; never an escalating nag |
| Explicit success | Brief lift, overshoot and damped recovery | Residual buoyancy fades into the ongoing idle style |
| Explicit failure | Brief hesitation or recoil, then reorient | Concerned movement style without prolonged shaking |
| Interrupted / unknown | Cancel obsolete gesture; blend to neutral presence | No inferred explanation or emotional claim |

Separate activity from affect: working is not automatically worried; idle is not automatically happy. Initially map existing mood/intensity to a small local energy/softness profile. Later consider validated valence/arousal/attention metadata, rather than expanding a long emotion enum immediately.

Timing proposals for tuning, not literature-derived constants:

- Breath period 3-6 seconds with small smooth variation; root sway smaller than the identifying silhouette features.
- At most one secondary action initially; sampled interval 4-12 seconds, state-dependent eligibility and an explicit refractory interval. Quiet gaps are intentional.
- Eye-bound blink envelope around 100-250 ms; validate against terminal frame cadence and visibility before enabling it by default.
- Attention entry around 200-400 ms; brief anticipatory preparation only when it does not delay acknowledgment.
- Secondary follow-through around 80-180 ms behind primary motion; bounded spring recovery and no sustained oscillation.
- Use seeded, temporally correlated variation and continuous phase. Never choose independent random poses each frame.

## Free-form geometry and ownership

Fisch must remain able to become a face, hand, creature or abstract sculpture. Do not infer anatomy from strings such as `left-eye` or apply eye compression to arbitrary ellipsoids.

Stage one uses geometry-independent root sway/orientation. Stage two adds optional validated motion bindings: part ID, role (eye/ear/appendage or generic), pivot, permitted axes and amplitude limits. No bindings means root-only motion. Existing ASTs remain valid.

Every articulated action checks that bindings reference current parts; topology change drops stale bindings atomically. Stable part IDs preserve phase and particle assignment where compatible. Local offsets never mutate author geometry or accumulate drift.

Semantic gestures own their declared channels. Ambient movement attenuates on owned channels, then blends back after release. Manual `express` pauses semantic inference but allows gentle ambient motion by default; expose explicit still/manual-exact mode. `cancel` ends semantic action and returns smoothly; explicit motion-off freezes all layers. New messages may resume inference under existing rules but must not override user motion-off preference.

Preserve a separate true snapshot/freeze primitive for cancellation cases. Ordinary settling should damp authored gesture energy while retaining topology and ambient capability. Do not simply delete the 30-second branch and leave every authored sine motion running forever.

## Delivery sequence

### Milestone 1: continuous presence, no protocol change

- Implement a renderer-independent local motion controller with seeded clock injection, root pose, smoothed activity/mood targets and reusable state.
- Integrate once into the shared geometry path; keep the scheduler's authoritative semantic baseline separate from sampled ambient output.
- Separate planner pause from ambient pause in the bridge; replace idle hard freeze with a documented settle policy that preserves articulation data.
- Add status fields for ambient mode, effective intensity, active action, suppression reason, reduced motion and last update. Planner errors and movement telemetry remain separate.
- Default conservative intensity, with off/reduced/normal settings. Include terminal support rather than browser-only accessibility handling.
- Deliver a 60-second paired capture: current behavior vs root-only presence, same geometry, seed, events and viewport.

Likely touch points: `integrations/interaction-body.mjs`, `integrations/planner-bridge.mjs`, core geometry/runtime, shared sampling and renderer adapters. Choose the exact interfaces after a small prototype; avoid widening the model schema for this milestone.

### Milestone 2: articulated character

- Add optional motion bindings through geometry types, validation/compiler, formation metadata and planner schema/instructions.
- Implement blink, gaze offset, appendage follow-through and posture recovery using declarative bounded envelopes.
- Preserve stable identity and safely downgrade to root-only presence on missing bindings or invalid planner output.
- Demonstrate the same controller on rabbit, hand and abstract shape; only explicitly available anatomy receives articulated motion.

### Milestone 3: interaction and style

- Shape anticipation, action, hold and recovery around real events; preserve local acknowledgment before inference.
- Tune mood persistence and interruption blending; use attention targets only when actual input exists. No invented eye tracking or speech synchronization.
- Make Braille legibility a separate tuning pass: coherent silhouette motion first, sparse part actions second. Bound amplitude and frequency so it does not become cell flicker.
- Compare gentle and playful profiles and tune for sustained peripheral use, not just an impressive short clip.

### Milestone 4: acceptance and hardening

- Deterministic clock tests for finite bounded poses, continuity across transitions, frame gaps, topology changes, no cumulative drift and no backlog of missed idle actions.
- Regression tests: full day idle still causes zero new inference; stale plans stay rejected; manual/cancel semantics remain explicit; ambient output cannot overwrite gesture-owned channels.
- Accessibility tests cover reduced motion and fully off for both renderers, including per-part authored motion.
- Measure p50/p95 frame time and memory against the same current baseline. Initial budget: motion composition p95 under 1 ms for 2,000 particles on the target machine; validate before promising it. Avoid per-particle allocation and bound secondary actions.
- Thirty-minute soak with repeated resize, interrupt and topology changes. No accumulating timers, bindings or queues.
- Small exploratory blinded A/B (8-12 people; counterbalanced clips) rates liveliness, appropriateness and distraction on 1-7 scales. Working target: median liveliness improvement at least one point without more than 0.5-point distraction increase. These are proposed product gates, not validated scientific thresholds.
- Include idle for 60 seconds, focused work for 2 minutes, rapid prompts, success then failure, long waiting, manual rabbit, abstract geometry and motion-off. Inspect actual Herdr Braille as well as browser recordings.

Implement each milestone in bounded commits; honor the workspace limit of ten changed files before a user commit. Schema expansion should be its own batch if the dependency set exceeds that limit.

## Recommended first slice

Build milestone 1 first: continuous root presence, non-destructive settling, distinct manual/inference/motion pause controls and an A/B capture. This directly addresses the current statue-like idle behavior while leaving free-form geometry and event-only inference intact. Add anatomical behavior after the compositor proves continuity and legibility.

</details>
