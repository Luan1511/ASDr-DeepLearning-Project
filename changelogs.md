# AIMBRACE — Changelogs

## 2026-11-21 — Làm mới thông báo chặn và bỏ chặn

- Thay xác nhận mặc định của trình duyệt bằng hộp thoại đồng bộ AIMBRACE ở hội thoại, danh sách đã chặn và hồ sơ thành viên: biểu tượng, tên người dùng, mô tả tác động, Hủy và nút xác nhận riêng.
- Chặn dùng màu đỏ; bỏ chặn dùng màu xanh. Có trạng thái đang xử lý, lỗi trong hộp thoại và thông báo thành công; khóa thao tác khi đang gửi để tránh bấm lặp.
- Hộp thoại hỗ trợ bàn phím, Escape, focus ban đầu ở Hủy và trả focus về nút mở khi đóng.
- Frontend build/ESLint đạt; Chrome xác nhận Hủy không chặn, xác nhận chặn/bỏ chặn và thông báo thành công trong hộp thư đều hoạt động. Đã xem ảnh giao diện điện thoại 390 px; dữ liệu thử được tự dọn.

## 2026-11-21 — Bỏ chặn trong hộp thư Cộng đồng

- Người đã chặn có nút Bỏ chặn ở đầu hội thoại; bổ sung mục Tài khoản đã chặn trong hộp thư để quản lý cả khi không mở hội thoại.
- Bỏ chặn chỉ xóa lệnh chặn do chính mình tạo; nếu đối phương còn chặn hoặc tài khoản bị tạm ngưng thì vẫn không gửi được tin. Không tự chấp nhận/khôi phục lời mời đã hủy.
- API trả `blockedByMe` để giao diện hiển thị đúng thao tác, không tiết lộ ai chặn phía đối phương. Bỏ chặn dùng cùng khóa giao dịch với gửi tin/chặn.
- Kiểm chứng: typecheck backend và build frontend đạt; kiểm tra API chặn hai chiều/bỏ chặn một phía vẫn không gửi được, Chrome bỏ chặn từ đầu hội thoại và danh sách trong hộp thư đều đạt. Tài khoản thử đã được tự dọn.

## 2026-11-20 — Mở lời mời nhắn riêng từ avatar

- Bấm avatar tác giả bài viết, bình luận hoặc phản hồi của phụ huynh khác để mở lời mời chat; dùng chung luồng gửi lời mời và mở hội thoại hiện có.
- Avatar trong bài viết giữ ngữ cảnh tiêu đề bài; avatar bình luận/phản hồi gửi đúng người viết bình luận, không chuyển nhầm tới chủ bài.
- Avatar của chính mình, admin và nội dung ẩn danh không mở lời mời; bổ sung nhãn và hỗ trợ bàn phím cho avatar có thể bấm.
- Frontend build và kiểm tra Chrome đạt: avatar bài viết, bình luận, phản hồi mở đúng người nhận; avatar chính mình/ẩn danh không có thao tác nhắn riêng. Dữ liệu thử đã được dọn.

## 2026-11-20 — Sửa quyền quản lý bài viết và tự trả lời bình luận

- Chỉ tác giả được sửa bài. Tác giả hoặc admin được xóa; các phụ huynh khác không có quyền sửa/xóa. API trả riêng `canEdit`/`canDelete` cho feed, chi tiết, bài đã lưu và phản hồi tạo/sửa.
- Admin không còn thấy nút sửa/ghim trên bài người khác; API ghim cũng không cho thay đổi bài người khác.
- Ẩn nút Trả lời ở bình luận của chính mình và chặn tự trả lời tại API, kể cả bình luận ẩn danh. Không xóa các phản hồi cũ đã tồn tại.
- Kiểm chứng: backend typecheck, frontend build và script `backend/scripts/checkCommunityPermissions.cjs` đạt; kiểm tra API cùng Chrome cho tác giả/phụ huynh khác/admin, feed/chi tiết/bài đã lưu và bình luận ẩn danh. Dữ liệu thử đã được dọn.

## 2026-11-20 — Chat riêng: kiểm chứng tích hợp và giao diện

- `backend/scripts/checkCommunityChat.cjs` đạt kiểm tra API bằng tài khoản riêng: ẩn danh, lời mời/chấp nhận/từ chối/hủy, gửi trùng đồng thời, phân trang/tải bù tin mới, chưa đọc, quyền sở hữu, giới hạn gửi, chặn/tạm ngưng và quyền riêng tư admin.
- Kiểm tra trên Chrome qua `backend/scripts/checkCommunityChatBrowser.cjs`: lời mời từ bài viết, chấp nhận, gửi/nhận tự cập nhật, Enter/Shift+Enter, báo cáo, chặn, bài ẩn danh không có nút nhắn; desktop 1440 px và điện thoại 390 px không tràn ngang, không có lỗi JavaScript trang.
- Hai script dùng PostgreSQL local cổng 5435, tự tạo và xóa tài khoản thử. Kiểm tra trình duyệt dùng playwright-core cài tạm trong TEMP, không thêm dependency vào dự án.
- Backend typecheck, frontend production build và ESLint cho các thành phần chat mới đều đạt. Không ghi nội dung tin nhắn vào log.

## 2026-11-20 — Chat riêng: hộp thư và kiểm duyệt

- Thêm nút Nhắn riêng tại bài không ẩn danh và hồ sơ thành viên; hộp thư có Trò chuyện/Lời mời, chấp nhận/từ chối/hủy, chặn, tin chưa đọc, tải tin cũ và gửi lại tin lỗi.
- Giao diện desktop chia hai cột, điện thoại xem từng màn. Tự tải tin khi tab đang hiển thị, dừng khi ẩn tab/mất mạng và tăng thời gian chờ khi lỗi; Enter gửi, Shift+Enter xuống dòng, tôn trọng bộ gõ.
- Thông báo lời mời/chấp nhận dẫn đến hội thoại; không tạo thông báo riêng cho từng tin mới. Đánh dấu đọc dựa trên tin đã hiển thị trong khung chat.
- Báo cáo tin nhận được gửi bản sao đúng tin đó tới admin; hàng chờ thêm lọc tin nhắn, ẩn/khôi phục, tạm ngưng người gửi và lịch sử xử lý; không có API admin duyệt hội thoại riêng.

## 2026-11-20 — Chat riêng: dữ liệu, API và quyền truy cập

- Thêm hội thoại riêng 1–1, lời mời có lời nhắn giới thiệu, chấp nhận/từ chối/hủy và trạng thái đọc theo tin cuối đã hiển thị; phân trang hội thoại/tin nhắn.
- Chỉ phụ huynh được dùng chat; bài ẩn danh/đã ẩn không cho bắt đầu trò chuyện. Kiểm tra thành viên, chặn hai chiều và tạm ngưng ngay khi ghi tin; dùng khóa giao dịch chung với chặn/kiểm duyệt.
- Chống gửi trùng bằng mã yêu cầu; giới hạn 10 lời mời/24 giờ và 20 tin/phút. Tái sử dụng một hội thoại cho mỗi cặp phụ huynh.
- Đã áp dụng migration `20261120170000_community_direct_messages` vào PostgreSQL local cổng 5435; dữ liệu cộng đồng hiện có được giữ lại.

## 2026-11-20 — Bổ sung giao diện và lịch sử Bác sĩ cho pilot

- Danh bạ hiển thị nhãn xác minh cho bác sĩ thật, phạm vi/hạn quyền theo từng trẻ và liên kết quản lý chia sẻ.
- Cổng bác sĩ thêm tìm kiếm theo trẻ/phụ huynh, lọc quyền hết hạn trong 7 ngày hoặc không thời hạn, hiển thị hạn quyền trên danh sách và hồ sơ chi tiết.
- Hồ sơ trẻ thêm lịch sử cấp quyền, thu hồi, hết hạn và truy cập; có phân trang và tải lại. API kiểm tra quyền sở hữu hồ sơ trẻ trước khi trả lịch sử.
- Trang quản trị thêm tìm kiếm, lọc trạng thái xác minh/hoạt động, chi tiết chuyên môn, xác nhận trước thay đổi và lịch sử người xử lý/thời điểm/trạng thái trước-sau.
- Bổ sung migration `20261120160000_doctor_management_events`, đã áp dụng vào PostgreSQL local `localhost:5435`. Lịch sử quản trị bắt đầu ghi từ phiên bản này; không tạo lại sự kiện cũ.
- API không cho kích hoạt bác sĩ chưa xác minh. Không lưu giấy tờ; giữ chế độ demo hiện tại.
- Kiểm chứng: backend typecheck và frontend production build đạt; script `backend/scripts/checkDoctorPilot.cjs` kiểm tra trực tiếp API lời mời/xác minh/kích hoạt/danh bạ/phạm vi/thu hồi/hết hạn/lịch sử và quyền sở hữu trên local. Dữ liệu thử tự dọn sau khi chạy.

## 2026-11-20 — Bỏ nhóm tham gia khỏi Cộng đồng

- Gỡ danh sách nhóm, nút tham gia/rời nhóm và bộ lọc nhóm trên trang Cộng đồng.
- Bài mới được đăng vào feed chung, không cần tham gia nhóm; giữ bộ lọc và theo dõi chủ đề.
- Ngừng gọi API nhóm từ giao diện; giữ dữ liệu nhóm cũ trong database.

## 2026-11-20 — Thu gọn ảnh trong bài đăng Cộng đồng

- Dùng chung lưới ảnh ở feed và trang chi tiết: cao 256 px trên điện thoại, 320 px trên desktop; tối đa rộng 672 px.
- Xếp 2 ảnh cạnh nhau, 3 ảnh theo bố cục một ảnh lớn và hai ảnh nhỏ, 4 ảnh theo lưới 2×2. Ảnh phủ ô, không kéo dài bài theo tỷ lệ ảnh gốc.
- Bấm ảnh để mở bản đầy đủ trong tab mới.

## 2026-11-20 — Sửa tải ảnh từ backend đang chạy phiên bản cũ

- Chuẩn hóa URL ảnh `/api/community/...` về đường dẫn tương đối với API base để tránh gọi nhầm `/api/api/community/...`.
- Kiểm tra ba ảnh đã đăng: file còn trên máy chủ, endpoint có xác thực trả HTTP 200 và định dạng WebP.

Nhật ký thay đổi source code, logic xử lý, giao diện, database và triển khai của dự án. Mục mới nhất đặt ở đầu file. Một ngày có thể có nhiều mục nếu các đợt cập nhật được triển khai riêng.

Các mục lịch sử khởi tạo được tổng hợp từ `master_prompt.md` và source hiện tại. Ngày cập nhật code và ngày triển khai được ghi riêng khi có thông tin. Kết quả kiểm thử thuộc lần thực hiện được nêu trong từng mục.

## 2026-11-21 — Mở bài tập vận động cho phụ huynh

- Git: commit `9c58b3e` (toàn bộ thay đổi đang có ở máy dev, bỏ qua mẫu giọng và dữ liệu ASR qua `.gitignore`), merge `origin/master` (đã chứa PR #1 `Vanlam/develop` của Lâm: cộng đồng, nhắn riêng giữa phụ huynh, quản lý bác sĩ) thành `68a47be`; xung đột duy nhất ở cuối `schema.prisma` (giữ cả model Kinect và enum của Lâm). Thêm `ee260b7`: `frontend/nginx.conf` có header nâng cấp WebSocket như bản trên `khmt01`. Đã push lên `origin/master` bằng tài khoản Luan1511. Sau merge: backend 450/453 test (3 lỗi gait cũ), frontend 118 test và build sạch; e2e 48/53 — ngoài lỗi lệch `ChatConversation.updatedAt` đã biết, 4 kịch bản lỗi do thay đổi của Lâm chưa cập nhật test (doctor e2e 5 và 10: API chia sẻ nay trả thêm `expiresAt`/`scopes`, danh sách bác sĩ đổi; e2e 11 và exercise 17: DB "cũ" thiếu cột `User.communitySuspendedAt`).
- Đã triển khai lên `khmt01`: sao lưu database và 36 file tại `~/Luan_workspace/asdr/diagnostics/exercises-lam-merge-20261121/`; chép 67 file, build lại backend (có `sharp`) và frontend; ba migration của Lâm tự áp dụng, backend healthy, `EXERCISE_MODE=on`. Kiểm tra bằng tài khoản phụ huynh demo: `/exercises` trả 3 bài, cộng đồng, tin nhắn, bác sĩ, Kinect trả 200; không có phản hồi 5xx trong log.

- Theo yêu cầu của chủ dự án, `EXERCISE_MODE` mặc định đổi từ `admin_only` sang `on` (`backend/src/lib/env.ts`); `docker-compose.yml` truyền `EXERCISE_MODE: ${EXERCISE_MODE:-on}`; hai `.env.example` ghi `EXERCISE_MODE=on`. Phụ huynh thấy mục "Bài tập" ở thanh bên và trong hồ sơ trẻ, tập được các bài đã xuất bản (trên `khmt01`: `high-kicks`, `jump-twists`, `jumping-jack`). Nút tải bản ghi webcam vẫn chỉ dành cho quản trị viên. Trang quản trị bài tập cập nhật mô tả chế độ.
- Lưu ý: master_prompt từng đặt cổng hiệu chỉnh C1 trên bản ghi người lớn trước khi mở cho phụ huynh; quyết định mở là của chủ dự án.
- Kiểm chứng: backend typecheck và `exerciseInput.test.ts` (18 test) sạch; frontend `tsc -b`, ESLint sạch.

## 2026-11-21 — Sàng lọc chuyển sang trạm Kinect; tạm ngưng sàng lọc bằng video OpenPose

- Đã triển khai lên `khmt01` ngày 21/11 cùng đợt (sàng lọc Kinect, một trẻ mỗi phụ huynh, tranh minh hoạ của Bin): sao lưu database (`pg_dump`) và 35 file cũ tại `~/Luan_workspace/asdr/diagnostics/one-child-kinect-20261121/`; chạy `prisma/manual/20261121_move_second_demo_child.sql` (đã thêm dòng chuyển `KinectSession`), `user2@asdr.local` nhận trẻ `22222222-…` cùng 8 video và 1 đồng ý; build lại backend và frontend, migration `20261121_one_child_per_parent` tự áp dụng, backend healthy. Kiểm tra trên server: phụ huynh nhận `videoScreening:false` và 503 khi tải video, quản trị được phép; thêm trẻ thứ hai trả 409 `CHILD_LIMIT_REACHED`; `/kinect/devices` trả danh sách trống (chưa có trạm ghép với tài khoản demo); trang `/`, `/screening` và file nhạc trả 200; bundle có giao diện mới.


- Đồng bộ code Kinect từ `khmt01` (do phiên khác làm trực tiếp trên server) về máy dev: migration `20261120_kinect_sessions`, `lib/kinectData.ts`, `routes/kinect.ts`, `services/kinectProcessor.ts`, `kinectService.ts`, `kinectSocket.ts`; frontend `lib/kinect.ts`, `KinectSkeleton`, `KinectResultView`, `KinectHistory`, `KinectPage`. Gộp tay `schema.prisma`, `routes/children.ts`, `HistoryPage.tsx` với thay đổi một-trẻ của máy dev.
- Backend: biến mới `VIDEO_SCREENING` (`off` | `admin_only` | `on`, mặc định `admin_only`; đã thêm vào `docker-compose.yml` và hai `.env.example`). Khi không được phép, `POST /screenings/upload` và `POST /screenings/:id/process` trả 503 `VIDEO_SCREENING_DISABLED`; xem và xoá kết quả cũ vẫn dùng được. `GET /screenings/capabilities` cho giao diện biết.
- Frontend: trang `/screening` nay là luồng Kinect cho phụ huynh: (1) kết nối trạm — tự chọn trạm sẵn sàng, báo lỗi bằng lời dễ hiểu (ngoại tuyến, chưa thấy cảm biến, chưa bật điều khiển từ website, hệ thống trạm gián đoạn), ghép trạm nằm trong mục thu gọn; (2) đồng ý của phụ huynh; (3) ghi dáng đi với khung xương trực tiếp, báo số khớp cảm biến thấy rõ, hướng dẫn đặt cảm biến (cao ~0,75 m, trẻ đi từ ~4 m về phía cảm biến, theo giao thức bộ dữ liệu Kinect), đồng hồ đếm giây; (4) bấm "Dừng và phân tích" là tự gửi phân tích cả bản ghi, hiện kết quả bằng lời ("Dáng đi có điểm nên theo dõi thêm" / "Chưa thấy khác biệt đáng chú ý"), kèm lưu ý không phải chẩn đoán và đường tới bảng hỏi, bác sĩ. Cắt đoạn theo frame, phân tích lại đoạn khác, phiếu từng model và JSON chỉ còn trong "Công cụ kỹ thuật (quản trị)". `/screening/kinect` vẫn mở được cùng luồng.
- Trang chủ: thay khung tải video bằng thẻ "Bắt đầu sàng lọc dáng đi" và danh sách lượt Kinect. Khung tải video (OpenPose) chỉ hiện khi máy chủ còn cho phép (quản trị viên ở chế độ `admin_only`). Bài tập vận động vẫn dùng OpenPose như cũ.
- Sandbox (`npm run sandbox`): trẻ thứ hai chuyển sang phụ huynh B cho đúng quy tắc một trẻ.
- Kiểm chứng: e2e kịch bản 1 có thêm kiểm tra cờ (phụ huynh nhận 503, quản trị được phép, lịch sử vẫn đọc được). Frontend `tsc -b`, ESLint các file Kinect, 118 test và `npm run build` sạch; backend typecheck `src` sạch. Xem trong trình duyệt tích hợp với sandbox: trang sàng lọc, xác nhận đồng ý và trang chủ hiển thị đúng. Chưa thử với trạm Kinect thật (máy dev không có gateway), nên phần ghi, tự phân tích và hiển thị kết quả chưa được chạy thực tế.

## 2026-11-21 — Mỗi tài khoản phụ huynh quản lý một trẻ

- Đã triển khai lên `khmt01` ngày 21/11 cùng đợt (sàng lọc Kinect, một trẻ mỗi phụ huynh, tranh minh hoạ của Bin): sao lưu database (`pg_dump`) và 35 file cũ tại `~/Luan_workspace/asdr/diagnostics/one-child-kinect-20261121/`; chạy `prisma/manual/20261121_move_second_demo_child.sql` (đã thêm dòng chuyển `KinectSession`), `user2@asdr.local` nhận trẻ `22222222-…` cùng 8 video và 1 đồng ý; build lại backend và frontend, migration `20261121_one_child_per_parent` tự áp dụng, backend healthy. Kiểm tra trên server: phụ huynh nhận `videoScreening:false` và 503 khi tải video, quản trị được phép; thêm trẻ thứ hai trả 409 `CHILD_LIMIT_REACHED`; `/kinect/devices` trả danh sách trống (chưa có trạm ghép với tài khoản demo); trang `/`, `/screening` và file nhạc trả 200; bundle có giao diện mới.


- Database: migration `20261121_one_child_per_parent` đổi index `ChildProfile.userId` thành unique; Prisma `User.child` thành quan hệ một-một. Trước khi chạy migration trên `khmt01` phải chạy `backend/prisma/manual/20261121_move_second_demo_child.sql` (theo lựa chọn của chủ dự án: chuyển trẻ `22222222-…` cùng video, đồng ý, bài tập, bảng hỏi, chia sẻ bác sĩ sang tài khoản demo mới `user2@asdr.local`, cùng mật khẩu với `user@asdr.local`; không xoá gì). Seed tạo sẵn `user2@asdr.local`.
- Backend: `POST /children` trả 409 `CHILD_LIMIT_REACHED` khi tài khoản đã có trẻ (kể cả khi hai yêu cầu đến cùng lúc).
- Frontend: trang hồ sơ trẻ ẩn nút thêm khi đã có trẻ; các trang sàng lọc, bài tập, bảng hỏi, bác sĩ, lịch sử, Bin tự chọn trẻ duy nhất và chỉ hiện ô chọn khi tài khoản cũ còn nhiều trẻ.
- Kiểm chứng: e2e tách mỗi kịch bản một phụ huynh (`newParent` trong harness).

## 2026-11-21 — Bin giơ tranh minh họa khi trò chuyện; bài hát còn 1 phút

- Đã triển khai lên `khmt01` ngày 21/11 cùng đợt (sàng lọc Kinect, một trẻ mỗi phụ huynh, tranh minh hoạ của Bin): sao lưu database (`pg_dump`) và 35 file cũ tại `~/Luan_workspace/asdr/diagnostics/one-child-kinect-20261121/`; chạy `prisma/manual/20261121_move_second_demo_child.sql` (đã thêm dòng chuyển `KinectSession`), `user2@asdr.local` nhận trẻ `22222222-…` cùng 8 video và 1 đồng ý; build lại backend và frontend, migration `20261121_one_child_per_parent` tự áp dụng, backend healthy. Kiểm tra trên server: phụ huynh nhận `videoScreening:false` và 503 khi tải video, quản trị được phép; thêm trẻ thứ hai trả 409 `CHILD_LIMIT_REACHED`; `/kinect/devices` trả danh sách trống (chưa có trạm ghép với tài khoản demo); trang `/`, `/screening` và file nhạc trả 200; bundle có giao diện mới.


- Bài "Một con vịt": cắt lại từ file gốc chủ dự án gửi, giữ 60 giây đầu, nhỏ dần 2 giây cuối, 128 kbps (0,96 MB) tại `frontend/public/buddy-music/mot-con-vit.mp3`.
- Kịch bản của Bin có thêm `prop`, chỉ nhận giá trị trong danh mục `BUDDY_PROPS`: `house`, `cat`, `dog`, `duck`, `flower`, `sun`, `rain`, `star`, `heart`, `ball`, `car`, `train` (backend `buddyScript.ts` và frontend `lib/buddy/types.ts`, cần giữ hai danh mục khớp nhau). Prompt liệt kê các tranh và dặn chỉ thêm đúng một khi câu chuyện nhắc tới thứ đó.
- `frontend/src/components/buddy/BuddyProps.tsx`: 12 tranh SVG tự vẽ cùng kiểu con vịt, mỗi tranh một chuyển động. Mèo, chó, vịt đi qua lại (mèo, chó vẫy đuôi); ô tô, tàu chạy ngang, bánh quay, tàu nhả khói; bóng nảy; mặt trời xoay tia và toả sáng; mây lắc, mưa rơi; sao lấp lánh; tim đập và bay lên; hoa đung đưa; nhà nhún nhẹ, ống khói nhả khói. Tranh hiện khi Bin bắt đầu nói câu có `prop`, ẩn sau 8 giây; lượt mới thay tranh; khi phát nhạc thì nhường chỗ cho đàn vịt.
- Kiểm chứng: thêm test backend cho `prop` (25 test Bin) và test frontend `lib/buddy/props.test.ts` (đủ tranh cho danh mục; `normalizeScript` bỏ giá trị lạ). Render cả 12 tranh và chụp trong trình duyệt tích hợp; sửa ô tô đang chạy lùi (lật ngang hình). Frontend `tsc -b`, ESLint, 118 test và `npm run build` sạch; backend typecheck `src` sạch. Chưa gọi Groq để xem model có chọn tranh đúng lúc không.

## 2026-11-20 — Đàn vịt nhảy cạnh Bin; bỏ dòng thông báo trước nút mic

- Đã triển khai lên `khmt01` (chỉ build lại frontend). Chép 3 file; bản cũ và `voice.test.ts` (đã gỡ ở máy dev) được chuyển vào `~/Luan_workspace/asdr/diagnostics/duck-flock2-20261120/`. Bản build `BuddyPage` có đàn vịt mới và không còn câu thông báo; trang `/buddy` trả HTTP 200.

- `frontend/src/components/buddy/BuddyDuck.tsx`: bỏ đàn vịt chạy ngang (2,2 giây, hai lần). Nay 6 con vịt cùng lạch bạch qua lại cạnh Bin như con vịt chính trước đây. Mỗi con có quãng đường, tốc độ (8,5–13 giây mỗi vòng), kích thước, độ cao, nhịp nhảy và lúc xuất phát riêng; ba con có bong bóng "Quạc!". Các thông số chọn sẵn, không dùng `Math.random` khi render. Đã chụp trong trình duyệt tích hợp ở hai thời điểm cách nhau 3 giây.
- `frontend/src/pages/BuddyPage.tsx`: theo yêu cầu, xoá câu "Phụ huynh có thể bật mic để Bin tự nghe từng lượt…" (có nhắc gửi âm thanh tới Deepgram và bản chép lời tới Groq); nút "Bật mic rảnh tay" giữ nguyên. Gỡ `buddyMicNotice` trong `lib/buddy/voice.ts` và `lib/buddy/voice.test.ts`. Trang Bin không còn nơi nào báo việc gửi âm thanh tới Deepgram; nên đưa thông tin này vào trang khác.
- Kiểm chứng: frontend `tsc -b`, ESLint, 116 test và `npm run build` sạch.

## 2026-11-20 — Đàn vịt chạy ngang khi Bin mở nhạc

- Đã triển khai lên `khmt01` (chỉ build lại frontend; bản cũ của `BuddyDuck.tsx` tại `~/Luan_workspace/asdr/diagnostics/duck-flock-20261120/`). Bản build `BuddyPage` có hiệu ứng `flock-dash`; trang `/buddy` trả HTTP 200.

- `frontend/src/components/buddy/BuddyDuck.tsx`: khi bài hát bắt đầu, một đàn 6 con vịt đeo kính râm chạy nhanh từ trái sang phải ngang cả màn hình trong 2,2 giây, lệch nhịp nhau; khoảng giây thứ 20 chạy qua thêm một lần. Con vịt nhảy cạnh Bin xuất hiện sau lượt chạy đầu. Hình con vịt tách thành `DuckSvg` dùng chung. Khi hệ điều hành bật giảm chuyển động, đàn vịt không chạy qua.
- Kiểm chứng: render riêng component và chụp trong trình duyệt tích hợp ở 0,5 s, 1,2 s và 3 s (đàn vịt đang chạy ngang; sau đó con vịt chính xuất hiện). Frontend `tsc -b`, ESLint, 118 test và `npm run build` sạch.

## 2026-11-20 — Bin chào bố mẹ nhanh hơn, không lặp; Bin mở nhạc "Một con vịt"

- Đã triển khai lên `khmt01`: chép 13 file (10 file cũ sao lưu tại `~/Luan_workspace/asdr/diagnostics/buddy-song-20261120/`), build rồi tạo lại backend và frontend; backend healthy. File nhạc trên tên miền trùng MD5 với máy dev (`audio/mpeg`); bản build `BuddyPage` có nút "Dừng nhạc". Gọi `buddyReply` trên server: "Bin ơi mở nhạc đi" trả `song: mot-con-vit` với câu "Được rồi, nghe bài "Một con vịt" nào, cùng nhảy nhé!"; "con thích ăn kem dâu" không có `song`. Chưa thử trọn luồng trên trình duyệt.

- Chào bố/mẹ: `ARRIVAL_STABLE_MS` 3000 → 1000 ms, `ARRIVAL_GAP_MS` 1000 → 600 ms. Người đã được chào được lưu theo lịch sử trò chuyện của bé (`loadGreetedParents` / `rememberGreetedParent` trong `frontend/src/lib/buddy/history.ts`). Tải lại trang hay bật lại camera không chào lại; "Xóa lịch sử" xoá cả danh sách này. Chỉ ghi nhớ khi Bin chào xong (`respond` nay trả kịch bản đã nói, hoặc `null`).
- Mở nhạc: kịch bản của Bin có thêm `song` (danh mục `mot-con-vit`). Prompt dặn chỉ chọn khi bé muốn nghe nhạc, muốn Bin hát, muốn nhảy hoặc nhắc tới bài; câu nói là một lời rủ ngắn, không viết lời bài hát. Frontend phát `public/buddy-music/mot-con-vit.mp3` sau câu nói (`lib/buddy/song.ts`). Mic tạm tắt vì lượt chưa kết thúc. Bin lặp động tác `dance`. Âm lượng 0,9, hoặc 0,5 khi bé nhạy cảm với âm thanh. Có nút "Dừng nhạc"; gõ hay nói lượt mới, hoặc rời trang, cũng dừng nhạc. Trạng thái mới `music`: "Bin đang mở nhạc".
- File nhạc do chủ dự án cung cấp (`Chu-Vit-Con.mp3`, tiêu đề "Chú Vịt Con - Nhạc Thiếu Nhi - Một Con Vịt - Hoạt Hình Một Con Vịt", 5 phút 31 giây); quyền dùng bản thu do nhóm xác nhận. Đã nén lại 128 kbps, bỏ metadata, còn 5,3 MB.
- Con vịt: `components/buddy/BuddyDuck.tsx`, SVG tự vẽ (vịt vàng đeo kính râm), lạch bạch qua lại cạnh Bin, nhún theo nhạc, nhảy lên với bong bóng "Quạc!", có nốt nhạc bay; dịu chuyển động khi hệ điều hành bật giảm chuyển động. Đã render riêng và chụp trong trình duyệt tích hợp: hình hiển thị đúng và di chuyển.
- Kiểm chứng: thêm test lưu người đã chào và test `song` (backend 24 test Bin). Frontend `tsc -b`, ESLint, 118 test và `npm run build` sạch. Backend typecheck `src` sạch. Chưa gọi Groq với yêu cầu mở nhạc, chưa thử trọn luồng trên trang Bin.

## 2026-11-20 — Bạn Bin chào khi bố hoặc mẹ ngồi cùng bé

- Đã triển khai lên `khmt01`: chép 8 file (6 file cũ sao lưu tại `~/Luan_workspace/asdr/diagnostics/buddy-arrival-20261120/`), build rồi tạo lại backend và frontend. Backend healthy; bản build có `eventPrompt` và `BuddyPage` mới. Gọi `buddyReply` trong container với sự kiện bố đến: "Em đang ngồi cùng bố đấy à, ôm bố một cái nhé!". Chưa thử bằng camera và khuôn mặt thật.

- Trước đây Bin chỉ nói sau lượt của bé, và prompt dặn không tự nhắc người có mặt. Nay khi camera đang bật, `ArrivalWatcher` (`frontend/src/lib/buddy/presence.ts`) phát hiện bé và bố (hoặc mẹ) cùng được nhận ra bằng khuôn mặt đã đăng ký liên tục 3 giây (mất dấu dưới 1 giây vẫn tính). Mỗi người được chào tối đa một lần trong mỗi lần bật camera; người lạ (`unknown`) không tính.
- `BuddyCamera` gọi `onArrival`. `BuddyPage` chỉ cho Bin lên tiếng khi đang rảnh (không nghĩ, nói, ghi âm hay sửa lời); lời chào chờ tối đa 30 giây. Lượt `arrival` không thêm lời của bé vào lịch sử; nếu dịch vụ chat lỗi thì Bin im lặng. Có mic thì Bin nói thành tiếng như lượt thường.
- Backend: request chat nhận `event: { type: 'arrival', role: 'mother' | 'father' }`, được gửi khi chưa có tin nhắn. `eventPrompt` dặn Bin nói một hai câu: nhận ra bé đang ngồi cùng bố/mẹ (cạnh bé, không phải cạnh Bin), chào và rủ một việc nhỏ cùng bố/mẹ. Code chọn hoạt động: bé nhạy cảm khi bị chạm thì chỉ vẫy tay hoặc khoe đồ chơi, không ôm hay đập tay; bình thường thì ôm, đập tay hoặc khoe đồ chơi. Groq nhận thêm một lượt user đánh dấu không phải lời của bé.
- Thử với Groq (`openai/gpt-oss-120b`) qua server. Bản prompt đầu nói "bố ngồi cạnh mình" và một lần vẫn rủ bé nhạy cảm chạm "ôm bố", nên đã sửa. Bản cuối, 4 tình huống: "Em đang ngồi bên bố đấy à, ôm bố một cái nhé!", "Em đang ngồi cùng mẹ mà, ôm mẹ một cái nhé!", "Em đang ngồi cùng bố đấy à, vẫy tay chào bố nhé!" (bé nhạy cảm khi bị chạm), "Em đang ngồi cùng bố đấy à, ôm bố một cái nhé!". Còn gần như chép câu ví dụ, chưa nối vào trò chơi đang dở, chưa gọi tên ở nhà. Một lần thử vượt giới hạn 8.000 token/phút của gói Groq.
- Kiểm chứng: thêm 4 test `presence` và 3 test sự kiện ở backend. Frontend `tsc -b`, ESLint, 117 test và `npm run build` sạch. Backend typecheck `src` sạch; 450 unit test với 3 test dáng đi lỗi từ trước. Chưa thử bằng camera và khuôn mặt thật.

## 2026-11-20 — Bố cục Trợ lý AI dễ đọc hơn

- Trang `/assistant` dùng phần chiều cao còn lại của màn hình, ô nhập luôn nằm ở dưới. Câu trả lời mới hiện từ đầu thay vì cuộn xuống cuối danh sách nguồn. Nguồn gom vào một hàng "Tài liệu tham khảo · N nguồn" có thể mở ra. Card Trợ lý AI ở trang chủ có nút "Mở hội thoại đầy đủ" dẫn tới `/assistant`. File: `frontend/src/pages/AssistantPage.tsx`, `frontend/src/components/AIAssistantCard.tsx`, `frontend/src/components/ChatMessageContent.tsx`, `frontend/src/layouts/DashboardLayout.tsx`.
- Phiên làm trước đã thử trên Chrome (câu trả lời dài nhiều nguồn, giao diện điện thoại không tràn ngang) và chép file lên `khmt01` trước khi dừng giữa chừng. Kiểm tra lại: 4 file trên server giống máy dev; image frontend được build 11 giây sau khi chép file (22:43:24 giờ server); tên miền phục vụ `index-DvuaS-YB.js` có giao diện mới. Frontend `tsc -b`, ESLint, 113 test và `npm run build` sạch. Không tìm thấy `install_server.py` của phiên trước trong repo hay thư mục người dùng.

## 2026-11-20 — Sửa ngưỡng nhắc "đá cao hơn" và thêm nhắc khi đứng im

- Đã triển khai lên `khmt01` (chỉ build lại frontend; bản cũ của `rules.ts` và `rules.test.ts` trong `~/Luan_workspace/asdr/diagnostics/coach-cues2-20261120/`). `move.wav` trên tên miền trùng MD5 với máy dev; bản build `ExercisePracticePage` chứa lời nhắc mới.

- Chủ dự án thử High-Kicks: cố tình đứng im và đá thấp nhưng không nghe lời nhắc nào. Nguyên nhân: "đá cao hơn" chỉ bắt các lần nhấc dưới ngưỡng cú đá (0,14 chiều dài thân, khoảng 5–7 cm), nên đá thấp thật vẫn được tính là cú đá đạt; và chưa có lời nhắc khi đứng im.
- Đo trên video mẫu High-Kicks (mẫu v2, `tpl_7bcbf461…`): đỉnh 32 cú đá từ 2,2 đến 2,8 chiều dài thân (trung vị 2,5); 11 lần xê dịch chân từ 0,15 đến 0,27.
- `rules.ts`: ghi độ cao lớn nhất của mỗi cú đá. Dưới `lowKick` 0,35 coi là xê dịch chân và bỏ qua; từ 0,35 đến dưới `highKick` 1,0 (bàn chân khoảng ngang hông, 40% người mẫu) là đá thấp; hai cú đá thấp liên tiếp (cách nhau ≤ 4 giây) thì nhắc "đá cao hơn". "Đổi chân" vẫn ưu tiên trước. Bỏ nhánh xử lý lần nhấc dưới ngưỡng cú đá cũ.
- Thêm lời nhắc "Con đá chân lên nào!" (`move`): đứng trong khung hình 6 giây không nhấc chân; lặp tối đa mỗi 12 giây. Tạo `move.wav` bằng `buddy_voice/coach_clips.py` (Gipformer đọc lại khớp lời).
- Kiểm chứng: thêm test cho ngưỡng độ cao và cho lời nhắc khi đứng im; test cú đá mặc định đổi từ 0,5 thành 1,2. Đưa chuyển động chân của video mẫu qua bộ luật ở 10 Hz: không lời nhắc nào, 1 lời khen. Khi hạ mọi cú đá xuống 30% (đỉnh khoảng 0,75): 16 lần "đá cao hơn" trong khoảng 1 phút, trước khi qua giới hạn 6,5 giây trên trình duyệt. Frontend `tsc -b`, ESLint, 113 test và `npm run build` sạch. Chưa thử bằng camera thật.

## 2026-11-20 — Thêm lời nhắc khi tập High-Kicks

- Vì sao trước đây gần như không có nhắc: trên `khmt01`, chỉ `high-kicks` (mẫu v2) có dạng bài; `jump-twists` và `jumping-jack` (mẫu v1) chưa gán dạng bài nên không có nhắc. Chủ dự án sẽ xem xét hai bài này sau. Với High-Kicks, trước đây chỉ có một lời nhắc "đổi chân".
- `frontend/src/lib/exerciseCoach/rules.ts` thêm hai lời nhắc:
  - "Con thử đá chân cao hơn chút nữa nhé!" (`higher`): hai lần nhấc chân liên tiếp từ tư thế đứng, cao ít nhất `lowKick` 0,09 chiều dài thân nhưng chưa tới ngưỡng cú đá 0,14, kéo dài ít nhất 180 ms và cách nhau không quá 4 giây. Một cú đá đủ cao xoá bộ đếm.
  - "Con lùi ra một chút để Bin thấy cả người nhé!" (`frame`): thấy đúng một người nhưng có khớp cần thiết bị khuất hoặc sát mép (`outOfFrame`) liên tục 2 giây; mỗi 10 giây nhắc tối đa một lần. Không nhắc khi có hai người trong hình hoặc khi trẻ đứng quay ngang.
- Khoảng cách giữa các lời nhắc vẫn là 6,5 giây (`CoachPacer`). `PROFILE_CUES` liệt kê mọi lời nhắc của từng dạng bài; `useLiveCoach` nạp mỗi lời nhắc một file `public/exercise-coach/<cue>.wav`.
- Âm thanh: thêm `buddy_voice/coach_clips.py`; tạo lại `alternate.wav` và tạo mới `higher.wav`, `frame.wav` bằng giọng Bin hiện tại (Quỳnh Anh, +1,5 bán cung, nhanh hơn 5%; PCM 16-bit, 48 kHz, mono). Gipformer đọc lại khớp lời của cả ba file. Giữ nguyên `cross.wav` và `open.wav`.
- Kiểm chứng: thêm test cho hai lời nhắc mới và cho việc mọi lời nhắc đều có file âm thanh; sửa kỳ vọng của test ngưỡng cú đá (hai lần nhấc dưới ngưỡng nay ra `higher`). Frontend `tsc -b`, ESLint, 110 test và `npm run build` sạch. Chưa thử bằng camera thật.
- Đã triển khai lên `khmt01` (chỉ build lại frontend). Chép 7 file; bản cũ của 4 file code và `alternate.wav` lưu tại `~/Luan_workspace/asdr/diagnostics/coach-cues-20261120/`. Ba file âm thanh trên tên miền trùng MD5 với máy dev; bản build `ExercisePracticePage` chứa lời nhắc mới.

## 2026-11-20 — Giảm độ trễ lượt nói của Bạn Bin

- Chủ dự án thấy Bin đáp chậm sau khi chuyển sang Deepgram. Đo trên `khmt01`: Groq (`openai/gpt-oss-120b`) 509–933 ms, trung vị 678 ms qua 6 lượt; Deepgram trung vị 342 ms, p90 1003 ms; tiếng đầu của Bin khoảng 290 ms. Khâu dài nhất là chờ 1,1 giây im lặng để chốt lượt nói.
- `frontend/public/buddy-mic.worklet.js`: `SILENCE_FRAMES` 55 → 35, tức 0,7 giây im lặng là chốt lượt; tiết kiệm khoảng 0,4 giây mỗi lượt. Đổi lại, trẻ ngập ngừng giữa câu lâu hơn 0,7 giây sẽ bị chốt sớm. README `buddy_voice` đã sửa theo.
- Đã triển khai lên `khmt01` (chỉ build lại frontend; bản cũ trong `~/Luan_workspace/asdr/diagnostics/turn-silence-20261120/`). Tên miền phục vụ worklet có `SILENCE_FRAMES = 35`; trang `/buddy` trả HTTP 200. File worklet không có mã băm trong tên, nên cần tải lại trang bằng Ctrl+F5. Chưa đo lại độ trễ trên trình duyệt thật.

## 2026-11-20 — Triển khai Deepgram cho Bạn Bin, thêm khoảng lặng trước khi gửi

- Đã triển khai lên `khmt01` lúc khoảng 14:35 UTC: chủ dự án thêm `DEEPGRAM_API_KEY` vào `~/Luan_workspace/asdr/repo/.env`; chép 11 file (bản cũ trong `~/Luan_workspace/asdr/diagnostics/deepgram-stt-20261120/`), build và tạo lại backend, frontend. Container backend nhận được khoá; bản build frontend có thông báo nhắc tới Deepgram.
- Thử thật trên server với 75 đoạn TTS (25 câu × 2 giọng sạch, 25 câu giống giọng trẻ), gửi qua stdin, không lưu file. Lúc đầu Nova-3 trả rỗng 38/75 đoạn và hay mất chữ đầu câu (37% lỗi từ khi sạch). Khi thêm 0,5 giây im lặng ở hai đầu: Nova-3 còn 3,0% (sạch) và 3,7% (giống giọng trẻ), không đoạn rỗng; Nova-2 có khoảng lặng vẫn 15,6% và 20,0%. Gipformer trên cùng bộ đạt 3,7% và 3,7%.
- Thêm `padWavSilence` trong `backend/src/services/deepgramStt.ts`: chèn 500 ms im lặng vào hai đầu WAV PCM 16-bit mono (header 44 byte như trang Bin gửi); định dạng khác gửi nguyên. Thêm 2 test. Đã triển khai lại backend; chạy lại 75 đoạn không đệm qua bản đã triển khai: 3,0% và 3,7% lỗi từ, không đoạn rỗng, thời gian trung vị 342 ms (p90 1003 ms).
- Lỗi còn lại trên bộ thử: "Bin" thành "nhìn" hoặc "pin", "con" thành "còn". Bộ thử là giọng TTS người lớn; chưa thử bằng giọng thật trên trình duyệt.

## 2026-11-20 — Bạn Bin nhận dạng giọng nói bằng Deepgram (chưa triển khai)

- Chủ dự án quyết định thay Gipformer vì nghe kém trong điều kiện thật, và chọn Deepgram. Theo tài liệu Deepgram, Nova-3 và Nova-2 hỗ trợ tiếng Việt (`vi`). Giá trả theo dùng của Nova-3 gửi từng file là 0,0043 USD/phút; tài khoản mới được 200 USD dùng thử, không hết hạn.
- Backend: khi có `DEEPGRAM_API_KEY`, `POST /api/buddy/voice/transcribe` gửi WAV tới `https://api.deepgram.com/v1/listen?model=nova-3&language=vi&smart_format=true&mip_opt_out=true` (`backend/src/services/deepgramStt.ts`). `mip_opt_out=true` đưa request ra khỏi chương trình huấn luyện model; theo tài liệu, âm thanh chỉ được giữ trong lúc xử lý. Lỗi 429 trả `BUDDY_VOICE_BUSY`, 400/413 trả `BUDDY_VOICE_INVALID_INPUT`, lỗi khác trả `BUDDY_VOICE_UNAVAILABLE`. Thời gian chờ mặc định 15 giây. Không có khoá thì vẫn dùng Gipformer trong `buddy-voice`. Phần giọng đọc của Bin không đổi.
- `GET /api/buddy/voice` trả thêm `stt: "deepgram" | "local"`. Thông báo trước khi bật mic trên trang Bin ghi rõ âm thanh được gửi tới Deepgram khi đang dùng Deepgram (`buddyMicNotice` trong `frontend/src/lib/buddy/voice.ts`).
- Biến mới `DEEPGRAM_API_KEY`, `DEEPGRAM_MODEL` (mặc định `nova-3`), `DEEPGRAM_TIMEOUT_MS`; đã thêm vào `docker-compose.yml`, `backend/.env.example` và `buddy_voice/README.md`.
- Kiểm chứng: thêm 4 test `deepgramStt` (URL luôn có `language=vi` và `mip_opt_out=true`, đọc câu nhận dạng, gửi khoá và kiểu nội dung, báo mã lỗi) và 2 test cho câu thông báo. Backend typecheck `src` sạch, 445 unit test với 3 test dáng đi lỗi từ trước. Frontend `tsc -b`, ESLint, 103 test và `npm run build` sạch. Chưa gọi Deepgram thật vì chưa có khoá; chưa triển khai lên `khmt01`.

## 2026-11-20 — Chế độ "Ghi kiểm thử" cho Bạn Bin (đã gỡ)

- Đã viết thử chế độ chỉ admin dùng, để ghi WAV và bản chép lời từng lượt nói nhằm đo khả năng nghe bằng âm thanh thật. Chủ dự án quyết định dừng và gỡ ra; chưa từng triển khai.
- `frontend/src/pages/BuddyPage.tsx` và `frontend/src/lib/buddy/voice.ts` được khôi phục về đúng bản đang chạy trên `khmt01`. Đã xoá `BuddyCapturePanel.tsx`, `captureLog.ts`, `captureLog.test.ts` và `buddy_voice/asr_capture_report.py`.
- Kiểm tra sau khi gỡ: frontend `tsc -b`, ESLint toàn dự án, 101 test và `npm run build` sạch.
- Nếu làm lại: cờ "băng hẹp" trong script phân tích cần cách đo khác. Roll-off 95% của cả đoạn báo nhầm ở giọng bình thường (khoảng 1,5 kHz).

## 2026-11-20 — Điều tra khả năng nghe của Bạn Bin (chưa sửa)

- Chủ dự án báo Bin nhận đúng rất ít từ. Thêm `buddy_voice/asr_eval.py`: 25 câu kiểu trẻ hay nói (gồm 5 câu cực ngắn), 5 giọng VieNeu, ba điều kiện (sạch, giống giọng trẻ +4 bán cung, nhiễu SNR 15 dB). Âm thanh đi đúng đường thật: trình duyệt tạo WAV 24 kHz, server đổi sang 16 kHz bằng PyAV.
- Gipformer int8 greedy (cấu hình đang chạy): 7,1% lỗi từ và 76% câu đúng hết khi sạch; 9,2% khi giống giọng trẻ; 8,0% khi nhiễu. fp32, beam search và hotwords (`BIN`, sở thích, câu trả lời gợi ý; điểm 1,5 và 2,5) thay đổi dưới 1 điểm; hotwords ngữ cảnh còn chèn nhầm "không". Lỗi lặp lại: "Bin" thành "linh", "vinh", "nhìn", "binh"; câu một hai từ ("có", "tàu hỏa"); giọng miền Trung kém hơn.
- `buddy_voice/asr_compare.py` so với model khác trên cùng bộ câu (CPU, int8): PhoWhisper-small (tự chuyển từ `vinai/PhoWhisper-small`) 17,8% lỗi từ, 2,69 giây mỗi câu; Whisper-small 27,7%, 3,14 giây; Gipformer 0,09 giây. Không đổi model.
- Gửi 5 câu WAV thẳng vào `buddy-voice` trên `khmt01`: kết quả trùng máy dev. Model, giải mã và đường từ WAV đến server không lỗi. Khoảng cách với trải nghiệm thật nằm ở âm thanh mic trên trình duyệt và giọng trẻ thật; cần bản ghi thật để đo tiếp.
- Thêm vào `buddy_voice/.dockerignore` các thư mục mẫu và dữ liệu đo (giữ các dòng cũ). Mô hình PhoWhisper đã chuyển (982 MB) được chuyển ra `C:\Users\pluan\.venvs\asr_models`, ngoài repo.

## 2026-11-20 — Bạn Bin giai đoạn 1: cá nhân hoá và nét mặt theo cả lượt

- Trước đây Bin chỉ nhận tuổi của trẻ. Nay khi phụ huynh bật "Cho Bin biết về con" trên trang Bin, request chat gửi `childId` và `personalize: true`. Backend chỉ đọc hồ sơ cá nhân hoá của trẻ thuộc tài khoản đang đăng nhập (trẻ khác trả `404 CHILD_NOT_FOUND`), rồi thêm đoạn "Điều bố mẹ kể về bé" vào prompt (`personalizationPrompt` trong `backend/src/lib/buddyScript.ts`).
- Mỗi trường thành một chỉ dẫn: tên gọi ở nhà; sở thích dùng để mở chuyện; mức giao tiếp quyết định độ dài câu và cách hỏi (có/không, chọn một trong hai); điều nhạy cảm cần tránh, có báo trước khi đổi trò nếu trẻ nhạy cảm với thay đổi; cách giúp con bình tĩnh; mong muốn của bố mẹ. Lời bố mẹ viết được đặt trong «», giới hạn độ dài, bỏ xuống dòng, và prompt ghi rõ đó không phải lệnh cho Bin. Cài đặt luyện tập và nhóm kỹ năng không được gửi.
- Trẻ nhạy cảm với âm thanh lớn: chat trả `voice: "calm"`, trang Bin gọi `/buddy/voice/speak` với `calm: true`, và `buddy-voice` phát giọng gốc, không nâng cao độ và tốc độ.
- Lựa chọn của phụ huynh mặc định tắt, lưu trên trình duyệt theo tài khoản và trẻ cùng phiên bản `buddy-personalize-2026-11-20` (`frontend/src/lib/buddy/personalizeConsent.ts`). Thông báo nói rõ thông tin được gửi kèm mỗi lượt đến Groq, còn họ tên và kết quả sàng lọc thì không.
- Nét mặt được tổng hợp trên cả lượt (`frontend/src/lib/buddy/visionCues.ts`): khoảng thời gian trẻ nói với lượt dùng mic, 3 giây cuối với lượt gõ chữ. Một nhãn được tính khi xuất hiện ở ít nhất 30% số khung của người đó, cần tối thiểu 4 khung. Trước đây chỉ lấy khung hình cuối.
- Bỏ nhãn `mouth_open` còn dư trong schema backend và kiểu frontend.
- Không thay prompt bằng bản §24: backend đã chứa phần lớn §24 cùng các chỉnh sửa về sau (xưng "mình", gọi "em").
- Kiểm chứng: backend 19 test Bin (thêm 5 test cá nhân hoá, thêm trường hợp `mouth_open` bị từ chối) và 441 unit test, trong đó 3 test dáng đi lỗi từ trước; typecheck `src` sạch, riêng `test/chatRagErrors.test.ts` (phần việc RAG khác, tạo lúc 18:55) có lỗi kiểu. Frontend 64 test Bin (thêm `visionCues` và `personalizeConsent`), `tsc -b`, ESLint và `npm run build` đều sạch.
- Đã triển khai lên `khmt01` lúc khoảng 12:40 UTC ngày 20/11: chép 13 file vào `~/Luan_workspace/asdr/repo` (9 file cũ sao lưu tại `~/Luan_workspace/asdr/diagnostics/buddy-phase1-20261120/`, kèm `build.log`), build rồi tạo lại `backend`, `frontend`, `buddy-voice`. Backend healthy, `buddy-voice` khởi động xong, bản build chứa code mới.
- Thử trong container backend qua Groq thật với hồ sơ giả (tên ở nhà "Su Su", thích tàu hoả, nói từ đơn, nhạy cảm âm thanh, bình tĩnh nhờ ôm gấu bông). Lượt "con buồn quá" được đáp bằng gợi ý ôm gấu bông; câu đáp ngắn. Trong 2 lượt thử, Bin chưa gọi tên ở nhà, và câu chào "Bin đang ở đâu nè?" hơi lạ. Mẫu thử còn quá nhỏ để kết luận. `/speak` với `calm: true` trả 200, âm thanh dài hơn giọng thường (2,88 giây so với 2,43 giây).
- Chưa thử trên trình duyệt có tài khoản phụ huynh thật.

## 2026-11-20 — Giọng Bin tươi hơn: nâng cao độ và tốc độ khi phát

- Chủ dự án muốn Bin đọc hớn hở hơn. Đã thử với `buddy_voice/expressiveness_samples.py` (giọng Quỳnh Anh, mỗi biến thể 2 lần, mẫu trong `buddy_voice/expressiveness_samples/`). Năm thẻ `emotion_0`–`emotion_4` của v3 Turbo và `temperature` 1.0 không tạo khác biệt cao độ vượt mức dao động giữa hai lần đọc. VieNeu đã bỏ tham số `style`; phong cách đọc lấy từ giọng tham chiếu.
- Chủ dự án chọn mẫu D: nâng cao độ +1,5 bán cung và nhanh hơn 5%. `buddy_voice/app.py` thêm lớp `Brighten` dùng bộ lọc FFmpeg của PyAV (`asetrate → aresample → atempo`) trên luồng PCM, vẫn ở 48 kHz. Mỗi đoạn TTS được cắt thành khung 20 ms để độ trễ khởi động của bộ lọc chỉ khoảng 60 ms âm thanh.
- Biến mới `BUDDY_TTS_PITCH_SEMITONES` (mặc định 1.5) và `BUDDY_TTS_TEMPO` (mặc định 1.05) được truyền qua `docker-compose.yml`; đặt `0` và `1` để giữ giọng gốc. README đã ghi lại.
- Kiểm chứng ở máy dev: bộ lọc với sóng sin 200 Hz cho 218 Hz và độ dài 1,903 giây (kỳ vọng 218,1 Hz, 1,905 giây). Chạy `pcm_stream` thật: cao độ trung vị 213 → 228 Hz, âm thanh ngắn hơn 6%, slot TTS được trả.
- Đã triển khai lên `khmt01`: chép `buddy_voice/app.py`, `buddy_voice/README.md`, `docker-compose.yml` (bản cũ trong `~/Luan_workspace/asdr/diagnostics/buddy-voice-20261120/`), build và tạo lại riêng `buddy-voice`. Dịch vụ khởi động bình thường; từ backend gọi `/speak` trả 200, tiếng đầu sau 288 ms. Chưa nghe thử trên trang `/buddy`.

## 2026-11-20 — Hạ ngưỡng "Bộ phận cử động luôn nhìn rõ" của video mẫu

- Theo yêu cầu của chủ dự án, cổng `TEMPLATE_PART_NOT_VISIBLE` hạ từ 0.95 xuống 0.7. Video High-Kicks đo được 0,75 nên trước đây không lưu được.
- Ngưỡng mới là `TEMPLATE_AUTHORING_GATES.partVisibility` trong `backend/src/services/imitation/constants.ts`, nằm ngoài `IMITATION_V1`. Cổng này chỉ quyết định video mẫu có được lưu hay không. Hash `IMITATION_V1`, `templateHash` của mẫu đã lưu, bài dựng sẵn và cách chấm điểm giữ nguyên. Giá trị `templateGates.visibility` cũ còn trong `IMITATION_V1` để giữ hash nhưng không còn được đọc.
- Kiểm chứng: typecheck backend; 72 test imitation và job đều qua, gồm test khoá hash hằng số. Đã triển khai backend lên `khmt01` (bản cũ tại `~/Luan_workspace/asdr/diagnostics/template-gate-20261120/`). Chạy thử trên subject `tpl_200ffe2d…` của High-Kicks, không cắt đoạn: cổng này đạt 0,734 ≥ 0,7; cổng thời lượng vẫn cần cắt đoạn động tác về 2–30 giây.

## 2026-11-20 — Đổi giọng Bạn Bin sang Quỳnh Anh

- Chủ dự án thấy giọng `Quang Sơn` khó nghe. Thêm `buddy_voice/generate_voice_samples.py` để tạo MP3 cho cả 25 giọng dựng sẵn của VieNeu-TTS v3 Turbo (`vieneu==3.8.3`, cùng `infer_stream` như dịch vụ). Mẫu nằm ở `buddy_voice/voice_samples/` kèm `voices.json`; mỗi file dài 6–12 giây.
- Chủ dự án chọn giọng 21, `Quỳnh Anh` (nữ, miền Bắc, phong cách đọc truyện). Đổi giá trị mặc định trong `buddy_voice/app.py`, `docker-compose.yml` và README.
- Trên `khmt01`: thêm `BUDDY_TTS_VOICE=Quỳnh Anh` vào `~/Luan_workspace/asdr/repo/.env` (bản cũ tại `~/Luan_workspace/asdr/diagnostics/buddy-voice-20261120/env.before`) rồi tạo lại container `buddy-voice`, không build lại image. Container nhận đúng biến; bước làm nóng chạy với giọng mới; gọi thử `/speak` trả 200. Chưa nghe thử trên trang `/buddy`.

## 2026-11-20 — Trích xuất video mẫu bài tập chạy nền

- Nguyên nhân lỗi "Không trích xuất được khung xương từ video mẫu": route tải video mẫu chờ OpenPose và bước làm mờ mặt xong mới trả lời. Qua Cloudflare, request bị cắt sau 100 giây. Trên `khmt01`, cùng video High-Kicks (63 giây, 720p30) vẫn chạy OpenPose 39 giây như ngày 15/11, nhưng thời gian tải lên hôm nay dài hơn nên tổng thời gian vượt giới hạn. Video quay dọc 1080×1920 60 fps cần thêm 96–114 giây cho bước làm mờ mặt.
- Lượt bị cắt vẫn chạy tiếp trên máy ML, nên lượt thử sau phải chờ và cũng bị cắt. Ngày 20/11 có 7 subject `tpl_` không gắn với phiên bản mẫu nào; chưa xoá.
- `POST /api/admin/exercises/:id/template-sources` kiểm tra xác nhận, file và tham số rồi trả `202 { job }`. Việc trích xuất chạy nền, video tạm bị xoá ngay khi xong. Route mới `GET /api/admin/exercises/:id/template-sources/jobs/:jobId` trả `running`, `done` kèm nguồn, hoặc `failed` kèm mã lỗi cũ.
- Mỗi bài tập chỉ chạy một lượt trích xuất. Lượt tải thứ hai trả `409 TEMPLATE_SOURCE_BUSY` kèm job đang chạy, và trang Admin chờ tiếp job đó. Job được giữ trong bộ nhớ backend 1 giờ sau khi xong; backend khởi động lại thì phải tải lại video.
- Trang Admin hỏi trạng thái mỗi 2 giây, dừng khi rời trang. Thêm thông báo cho lỗi 413 (quá 100 MB qua Cloudflare) và 502/504/522/524 khi proxy không trả JSON.
- Tách `OpenPoseApiError` sang `backend/src/services/openposeError.ts`; `openposeService` vẫn export lại lớp này.
- Kiểm chứng: thêm 5 unit test cho `TemplateSourceJobs`; e2e bài tập 26/26; typecheck backend, `tsc -b` và ESLint frontend sạch. `npm test` của backend có 3 test dáng đi lỗi từ trước (`gaitFeatures`, `poseTracking`; file chưa đổi từ tháng 10).
- Đã triển khai lên `khmt01` lúc khoảng 07:55 UTC ngày 20/11. Chép 9 file vào `~/Luan_workspace/asdr/repo`, bản cũ lưu tại `~/Luan_workspace/asdr/diagnostics/template-source-jobs-20261120/`, rồi chạy `docker compose -p asdr build backend frontend` và `up -d --no-deps backend frontend`. Backend healthy; bản build chứa route job mới; tên miền trả HTTP 200. Chưa thử tải video thật sau khi triển khai.

## 2026-11-20 — Khôi phục cấu hình Compose của khmt01

- Phát hiện file triển khai `docker-compose.override.yml` bị thiếu. Container database thuộc project `asdr-infra`, còn backend/frontend thuộc project `asdr`, nên Compose mặc định cố tạo thêm container trùng tên `asdr-db`.
- Khôi phục override trên máy chủ theo cấu hình container đang chạy, dùng mạng ngoài `asdr-network`, địa chỉ `asdr-db:5432` và ML `asdr-ml-api:8000`. Các biến môi trường backend được đối chiếu khớp với container cũ.
- Giữ cổng frontend 3000 và 3010. Database của Compose ứng dụng được đặt trong profile `managed-db`; backend được tách phụ thuộc khởi tạo database.
- Lưu thêm bản override tại `/home/khmt01/Luan_workspace/asdr/diagnostics/compose-recovery-20261120-58c2e4fa/docker-compose.override.yml`.
- Đã cập nhật dịch vụ bằng `docker compose -p asdr up -d --no-deps backend frontend`. Xác nhận database giữ nguyên ID container, nhận kết nối và healthy; backend healthy; API và frontend trên tên miền trả HTTP 200. Khi khởi động, Prisma báo đã có 7 migration và tất cả đã được áp.

## 2026-11-20 — Sửa Docker build backend thiếu DATABASE_URL

- Build backend dừng ở `prebuild → prisma generate` vì cấu hình Prisma yêu cầu `DATABASE_URL`, trong khi biến do Compose cấp ở giai đoạn chạy container.
- Thêm URL tạm `postgresql://build:build@127.0.0.1:1/build_only` vào riêng builder stage của `backend/Dockerfile`, phục vụ cài dependency và sinh Prisma Client.
- Kiểm chứng bằng Docker build thật trên source của `khmt01` với tag `aimbrace-backend-prisma-check:20261120`. Sinh Prisma Client, biên dịch TypeScript, prune dependency và tạo image hoàn tất.
- Kiểm tra metadata image cuối xác nhận URL tạm chỉ thuộc build stage. Cấu hình kết nối database khi chạy ứng dụng tiếp tục do Compose cấp.
- Đã cập nhật Dockerfile trong source máy dev và repo trên `khmt01`. Bản sao Dockerfile máy chủ nằm tại `/home/khmt01/Luan_workspace/diagnostics/prisma-build-20261120-4cbd25cc/Dockerfile.before`.
- Image kiểm thử đã sẵn sàng. Chủ dự án tiếp tục build và chạy các dịch vụ bằng quy trình Compose đang dùng.

## 2026-11-20 — Điều chỉnh tỉ lệ trung bình và nối cổ cho Bin

- Theo góp ý của chủ dự án, lấy trung bình giữa tỉ lệ gốc và bản thu gọn. Thân còn 85%, tay 84%, chân 77,5%, bề rộng vai và hông 97,5%.
- Giới hạn phóng hình ở 1,07 để chiều cao hiển thị gần trung bình của hai bản xem thử.
- Tính vị trí chân cổ từ chiều dài thân và điểm nối trên bản vẽ thân, để cổ chồng vào thân 2 đơn vị SVG khi đứng hoặc nghiêng người.
- Kiểm chứng bằng 10 test hình học, frontend build, lint và bản xem thử Chrome.
- Bản sửa đã áp vào source máy dev. Website cần build và triển khai frontend.

## 2026-11-20 — Thu gọn tỉ lệ Bin khi làm mẫu bài tập

- Thêm `retargetBinPose` trong `frontend/src/lib/buddy/figure.ts` để chuyển khung xương bài tập sang tỉ lệ nhân vật trước khi vẽ.
- Thân còn 70%, tay còn 68%, chân còn 55% chiều dài của khung xương hiển thị ban đầu. Bề rộng vai và hông còn 95%, giúp đầu nổi bật hơn so với thân và chân.
- Co từng đoạn chi từ khớp cha để giữ hướng và góc gập trong động tác. Tính lại mặt sàn và khung nhìn từ tư thế đã thu gọn.
- `GuidePuppet.tsx` áp tỉ lệ này cho làm mẫu, đứng chờ, chúc mừng và tư thế nhún vai.
- Kiểm chứng bằng 8 test hình học, frontend build và lint. Bản xem thử trên Chrome bao gồm đối chiếu tỉ lệ và các tư thế bài tập tổng hợp.
- Bản sửa được áp vào source máy dev. Frontend trên website cần build và triển khai.

## 2026-11-18 — Sửa lỗi tạo mẫu khuôn mặt trên website

- Bản quay từ người dùng cho thấy mặt và tư thế đã được chấp nhận, nhưng bước tạo vector nhận diện liên tục báo lỗi.
- Xác định nginx trên website trả module ONNX Runtime `.mjs` với `Content-Type: application/octet-stream`, khiến trình duyệt chặn import module.
- Bổ sung location dành cho `.mjs` trong `frontend/nginx.conf`, trả `text/javascript` và trả 404 nếu tệp module thiếu.
- Đã áp cấu hình vào source triển khai và nginx đang chạy trên `khmt01`. Lưu bản sao cấu hình tại `/home/khmt01/Luan_workspace/diagnostics/nginx-mjs-20261118-f87b11ee`, chạy `nginx -t` thành công rồi reload.
- Kiểm chứng qua `aimbrace.agriwatch.io.vn`: trước sửa Chrome import thất bại, sau sửa import thành công và worker SFace trả vector hữu hạn 128 chiều với tensor tổng hợp. HTTP của module trả `text/javascript`, API health trả 200.
- Lần kiểm thử giao diện trước đó dùng máy chủ thử có MIME đúng nên chưa phát hiện sai cấu hình nginx. Sau triển khai cần tải lại trang để worker khởi động lại rồi thử lấy mẫu bằng camera thật.

## 2026-11-18 — Cải thiện lấy mẫu khuôn mặt cho Bạn Bin

- Camera lấy mẫu dùng khung 4:3 dành cho khuôn mặt, thay cấu hình toàn thân của bài tập. Mở rộng phần xem trước và thêm khung hướng dẫn cho góc chính diện.
- Phân biệt các trường hợp mặt quá nhỏ, sát mép, sai góc và lỗi tạo vector nhận diện. Giao diện chỉ rõ cần tiến gần, dịch vào giữa hay điều chỉnh hướng mặt.
- Nới nhẹ khoảng chấp nhận góc chính diện, từ khoảng 8° lên khoảng 10° và tăng dung sai góc nhìn dọc của camera. Các ngưỡng so khớp danh tính giữ theo cấu hình nhận diện hiện tại.
- Làm rõ cách hoàn tất sau góc đầu tiên bằng nút “Dùng mẫu chính diện”. Người dùng có thể tiếp tục lấy thêm bốn góc.
- Kiểm chứng trên bản sao source gồm 37 test liên quan, lint và build frontend đạt. Chrome với camera giả lập và ảnh người lớn công khai đã chạy mô hình thật, tự lấy mẫu cho hai người, lưu vector tại trình duyệt và mở giao diện ở chiều rộng 375 px.
- Giao diện cập nhật đã xuất hiện trong bản quay website người dùng gửi sau đó. Cần thử thêm với người thật để đánh giá dung sai góc mới sau khi khắc phục lỗi module ONNX.

## 2026-11-20 — Sửa liên kết phiếu M-CHAT-R/F tiếng Việt

- Thay liên kết trang tổng hợp bản dịch bằng liên kết PDF tiếng Việt do người dùng cung cấp.
- Cập nhật URL ở frontend và backend để nút mở phiếu, phần bản quyền và các nơi dùng chung lấy cùng một liên kết.

## 2026-11-20 — Gỡ thông báo bác sĩ mẫu khỏi trang Bác sĩ

- Gỡ banner vàng thông báo danh sách bác sĩ mẫu khỏi đầu trang Kết nối bác sĩ và khỏi hộp thoại chia sẻ hồ sơ.
- Các cảnh báo dành cho tài khoản bác sĩ mẫu ở trang bác sĩ và các nhãn phân biệt tại hồ sơ trẻ không thay đổi.

## 2026-11-20 — Hoàn thiện Cộng đồng cho pilot

- Thêm hồ sơ biệt danh/giới thiệu tách khỏi tên tài khoản, theo dõi chủ đề/thành viên, nhóm công khai, tham gia/rời nhóm và thông báo trong ứng dụng.
- Bổ sung sửa bài, báo cáo bài viết/bình luận, chặn thành viên, hàng chờ kiểm duyệt, ẩn/khôi phục nội dung và tạm ngưng thành viên; lưu snapshot và lịch sử xử lý.
- Cho đăng tối đa 4 ảnh JPG/PNG/WebP, tối đa 5 MB mỗi ảnh; máy chủ giải mã, xoay, thu nhỏ và chuyển sang WebP để loại metadata ảnh. Thêm lời nhắc tránh thông tin nhận dạng hoặc ảnh nhạy cảm của trẻ.
- Feed loại nội dung đã ẩn và nội dung từ người dùng bị chặn; các thao tác xã hội từ tài khoản bị tạm ngưng bị từ chối.
- Đã áp dụng migration `20261120051743_community_social_doctor_pilot` vào PostgreSQL local tại `localhost:5435`.
- Bỏ dòng phụ cạnh nhãn biệt danh và đặt ô nhập biệt danh ngay bên cạnh đề mục để dễ tìm, dễ chỉnh sửa.
- Đưa ô biệt danh trở lại cụm trường bên phải như bố cục trước đó theo yêu cầu.
- Chặn mở form đăng bài khi đã lọc một nhóm nhưng chưa tham gia; hiển thị hướng dẫn tham gia và thông báo rõ nếu máy chủ vẫn trả lỗi thành viên.
- Bỏ hàng chip theo dõi chủ đề trùng tên với bộ lọc; nút theo dõi chỉ xuất hiện cạnh chủ đề đang chọn. Bỏ nút đăng bài thứ hai ở trạng thái feed rỗng.
- Đổi biệt danh tự sinh sang tên thân thiện hơn và tự cập nhật các biệt danh cũ theo mẫu “Phụ huynh + mã”.
- Bài đăng/bình luận ẩn danh luôn dùng tên “Phụ huynh giấu tên”, không hiện biệt danh của chính người đăng.
- Ảnh đính kèm được tải qua API có xác thực để gửi token đăng nhập, sau đó hiển thị từ blob URL; bổ sung ảnh ở cả feed và trang chi tiết bài viết.

## 2026-11-20 — Hoàn thiện quản lý bác sĩ và hạn quyền chia sẻ cho pilot

- Thêm admin tạo/thu hồi lời mời bác sĩ dùng một lần, luồng tạo tài khoản bằng lời mời và quản lý trạng thái xác minh/kích hoạt. Không nhận hay lưu bản chụp giấy tờ.
- Danh bạ và cổng bác sĩ chỉ nhận tài khoản thật đã xác minh, đang kích hoạt; chế độ demo vẫn giữ tài khoản mẫu riêng.
- Thêm hạn quyền 30/90/180 ngày hoặc không thời hạn (mặc định 90 ngày), lọc quyền hết hạn khỏi mọi truy cập và ghi nhật ký cấp, thu hồi, hết hạn, lần xem hồ sơ.
- Hiển thị thời hạn quyền ở hồ sơ trẻ; bác sĩ vẫn chỉ đọc dữ liệu trong phạm vi phụ huynh cấp và video không được chia sẻ.

## 2026-11-18 — Khởi tạo nhật ký thay đổi

- Tạo `changelogs.md` ở thư mục gốc để theo dõi các lần cập nhật source, logic, database và triển khai.
- Khởi tạo các mốc gần đây từ nhật ký bàn giao và source đã đọc. Chi tiết lịch sử trước các mốc bên dưới nằm trong `master_prompt.md`.

## 2026-11-18 — Dọn source và đăng ký khuôn mặt đa góc

### Source và giao diện

- Tách context và hook đăng nhập sang `frontend/src/state/useAuth.ts`. Cập nhật các nơi sử dụng và xử lý phản hồi khôi phục phiên đến muộn.
- Sửa cách xử lý trạng thái tải ở trang cộng đồng và trang chi tiết bài viết. Trang hồ sơ dùng chung hàm tính tuổi và định dạng ngày sinh.
- Dọn thành phần, tài sản và hằng số hết sử dụng. Cập nhật README và tài liệu triển khai.
- Frontend ESLint đạt 0 lỗi theo lần kiểm chứng được ghi ở `master_prompt.md` §27.3.

### Logic nhận diện người thân của Bạn Bin

- Mỗi người có thể đăng ký 5 góc nhìn gồm chính diện, hai bên, ngẩng và cúi. Góc nhìn được chụp sau khi ổn định qua các lần quan sát.
- Kết hợp MediaPipe Face Landmarker, căn chỉnh khuôn mặt và SFace để tạo vector nhận diện.
- Giữ danh tính qua các lần so khớp chưa rõ. Huỷ xác nhận khi mất dấu, có bằng chứng lệch liên tiếp hoặc quá thời gian giữ danh tính.
- Mẫu khuôn mặt lưu tại trình duyệt theo tài khoản và hồ sơ trẻ. Định dạng v2 hỗ trợ nhiều góc và đọc được mẫu v1.
- File chính gồm `frontend/src/lib/buddy/visionPose.ts`, `faceEnrollment.ts`, `visionProfiles.ts`, `visionTracking.ts` và `frontend/src/components/children/FamilyFaceEnrollment.tsx`.

### Database và triển khai

- Theo nhật ký §26.9, chủ dự án đã build lại backend và frontend trên `khmt01` ngày 18/11. Backend đã áp migration `20261117_personalization_doctors` khi khởi động.
- Database của `khmt01` đã có 8 tài khoản bác sĩ mẫu, tính năng bác sĩ chạy ở chế độ `demo`.
- DB chung cũ trên `user-KHMT02` đã ngừng. Máy dev được hướng dẫn chạy backend sandbox và frontend sandbox để thử chức năng.
- Bản frontend đăng ký khuôn mặt đa góc còn được ghi là chờ triển khai trong §27.5.

### Kiểm chứng và phần cần thử tiếp

- Theo §27.3, frontend typecheck, build và lint đạt. Frontend test đạt 70/70, backend e2e đạt 53/53.
- Backend unit test đạt 427/430. Ba test còn lỗi thuộc phân tích dáng đi góc chính diện và đã được ghi nhận từ trước.
- Đăng ký khuôn mặt đa góc và khả năng giữ danh tính cần thử thêm bằng camera thật.

## 2026-11-17 — Cải thiện bài tập, cá nhân hoá và phía bác sĩ

### Bài tập và giao diện

- Thay nhân vật hướng dẫn bằng Bin toàn thân, dùng chung bản vẽ bộ phận với Bin trò chuyện. Hình thể được co giãn theo khung xương mẫu và có biểu cảm khi nhắc, khen hoặc kết thúc lượt tập.
- Nhắc trực tiếp được hiệu chỉnh theo tiêu chí của backend. Lời nhắc giãn cách tối thiểu 6,5 giây. Lời khen hiện bằng chữ và biểu cảm sau các lần làm đúng, với khoảng cách thông điệp tối thiểu 9 giây cho lời khen.
- Biểu đồ tiến độ bổ sung số tiêu chí cần luyện thêm theo lượt tập.
- Báo cáo góp ý động tác đã lưu đọc được qua các phiên bản `exercise-errors-v…`. Admin nhận cảnh báo biên dịch lại khi phiên bản hiệu chỉnh mẫu đã cũ.
- Luồng tải video mẫu chờ hoàn tất xử lý file tạm trước khi trả phản hồi, khắc phục kiểm thử e2e chập chờn.

### Cá nhân hoá và chia sẻ hồ sơ

- Phụ huynh khai báo tên gọi ở nhà, sở thích, cách giao tiếp, yếu tố nhạy cảm, mục tiêu và tuỳ chọn luyện tập.
- Gợi ý bài tập, tốc độ và cách tập dựa trên hồ sơ và lịch sử luyện tập. Các gợi ý kèm lý do và tôn trọng lựa chọn của phụ huynh.
- Theo dõi số ngày tập trong tuần và mục tiêu tuần theo giờ Việt Nam.
- Thêm danh sách bác sĩ và trang bác sĩ xem hồ sơ được chia sẻ. Phụ huynh chọn phạm vi dữ liệu, đổi quyền hoặc thu hồi quyền.
- Quyền truy cập được kiểm tra theo liên kết còn hiệu lực và từng phạm vi chia sẻ. Ghi nhận lần xem để phụ huynh theo dõi.

### Database và cấu hình

- Migration mới `backend/prisma/migrations/20261117_personalization_doctors/` thêm ba bảng `ChildPersonalization`, `DoctorProfile` và `DoctorChildLink`.
- Bác sĩ được xác định qua `DoctorProfile` gắn với tài khoản.
- Thêm `DOCTOR_MODE` với các giá trị `off`, `demo`, `on` và lệnh tạo bác sĩ mẫu `npm run doctors:seed-mock`.
- File chính gồm `backend/src/lib/personalization.ts`, `doctorShare.ts`, các route `childPersonalization.ts`, `doctors.ts`, `doctorPortal.ts` và các trang tương ứng ở frontend.

### Kiểm chứng và phần cần thử tiếp

- Theo §26.5, backend e2e đạt 53/53, frontend test đạt 36/36, typecheck và build đạt.
- Các luật gợi ý, nhắc trực tiếp và chất lượng video ghi cần đánh giá thêm với camera thật và dữ liệu thực tế.
- Quy trình xác minh bác sĩ thật, nhận xét của bác sĩ và đặt lịch còn nằm trong phần phát triển tiếp.

## 2026-11-15 — Góp ý bằng giọng nói trong lúc tập

- Bổ sung `frontend/src/lib/exerciseCoach/` để phân tích camera trong worker bằng MediaPipe Pose Landmarker và phát lời nhắc tiếng Việt.
- Ba dạng bài có lời nhắc trực tiếp gồm phối hợp tay–chân cho Jump Twists, mở chân cho Jumping Jacks và đổi chân cho High Kicks.
- Tích hợp lời nhắc, dòng chữ hướng dẫn và tuỳ chọn bật/tắt vào màn hình luyện tập. Tải sẵn các câu nhắc dưới dạng WAV.
- API mẫu trả thêm `liveProfile` để frontend chọn luật nhắc. Điểm cuối lượt được xử lý qua worker chấm video sau khi gửi.
- Luồng kiểm thử trên Chrome đã chạy mô hình, phát âm thanh khi ghi bằng luồng video tổng hợp và chuyển sang màn hình xem lại. Mức chính xác trên camera thật cần được kiểm chứng thêm.
- Các luật và giao diện tiếp tục được cập nhật trong đợt 17/11.

## 2026-11-11–12 — Phân tích lỗi động tác sau lượt tập và lưu bản quay kiểm thử

- Tích hợp `backend/src/services/exerciseMovement/` với 10 tiêu chí cho Jump Twists, Jumping Jacks và High Kicks.
- Admin chọn dạng bài khi biên dịch mẫu. Kết quả phân tích có thể trả nhiều lỗi trong một lượt, mỗi lỗi có mốc thời gian và gợi ý sửa.
- Hiệu chỉnh mẫu được lưu vào `ExerciseTemplate.features.movement`. Góp ý được lưu vào `SessionScore.detail.movement`, sử dụng các trường JSON hiện có.
- Màn hình phụ huynh hiển thị lỗi và tiêu chí chưa đo được. Màn hình cho bé hiển thị gợi ý ngắn sau lượt tập.
- Admin tải bản quay webcam về thiết bị từ bước xem lại. Cấu hình `EXERCISE_DEBUG_RECORDING_DOWNLOAD` điều khiển nút tải bản quay kiểm thử.
- Theo lần tích hợp, 40 test phát hiện lỗi và 26 test HTTP đạt. Typecheck và frontend build đạt.

## Mẫu ghi cho lần cập nhật tiếp theo

```markdown
## YYYY-MM-DD — Tên đợt cập nhật

### Thay đổi source, logic và giao diện

- Mô tả hành vi đã thay đổi, lý do và các module chính liên quan.

### Database và cấu hình

- Ghi tên migration, bảng/cột hoặc cấu trúc JSON thay đổi, biến cấu hình và ảnh hưởng tới dữ liệu cũ.
- Ghi môi trường đã áp dụng migration và thao tác cần thực hiện khi triển khai.

### Kiểm chứng

- Ghi lệnh hoặc kịch bản đã chạy, kết quả và điều kiện thử.

### Triển khai và việc còn lại

- Ghi môi trường, thời điểm triển khai và các bước còn chờ.
- Ghi giới hạn hoặc phần chưa được kiểm chứng.
```

Khi cập nhật, chỉ ghi giá trị cấu hình mẫu và tên biến. Thông tin đăng nhập, token và dữ liệu cá nhân được quản lý tại nơi lưu trữ riêng của môi trường.

## 2026-11-20 — Trợ lý AI kết nối RAG

- Backend /api/chat chuyển tiếp tới dịch vụ LangGraph qua khóa nội bộ, gửi lịch sử bốn lượt và trả nguồn.
- Khung Trợ lý AI ở trang chủ và trang trợ lý hiển thị nội dung, link nguồn và đoạn tham khảo; chặn gửi trùng khi đang chờ.
- Cấu hình CHAT_API_BASE_URL và CHAT_API_KEY chỉ nằm phía backend.
- Không cần thay đổi schema database website.
- Kiểm tra: TypeScript backend, build frontend và hợp đồng proxy (lịch sử, lỗi upstream, link nguồn không hợp lệ) đã đạt. Qua domain thật, hi trả 200 khoảng 2 giây; ASD là gì trả 200 khoảng 4,8 giây và có nguồn.
- Đã cập nhật frontend/backend và RAG trên khmt01; file gốc được sao lưu tại Luan_workspace/asdr/rag-website-update/backup-9ef82707083544209021df771a84e687.
- LLM vẫn có thể diễn đạt hoặc chọn nguồn chưa chính xác, cần tiếp tục kiểm tra nội dung với các câu hỏi thực tế.

## 2026-11-20 — Định dạng câu trả lời trong Trợ lý AI

- Sửa lỗi hiển thị nguyên ký hiệu Markdown trong câu trả lời: hỗ trợ chữ đậm/nghiêng, tiêu đề, danh sách, trích dẫn, bảng, liên kết và khối mã bằng react-markdown + remark-gfm.
- Tăng cỡ chữ, giãn dòng và chiều rộng câu trả lời; giữ tin nhắn người dùng ở dạng văn bản và giữ nguyên nguồn tham khảo.
- Không chạy HTML nhúng, không tải ảnh từ câu trả lời; chỉ cho liên kết HTTP/HTTPS mở ở tab mới.
- Kiểm tra: 3 ca kiểm tra render Markdown/bảng/nguồn và chặn HTML/liên kết nguy hiểm đạt; ESLint các file thay đổi và build frontend đạt.
- Không thay đổi backend, prompt, model hoặc schema database.
- Bản gốc trên server đã được sao lưu tại /home/khmt01/Luan_workspace/asdr/chat-markdown-update/backup-20261120-151342; đã cập nhật riêng frontend lên server. Domain công khai và gói JavaScript mới trả HTTP 200, có bộ hiển thị Markdown.

## 2026-11-20 — Lịch sử hội thoại Trợ lý AI

- Thêm nút Lịch sử chat và Chat mới trong khung Trợ lý AI (trang chủ và trang /assistant); mở lại, tiếp tục cuộc chat, hiển thị thời gian và tải thêm hội thoại/tin nhắn.
- Lưu hội thoại theo tài khoản trên server; nhớ cuộc chat đang mở trong phiên trình duyệt. Tạo chat mới chỉ khi gửi thành công tin đầu tiên.
- Backend lấy bốn tin nhắn gần nhất từ database làm ngữ cảnh, không tin lịch sử do trình duyệt gửi; kiểm tra chủ sở hữu ở mọi API. API lịch sử dùng Cache-Control: no-store.
- Lưu đồng thời cặp hỏi/đáp và nguồn trong transaction; xử lý gửi lỗi và từ chối lượt song song dùng ngữ cảnh cũ bằng HTTP 409.
- Database: migration 20261120_chat_history thêm ChatConversation và các cột nullable ChatMessage.conversationId, position, sources; xếp tin cũ vào Hội thoại trước đây theo từng tài khoản, giữ nguyên ID/nội dung. Nguồn cũ không thể khôi phục vì trước đó chưa lưu.
- Kiểm chứng: database PostgreSQL thử nghiệm riêng + HTTP thật đã đạt bảo toàn tin cũ, phân quyền hai tài khoản, phân trang, lưu/đọc nguồn, ngữ cảnh từ server, lỗi upstream không lưu dở và xung đột gửi song song. Script: backend/test/chatHistory.integration.cjs (cần database thử nghiệm riêng có fixture cũ + migration, không chạy trên database thật).
- Kiểm tra Chrome với dữ liệu giả đã đạt mở lịch sử, tiếp tục, tải lại trang, chat mới, Markdown/nguồn, lỗi và thử lại, chiều rộng điện thoại. Backend/frontend build và ESLint frontend đạt.
- Đã triển khai backend/frontend lên khmt01; migration tự áp thành công. Source và bản sao lưu database đầy đủ (asdr-before-chat-history.dump, quyền 600) tại /home/khmt01/Luan_workspace/asdr/chat-history-update/backup-20261120-153352. Kiểm chứng toàn bộ 20 ID tin nhắn cũ còn nguyên và quan hệ chủ sở hữu hợp lệ. Qua domain thật: lịch sử chưa đăng nhập trả 401, đã đăng nhập trả 200, mở lại tin cũ thành công và gói giao diện có các nút lịch sử/chat mới.

## 2026-11-20 — Sửa câu trả lời lẫn chữ tiếng Trung

- Nguyên nhân: model đa ngôn ngữ có thể sinh từ tiếng Trung xen vào tiếng Việt; trước đó chatbot_core.py chỉ nhắc ngôn ngữ trong prompt, chưa kiểm tra đầu ra. Đây là lỗi nội dung do model sinh, không phải lỗi render Markdown.
- Siết prompt: diễn giải bằng tiếng Việt, giữ được tên riêng/thuật ngữ tiếng Anh, không bắt chước lỗi ngôn ngữ trong lịch sử.
- Thêm kiểm tra ký tự theo bảng chữ cái ở câu trả lời cuối: cho tiếng Việt/Anh dùng Latin và ký hiệu khoa học Greek; phát hiện chữ Hán và các bảng chữ cái khác bị trộn (thử thực tế còn gặp chữ Nga).
- Nếu phát hiện, yêu cầu model viết lại toàn bộ câu trả lời đúng tiếng Việt, giữ ý, Markdown và mã nguồn; tối đa một lượt sửa và không gọi lại retriever. Gộp lượt này với bước sửa trích dẫn sẵn có. Câu bình thường không phát sinh lượt gọi model thêm.
- Nếu vẫn còn chữ ngoại ngữ sau bước sửa, trả lỗi dịch vụ để thử lại; không xóa chữ để che lỗi và không lưu câu trả lời lỗi vào lịch sử website.
- Không thay đổi cơ chế LLM tự chọn tool, model, database hay dữ liệu embedding. Tin nhắn cũ trong lịch sử không tự chỉnh sửa; cần hỏi lại để nhận câu mới.
- Kiểm tra: 13 unittest (ngôn ngữ + agent graph) đạt; API RAG thật trả HTTP 200 cho ASD là gì trong khoảng 3,87 giây, một nguồn, không có chữ ngoại ngữ. NVIDIA thật đã sửa câu thử trộn tiếng Trung/Nga và giữ mã [1].
- Giới hạn: kiểm tra ngôn ngữ không xác nhận tính đúng chuyên môn. Trong các lượt thử vẫn quan sát thấy cách dịch thuật ngữ chưa đúng và có lượt thiếu dẫn nguồn; các vấn đề này chưa được xử lý trong bản sửa ngôn ngữ.
- Đã triển khai RAG lên khmt01. Sao lưu core gốc tại /home/khmt01/Luan_workspace/asdr/chat-language-update/backup-20261120-160738; bản trung gian tại backup-20261120-161121. Source local: E:/AI4Life/2026/ASD_Agent_New/chatbot_core.py; test: test_chatbot_language.py.

## 2026-11-20 — Chẩn đoán lỗi hỏi tiếp và phân biệt lỗi chatbot

- Ảnh người dùng: câu trả lời tự đếm số lần hỏi lại, sau đó lượt Dấu hiệu sớm? báo Trợ lý tạm thời chưa phản hồi được.
- Log RAG xác nhận hai POST /chat trả 503; log cũ chỉ có trạng thái, không có exception cụ thể, nên chưa thể kết luận chính xác hai lượt đó lỗi do kiểm tra ngôn ngữ, model, timeout hay nguyên nhân khác. Không coi việc tái hiện thành công là đã xác nhận/sửa hết nguyên nhân 503 trước đó.
- Tái hiện bằng hội thoại giả: model có thể dùng lại mã [1] của tin cũ mà không truy xuất ở lượt mới. Prompt được bổ sung để hiểu câu hỏi tiếp theo chủ đề hiện tại, không dùng tin cũ làm chứng cứ, kiên nhẫn khi hỏi lại và không đếm số lần hỏi. LLM tiếp tục tự quyết định gọi tool.
- RAG thêm ResponseLanguageError và mã CHAT_LANGUAGE_ERROR, CHAT_MODEL_OUTPUT_ERROR, CHAT_TIMEOUT, CHAT_UPSTREAM_ERROR, CHAT_INTERNAL_ERROR, CHAT_BUSY; mỗi lượt có X-Request-ID. Log chỉ ghi mã lỗi, loại exception và mã request; không ghi nội dung chat/response, thông báo exception hoặc secrets.
- Backend chuyển các mã đã cho phép thành thông báo tiếng Việt cụ thể và trả error/message; không hiển thị nguyên văn lỗi nội bộ từ upstream. Frontend hiện tại đã đọc message nên không cần đổi giao diện.
- Kiểm chứng: 15 unittest Python đạt; test mapping lỗi backend đạt; backend build đạt. API thật với Dấu hiệu sớm? và lịch sử giả trả 200 khoảng 2,81 giây, có request ID và không lẫn bảng chữ cái khác. Domain thật /api/chat/conversations trả 401 khi chưa đăng nhập, xác nhận proxy hoạt động sau cập nhật.
- Giới hạn còn thấy: lượt hỏi tiếp giả lập vẫn có thể thiếu nguồn thật và mang mã [1] từ ngữ cảnh; bổ sung prompt chưa bảo đảm sửa hoàn toàn vấn đề này. Chưa tái hiện chính xác lỗi 503 theo lịch sử thật. Bước tự trích lịch sử production để gửi tới NVIDIA bị xét duyệt tự động từ chối; không thực hiện, chỉ dùng dữ liệu giả.
- Đã cập nhật RAG/backend lên server; không đổi schema/data database. Backup source: /home/khmt01/Luan_workspace/asdr/chat-error-check/backup-20261120-162448.

## 2026-11-20 — Khôi phục thông tin nguồn cho câu hỏi tiếp trong chatbot

- Nguyên nhân đã tái hiện: model có thể dùng mã [1] từ lịch sử hoặc bỏ toàn bộ mã mà không truy xuất ở lượt hiện tại. format_result cũ chỉ ánh xạ các mã hợp lệ trong evidence của lượt đó, nên trả sources rỗng; giao diện vì vậy không có tên/link/đoạn nguồn để hiển thị. Đây không phải lỗi Markdown hay CSS ẩn nguồn.
- Thêm kiểm tra yêu cầu nguồn bằng LLM khi bản nháp chưa có tài liệu/mã nguồn, không phân loại câu hỏi bằng từ khóa. Nếu bản nháp cần chứng cứ hoặc dẫn mã không hợp lệ, cho agent một lượt kiểm tra lại với công cụ hiện có, giữ tool_choice tự động và ngân sách tối đa hai lần tìm kiếm.
- Khi vẫn chưa truy xuất được tài liệu cho câu trả lời cần nguồn, hoặc còn mã tham chiếu không hợp lệ, trả CHAT_CITATION_ERROR; backend kiểm tra thêm mọi mã [n] đều có metadata tương ứng trước khi lưu cặp tin nhắn.
- Khi đã truy xuất được tài liệu thật nhưng model không đánh số, giữ lại metadata từ công cụ (usage=retrieved), hiển thị Tài liệu đã tra cứu. Khi có mã hợp lệ, usage=cited và hiển thị Nguồn tham khảo. Không tự tạo tên/link nguồn, không giả rằng các tài liệu tra cứu là trích dẫn từng ý đã được thẩm định.
- Giao diện thêm ghi chú cho tin cũ có [n] nhưng thiếu metadata. Không thể khôi phục nguồn thật chỉ từ [1]; cần hỏi lại. Nguồn và usage của câu trả lời mới được lưu trong ChatMessage.sources JSON sẵn có, không cần migration hoặc ghi lại dữ liệu cũ.
- Kiểm chứng: 23 unittest Python; test proxy backend (mã lỗi, chặn mã không có nguồn, giữ metadata); ba test Markdown frontend; ESLint và build backend/frontend đạt. NVIDIA thật đã trả nguồn cho Cách sàng lọc. Tình huống cố ý cho bản nháp không có mã nguồn cũng tra lại được tám đoạn tài liệu thật trong khoảng 5,77 giây.
- Sau triển khai: HTTP RAG hi trả 200 không nguồn khoảng 2,33 giây; Cách sàng lọc với lịch sử giả trả 200 khoảng 9,81 giây và tám đoạn nguồn usage=retrieved. Domain công khai trả 200, có nhãn nguồn mới; API chưa đăng nhập trả 401. Không dùng lịch sử thật trong các lượt thử.
- Giới hạn: kiểm tra nguồn không xác minh độ đúng của từng mệnh đề; kiểm tra ngôn ngữ vẫn có thể từ chối câu trả lời nếu model tiếp tục lẫn chữ sau bước sửa. Lượt LLM kiểm tra nguồn có thể tăng thời gian khi bản nháp chưa có chứng cứ, kể cả xã giao.
- Đã triển khai RAG/backend/frontend trên khmt01. Backup source ban đầu: /home/khmt01/Luan_workspace/asdr/chat-source-update/backup-20261120-165825; bản trung gian trước khi giữ metadata không có mã: revision-backup-20261120-170118. Không đổi model, embedding hoặc schema database.

## 2026-11-20 — Sửa lỗi model hiển thị thành thông báo Cloudflare trong chat

- Log đối chiếu lượt lỗi: RAG ghi CHAT_LANGUAGE_ERROR/ResponseLanguageError, backend trả 502 và nginx ghi POST /api/chat 502. Giao diện người dùng hiển thị thông báo Cloudflare tiếng Anh. Chưa có bằng chứng máy chủ quá tải hoặc cấu hình tunnel hỏng; đây là lỗi từ bước kiểm tra ngôn ngữ đã xác nhận trong log.
- RAG sửa các từ bị lẫn bảng chữ cái khác bằng mapping JSON do LLM đề xuất (ví dụ hạn制 thành hạn chế), thay vì yêu cầu viết lại toàn bộ câu trả lời. Chỉ gửi bản nháp và danh sách từ lỗi cho bước biên tập, không đưa lịch sử/tool messages vào bước này. Giữ nguyên phần còn lại, Markdown và mã nguồn.
- Mapping phải đủ đúng các khóa từ lỗi, giá trị không rỗng/không còn chữ ngoại ngữ/không thêm mã nguồn; vẫn từ chối nếu không sửa được, không xóa từ để che lỗi. Chỉ có tối đa một lượt sửa, không đổi model hay cơ chế chọn công cụ.
- Backend chuyển các lỗi đầu ra model/nguồn/ngôn ngữ và timeout đã nhận diện thành JSON 503 với mã lỗi ứng dụng, thay vì dùng 502/504 ở biên công khai. API RAG nội bộ giữ mã lỗi riêng như trước.
- Frontend thêm chatErrors.ts: chỉ hiện thông báo tiếng Việt theo mã lỗi đã cho phép; không đưa nguyên HTML, văn bản Cloudflare hoặc message tùy ý từ proxy vào khung chat. Phân biệt lỗi ngôn ngữ, nguồn, timeout, đăng nhập, xung đột hội thoại và mất kết nối. Chỉ dùng cho chat, không thay đổi bộ đọc lỗi của các tính năng khác.
- Kiểm chứng: 22 unittest Python đạt; hai test backend, gồm HTTP Express thật với RAG giả trả lỗi ngôn ngữ xác nhận JSON 503 trước mọi ghi database; sáu test frontend về Markdown/lỗi Cloudflare đạt. ESLint và build frontend, TypeScript/backend build đạt.
- NVIDIA thật sửa câu giả trộn Trung/Nga trong khoảng 0,86 giây, giữ nguyên Markdown và [1]. Sau triển khai, API thật trả 200 cho Dấu hiệu sớm? với lịch sử giả trong khoảng 9,61 giây, có bảy đoạn nguồn và không lẫn bảng chữ cái khác. Domain thật 200, bundle có thông báo lỗi tiếng Việt mới, API chưa đăng nhập 401.
- Đã triển khai RAG/backend/frontend lên khmt01. Backup source: /home/khmt01/Luan_workspace/asdr/chat-edge-fix/backup-20261120-171653. Không thay đổi schema hoặc dữ liệu database; không đọc/gửi lịch sử chat production để tái hiện.
- Giới hạn: sửa từ không thẩm định độ đúng kiến thức hoặc mọi sắc thái diễn đạt; nếu model không trả mapping hợp lệ thì vẫn báo lỗi ngôn ngữ bằng thông báo rõ ràng.

## 2026-11-20 — Đơn giản hóa RAG và tự kiểm thử nhiều lượt

- Bỏ requires_sources JSON, repair_unavailable_citations, CitationError và vòng sửa nguồn bằng LLM. Agent vẫn tự chọn search_knowledge qua native tool_choice=auto, tối đa hai lượt tra cứu; không phân loại câu hỏi bằng từ khóa.
- Nguồn lấy trực tiếp từ evidence của công cụ trong lượt hiện tại, luôn giữ tên/link/đoạn trích và gộp các đoạn cùng tài liệu. Metadata không phụ thuộc model viết đúng [n]. Mã số trong nội dung model được bỏ để ứng dụng tự trình bày danh sách tài liệu đã tra.
- Lịch sử assistant bỏ mã nguồn cũ trước khi gửi lại model. Tra cứu không có kết quả trả thông báo giới hạn bình thường với HTTP 200; không biến thành lỗi nguồn. Các lỗi kết nối, model chưa hoàn tất hoặc ngôn ngữ vẫn dùng mã lỗi dịch vụ riêng.
- Chọn Nemotron 3.5 Super VL 120B A12B qua NVIDIA làm model mặc định mới, bật reasoning cho agent chọn tool và giữ bước biên tập từ ở chế độ ngắn. Không hiển thị reasoning_content. .env production không có NVIDIA_CHAT_MODEL ghi đè; khóa NVIDIA và dữ liệu embedding không đổi.
- Căn cứ cấu hình: NVIDIA ghi nhận Lightning khi reasoning tắt có thể trả planning text thay tool call. Tham khảo https://github.com/NVIDIA-AI-Blueprints/nemotron-voice-agent/blob/main/docs/how-to/configure-llm.md#reasoning-thinking-onoff và settings.yaml trong cùng repository (reasoning_budget ở cấp request).
- So sánh trực tiếp: Lightning reasoning tắt chỉ đạt 6/12 ca nguồn/xã giao; bật reasoning đạt 11/12, còn một lỗi sửa từ. Super reasoning bật đạt 12/12 trên hai vòng gồm chào hỏi, ASD là gì, hỏi tiếp dấu hiệu, sàng lọc, hỏi lặp và ngoài phạm vi. Mọi câu kiến thức trong bộ thử đều gọi tool và nguồn/quote được kiểm tra thuộc kết quả của lượt đó.
- Đã đọc lại câu trả lời thử, không chỉ kiểm tra status. Báo cáo gồm câu hỏi giả, câu trả lời, tên nguồn, số lượt model/tool và thời gian tại E:/AI4Life/2026/ASD_Agent_New/test_results/rag_simplified_super_20261120.json. Kết quả này không phải thẩm định y khoa hoặc bảo đảm mọi đầu vào sau này đều đúng.
- Các model so sánh khác không chọn: Llama 3.3 70B trả 410; Mistral/Gemma 4 chậm/timeout ở endpoint thử; Nemotron Super tắt reasoning bỏ tool trong probe. Không triển khai những cấu hình đó.
- Kiểm chứng: 23 unittest Python, hai test proxy/HTTP backend và build backend đạt. Kiểm tra HTTP với PostgreSQL riêng đạt lưu/khôi phục sources JSON, giữ tin cũ, phân quyền hai tài khoản, phân trang và xung đột gửi song song. Không dùng database thật cho thử ghi dữ liệu.
- Chrome trên website công khai với API/tài khoản giả lập đạt hiển thị Markdown/nguồn, mở lại, tải lại, chat mới, gửi lỗi/thử lại và chiều rộng mobile; đã xem ảnh kết quả. Đây là kiểm thử giao diện giả lập API, không phải kiểm thử tài khoản thật từ đầu đến cuối.
- Đã triển khai RAG/backend lên khmt01; không cần sửa frontend hoặc migration. Sau triển khai, API RAG thật với Dấu hiệu sớm? và lịch sử giả trả 200 trong khoảng 11,35 giây, năm nguồn, retrieval_status=found; proxy domain thật trả 401 khi chưa đăng nhập. Không đọc/gửi lịch sử production tới NVIDIA để kiểm thử.
- Source gốc được sao lưu tại /home/khmt01/Luan_workspace/asdr/chat-simplify-update/backup-20261120-194853; báo cáo 12/12 trên server là chat-simplify-update/evaluation-super.json. Những khẳng định/giao diện nguồn cũ vẫn giữ nguyên theo dữ liệu đã lưu; không gắn nguồn đoán cho tin cũ.

## 2026-11-20 — Giảm reasoning budget từ 512 xuống 256

- Đo so sánh 24 lượt giả lập: sáu câu hỏi × hai vòng × hai cấu hình. Cùng câu hỏi/lịch sử cho mỗi cặp, đảo thứ tự cấu hình giữa hai vòng để giảm ảnh hưởng thứ tự và tải dịch vụ. Không dùng lịch sử người thật.
- Câu kiến thức ASD: thời gian trung bình 14,03 giây ở 512 và 9,86 giây ở 256, giảm khoảng 29,7% trong bộ thử. Tất cả lượt: trung bình 10,77 → 7,48 giây; trung vị 12,78 → 7,95 giây.
- Hai cấu hình đều đạt 12/12 ca kiểm tra quyết định gọi tool, có/không có nguồn theo trường hợp và không lẫn bảng chữ cái khác. Các ca gồm chào hỏi, ASD là gì, hỏi tiếp dấu hiệu, sàng lọc, hỏi lặp và ngoài phạm vi. Đã đọc lại mẫu câu trả lời 256; không coi đây là thẩm định y khoa hoặc kiểm chứng từng mệnh đề.
- NVIDIA usage ghi reasoning_tokens ở nhiều lượt viết câu trả lời là 511 với cấu hình 512 và 255 với cấu hình 256, xác nhận ngân sách có hiệu lực trên endpoint thử.
- Đã đổi duy nhất reasoning_budget mặc định sang 256; max_tokens vẫn 2048, cùng model Nemotron Super, giữ nguyên cơ chế agent/tool và nguồn. 23 unittest candidate đạt, gồm kiểm tra payload thực sự gửi budget 256 và không lộ reasoning_content.
- Báo cáo đầy đủ: E:/AI4Life/2026/ASD_Agent_New/test_results/reasoning_budget_comparison_20261120.json; tóm tắt: reasoning_budget_summary_20261120.json. Báo cáo server: /home/khmt01/Luan_workspace/asdr/reasoning-budget-test/comparison.json.
- Đã cập nhật riêng RAG trên khmt01; backup source 512 tại /home/khmt01/Luan_workspace/asdr/reasoning-budget-test/backup-20261120-201026. Không thay đổi model, frontend, backend website hoặc database.
- Giới hạn: mẫu thử nhỏ, độ trễ mạng/tải NVIDIA và độ dài câu trả lời vẫn biến động; mức cải thiện này không bảo đảm cho mọi câu hỏi. Giao diện hiện vẫn chờ câu trả lời hoàn chỉnh, chưa có streaming.

- Kiểm tra sau triển khai: xác nhận payload đang chạy dùng 256, API câu hỏi tiếp giả lập trả HTTP 200 trong 11,91 giây, sáu nguồn và không lẫn chữ ngoại ngữ.

