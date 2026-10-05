# ASDr / AIMBRACE — Triển khai bằng Docker

> Trạng thái: cấu hình đã được sửa ngày 2026-10-05 nhưng **chưa build thử** (Docker Desktop không chạy trên máy phát triển lúc sửa). Hãy chạy thử theo các bước dưới đây trước khi dùng cho demo.

## Thành phần

| Service | Mặc định | Ghi chú |
|---|---|---|
| `db` | PostgreSQL 16, `127.0.0.1:5433` | dữ liệu trong volume `asdr_db_data`, múi giờ UTC |
| `backend` | `http://localhost:4000` | tự chạy `prisma migrate deploy` khi khởi động |
| `frontend` | `http://localhost:3000` | nginx phục vụ SPA và proxy `/api` → backend |
| `ml-api` (profile `ml`) | `http://localhost:8000` | **không** có sẵn OpenPose, xem mục ML server |

## Các bước

```bash
# 1. Biến môi trường cho compose (mật khẩu DB, JWT_SECRET, ML_API_KEY, URL ML server)
cp .env.example .env    # rồi sửa các giá trị change-me

# 2. Build và chạy db + backend + frontend
docker compose up -d --build

# 3. (Tuỳ chọn) dữ liệu demo — chạy từ máy dev (image runtime không có tsx)
cd backend
DATABASE_URL="postgresql://postgres:<POSTGRES_PASSWORD>@localhost:5433/asdr" npm run prisma:seed
```

- Frontend: <http://localhost:3000>, backend: <http://localhost:4000/api/health>.
- `frontend` được build với `VITE_API_URL=/api` (đường dẫn tương đối) nên trình duyệt gọi API qua nginx, không cần CORS.

## ML server (OpenPose + ST-GCN)

Cách đã kiểm chứng: **chạy trực tiếp trên máy GPU** (như hiện tại) rồi đặt `OPENPOSE_SERVER_URL` trong `.env` trỏ tới máy đó (ngrok hoặc `http://host.docker.internal:8000`).

```bash
# trên máy GPU, trong thư mục API/
pip install -r requirements.txt
export ML_API_KEY=<cùng giá trị với backend>     # khuyến nghị
export VIDEO_RETENTION=blurred                   # blurred | none | raw
python3 -m uvicorn server_openpose:app --host 0.0.0.0 --port 8000
```

Profile `ml` của compose chỉ dùng được khi có **bản build OpenPose cho Linux tương thích với container** (CUDA/glibc/thư viện), mount qua `OPENPOSE_HOST_DIR`. Checkpoint (`finetuned_best_model.pth`) và `calibration.json` đặt trong `API/ASD_Model/` (không commit vào git).

```bash
docker compose --profile ml up -d --build
# và đặt OPENPOSE_SERVER_URL=http://ml-api:8000 trong .env
```

## Lưu ý quan trọng

- **Không trỏ backend trong compose vào DB dùng chung của nhóm** (`100.104.148.57:5433`): DB đó có lịch sử migration khác repo, `prisma migrate deploy` sẽ lỗi. Nếu bắt buộc phải trỏ vào đó, đặt `SKIP_MIGRATIONS=1` cho service `backend` và áp migration thủ công theo `master_prompt.md` §5.
- Video gốc người dùng upload nằm ở `backend/uploads` (volume) và được xoá sau khi phân tích thành công (`RETAIN_UPLOADED_VIDEOS=false`).
- Kiểm tra máy GPU: nếu `/health` báo `cuda_available: false` hoặc OpenPose lỗi `Cuda check failed ... no CUDA-capable device`, container/máy chủ không thấy GPU (driver, `--gpus all`, NVIDIA Container Toolkit).

## Lệnh thường dùng

```bash
docker compose logs -f backend
docker compose ps
docker compose down          # dừng
docker compose down -v       # dừng và XOÁ dữ liệu DB (cẩn thận)
```

## Checklist production

- [ ] `JWT_SECRET`, `POSTGRES_PASSWORD`, `ML_API_KEY` mạnh và khác giá trị mẫu
- [ ] HTTPS ở reverse proxy phía trước frontend
- [ ] `CORS_ORIGIN` đúng domain thật
- [ ] Sao lưu volume `asdr_db_data`
- [ ] ML server đặt sau API key, chạy bản `server_openpose.py` mới (có `/health`, làm mờ mặt)
