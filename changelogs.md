# AIMBRACE — Changelogs

Nhật ký thay đổi source code, logic xử lý, giao diện, database và triển khai của dự án. Mục mới nhất đặt ở đầu file. Một ngày có thể có nhiều mục nếu các đợt cập nhật được triển khai riêng.

Các mục lịch sử khởi tạo được tổng hợp từ `master_prompt.md` và source hiện tại. Ngày cập nhật code và ngày triển khai được ghi riêng khi có thông tin. Kết quả kiểm thử thuộc lần thực hiện được nêu trong từng mục.

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
