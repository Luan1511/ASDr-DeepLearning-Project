# ASDr (Local Full‑Stack Demo)

ASDr là demo full‑stack chạy local: upload video của trẻ, “AI mock” xử lý và trả về kết quả sàng lọc tham khảo (risk level + các chỉ số + khuyến nghị). Có đăng nhập/đăng ký, role `USER/ADMIN`, hồ sơ trẻ, lịch sử kết quả + lọc, knowledge base, và admin stats.

> Lưu ý: Kết quả chỉ mang tính tham khảo, không thay thế chẩn đoán y khoa.

## Yêu cầu

- Node.js `20.12.x` (đúng với cấu hình hiện tại)
- PostgreSQL 14+

## Cấu trúc

- `backend/` — Express + TypeScript + Prisma + PostgreSQL + Multer + JWT
- `frontend/` — React + Vite + TypeScript + Tailwind

## Chạy local

### 1) Backend

```bash
cd backend
npm install
```

Tạo file `.env` từ `.env.example`:

```bash
copy .env.example .env
```

Tạo DB Postgres (ví dụ tên DB là `asdr`) và cập nhật `DATABASE_URL` trong `.env`.

Chạy migrate + seed:

```bash
npm run prisma:generate
npm run prisma:migrate
npm run prisma:seed
```

Chạy server:

```bash
npm run dev
```

Backend mặc định chạy: `http://localhost:4000/api`

### 2) Frontend

```bash
cd frontend
npm install
```

Tạo file `.env` từ `.env.example`:

```bash
copy .env.example .env
```

Chạy frontend:

```bash
npm run dev
```

Mở: `http://localhost:5173`

## Tài khoản demo (seed)

- Admin: `admin@asdr.local` / `admin123`
- User: `user@asdr.local` / `user123`

## API chính

- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/auth/me`
- `GET /api/children`, `POST /api/children`
- `POST /api/screenings/upload` (multipart: `video`, body: `childId`)
- `POST /api/screenings/:id/process` (mock background)
- `GET /api/screenings` (filter: `risk_level`, `from`, `to`)
- `GET /api/admin/stats` (admin only)

## Ghi chú

- Upload video được lưu local trong `backend/uploads/`.
- Mock AI xử lý theo hàng đợi in-process (không cần worker/queue ngoài).
