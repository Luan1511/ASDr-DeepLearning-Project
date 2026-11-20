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

## Chưa phát hành

Ghi các thay đổi đang làm tại đây, sau đó chuyển sang mục có ngày khi hoàn tất. Ghi rõ môi trường đã áp dụng để theo dõi phần còn chờ triển khai.

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
