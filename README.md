# ASDr — nền tảng AIMBRACE (AI for Life 2026)

Ứng dụng web hỗ trợ **sàng lọc tham khảo** dấu hiệu ASD ở trẻ từ video dáng đi: OpenPose trích khung xương BODY_25, mô hình ST-GCN cho điểm sàng lọc, backend tính thêm các chỉ số dáng đi diễn giải được. Có đăng nhập USER/ADMIN, hồ sơ trẻ, xác nhận đồng ý của phụ huynh, hàng đợi phân tích bền vững, lịch sử kết quả, kiến thức ASD và công cụ Admin Skeleton.

Ngoài sàng lọc video còn có: bảng hỏi M-CHAT-R/F, bài tập bắt chước có chấm điểm và nhắc trực tiếp, cá nhân hoá hồ sơ trẻ, chia sẻ hồ sơ với bác sĩ, robot đồng hành Bạn Bin (trò chuyện, giọng nói, nhận ra người thân qua camera) và góc cộng đồng phụ huynh. Một số phần bật/tắt bằng biến môi trường (`EXERCISE_MODE`, `MCHAT_MODE`, `DOCTOR_MODE`).

> Kết quả chỉ mang tính tham khảo, không thay thế chẩn đoán y khoa.

Tài liệu đầy đủ (kiến trúc, tiến độ, quy tắc, sự cố thường gặp): [master_prompt.md](master_prompt.md). Docker: [DOCKER_DEPLOY.md](DOCKER_DEPLOY.md). Đánh giá & hiệu chỉnh mô hình: [research_src/EVALUATION.md](research_src/EVALUATION.md).

## Cấu trúc

- `backend/` — Express + TypeScript + Prisma (PostgreSQL) + JWT + Multer; hàng đợi sàng lọc trong DB.
- `frontend/` — React 18 + Vite + TypeScript + Tailwind.
- `API/` — máy chủ ML Python (FastAPI): OpenPose + ST-GCN (`server_openpose.py`), Llama chat (`server_llama.py`, chưa nối).
- `research_src/` — script huấn luyện/đánh giá (ST-GCN, BiLSTM, SRM, fine-tune, calibration).

## Chạy local

Yêu cầu: Node.js 20+, PostgreSQL 14+, (tuỳ chọn) máy GPU chạy `API/server_openpose.py`.

```bash
# Backend
cd backend
cp .env.example .env        # sửa DATABASE_URL, JWT_SECRET, OPENPOSE_SERVER_URL, OPENPOSE_API_KEY
npm install
npm run prisma:generate
npm run prisma:deploy       # áp migration cho DB mới
npm run prisma:seed         # tuỳ chọn: tài khoản + dữ liệu demo
npm run dev                 # http://localhost:4000/api/health

# Frontend
cd frontend
cp .env.example .env        # VITE_API_URL=http://localhost:4000/api
npm install
npm run dev                 # http://localhost:5173
```

Tài khoản demo sau khi seed: `admin@asdr.local` / `admin123`, `user@asdr.local` / `user123` (chỉ dùng cho môi trường thử).

Không có máy ML? Đặt `BYPASS_EXTRACT_API=true` trong `backend/.env` để nhận kết quả mô phỏng (được đánh dấu rõ trên giao diện).

## Kiểm thử

### Trò chuyện riêng giữa phụ huynh

Trong Cộng đồng, chọn **Nhắn riêng** ở bài không ẩn danh hoặc hồ sơ thành viên để gửi lời mời. Người nhận vào **Tin nhắn → Lời mời** và chấp nhận trước khi hai bên trò chuyện. Chat dùng biệt danh, chỉ hỗ trợ chữ; có chặn và báo cáo từng tin. Admin xử lý bản sao tin bị báo cáo tại `/admin/community`, không mở được toàn bộ hội thoại.

Kiểm tra tích hợp chat khi backend local và PostgreSQL cổng 5435 đang chạy: `cd backend`, rồi `node scripts/checkCommunityChat.cjs`. Script tạo tài khoản riêng và tự dọn dữ liệu thử.

```bash
cd backend && npm run typecheck && npm test
cd backend && npm run test:e2e          # PostgreSQL tạm + ML giả, tự dọn
cd frontend && npm run lint && npm test && npm run build
cd backend && npm run sandbox           # chạy thử bằng tay không cần DB thật; frontend: npm run dev:sandbox
cd API/tests && python -m unittest test_anonymize test_server
python -m unittest discover -s research_src/tests
```

## API chính

- `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me`
- `GET/POST /api/children`, `GET/POST/DELETE /api/children/:id/consent`, `GET /api/consent/current`
- `POST /api/screenings/upload?childId=` (multipart `video`) → `POST /api/screenings/:id/process` → poll `GET /api/screenings/:id`
- `GET /api/screenings` (lọc `risk_level`, `from`, `to`)
- Admin: `GET /api/admin/stats`, `GET /api/admin/ml-health`, `/api/admin/skeleton/*`
