# ASDr — nền tảng AIMBRACE (AI for Life 2026)

Ứng dụng web hỗ trợ **sàng lọc tham khảo** dấu hiệu ASD ở trẻ từ video dáng đi: OpenPose trích khung xương BODY_25, mô hình ST-GCN cho điểm sàng lọc, backend tính thêm các chỉ số dáng đi diễn giải được. Có đăng nhập USER/ADMIN, hồ sơ trẻ, xác nhận đồng ý của phụ huynh, hàng đợi phân tích bền vững, lịch sử kết quả, kiến thức ASD và công cụ Admin Skeleton.

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
npm run prisma:deploy       # áp migration cho DB mới (DB dùng chung của nhóm: xem master_prompt.md §5)
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

```bash
cd backend && npm run typecheck && npm test
cd frontend && npm run build
cd API/tests && python -m unittest test_anonymize test_server
python -m unittest discover -s research_src/tests
```

## API chính

- `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me`
- `GET/POST /api/children`, `GET/POST/DELETE /api/children/:id/consent`, `GET /api/consent/current`
- `POST /api/screenings/upload?childId=` (multipart `video`) → `POST /api/screenings/:id/process` → poll `GET /api/screenings/:id`
- `GET /api/screenings` (lọc `risk_level`, `from`, `to`)
- Admin: `GET /api/admin/stats`, `GET /api/admin/ml-health`, `/api/admin/skeleton/*`
