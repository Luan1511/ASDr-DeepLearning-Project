# AIMBRACE — Master Prompt (Handoff cho AI agent và thành viên nhóm)

> **Cập nhật:** 2026-10-05 (sau khi triển khai Giai đoạn 1–2)
> **Nguồn:** đề cương "AIMBRACE – AI for Life 2026" (25/09/2026), khảo sát repo tại commit `c6b011e`, và toàn bộ thay đổi chưa commit trong working tree (Giai đoạn 1–2, xem §11).
> **Vai trò:** nguồn sự thật (source of truth) khi tiếp quản repo. Đọc file liên quan trước khi sửa, giữ nguyên thay đổi đang có của người dùng, sửa hẹp và có kiểm chứng.
> **Quy định của chủ dự án:** không dùng git trong project này (xem §13, §14). Mọi lệnh git để người dùng tự chạy.

## Mục lục

1. [Dự án là gì](#1-dự-án-là-gì)
2. [Phạm vi theo đề cương → module kỹ thuật](#2-phạm-vi-theo-đề-cương--module-kỹ-thuật)
3. [Kiến trúc hiện tại](#3-kiến-trúc-hiện-tại)
4. [Cấu trúc repo](#4-cấu-trúc-repo)
5. [Môi trường, chạy và kiểm chứng](#5-môi-trường-chạy-và-kiểm-chứng)
6. [Backend (Express + Prisma)](#6-backend-express--prisma)
7. [ML service (API/)](#7-ml-service-api)
8. [Nghiên cứu và đánh giá mô hình (research_src/)](#8-nghiên-cứu-và-đánh-giá-mô-hình-research_src)
9. [Frontend (React + Vite)](#9-frontend-react--vite)
10. [Admin Skeleton](#10-admin-skeleton)
11. [TIẾN ĐỘ DỰ ÁN](#11-tiến-độ-dự-án)
12. [Vấn đề còn tồn tại (theo mức ưu tiên)](#12-vấn-đề-còn-tồn-tại-theo-mức-ưu-tiên)
13. [Roadmap](#13-roadmap)
14. [Quy tắc làm việc cho agent](#14-quy-tắc-làm-việc-cho-agent)
15. [Debugging playbook](#15-debugging-playbook)
16. [Nhật ký phiên 2026-10-05 và checklist việc cần làm](#16-nhật-ký-phiên-2026-10-05-và-checklist-việc-cần-làm)

---

## 1. Dự án là gì

| Mục | Nội dung |
|---|---|
| Tên đề tài | **AIMBRACE – Nền tảng AI hỗ trợ sàng lọc, theo dõi và cá nhân hóa hoạt động của trẻ có dấu hiệu ASD** |
| Cuộc thi | AI for Life 2026 — Khoa Khoa học Máy tính, Trường ĐH CNTT và Truyền thông Việt–Hàn (VKU), Đà Nẵng |
| Nhóm | Phạm Viết Chí Luân (chủ repo), Nguyễn Văn Lâm, Nguyễn Văn Phụng — ngành Trí tuệ nhân tạo, lớp 23AI |
| GVHD | TS. Lê Thị Thu Nga |
| Tên trong code | Vẫn là **ASDr** (UI, package, DB `asdr`, localStorage key `asdr_token`, email demo `@asdr.local`). "AIMBRACE" mới xuất hiện trong README, chưa có trên UI. |

### 1.1 Bài toán

Trẻ có dấu hiệu rối loạn phổ tự kỷ (ASD) có thể có khác biệt trong cách thực hiện và phối hợp chuyển động. Việc quan sát vận động hiện chủ yếu làm trực tiếp: phụ thuộc người quan sát và khó ghi nhận định lượng liên tục. AIMBRACE dùng **ước lượng tư thế (OpenPose) để biến video từ camera thường thành dữ liệu skeleton 2D**, rồi dùng học máy/học sâu để:

- hỗ trợ **sàng lọc** dấu hiệu ASD từ dáng đi (video trẻ đi thẳng);
- xây dựng **môi trường luyện tập vận động có tương tác**: nhân vật hướng dẫn, đánh giá mức độ bắt chước, cá nhân hóa độ khó;
- **theo dõi tiến trình** dài hạn trên dashboard cho phụ huynh, giáo viên và chuyên viên;
- cung cấp **AI Agent** hỏi đáp kiến thức ASD có nguồn gốc, và **nhân vật LLM + Speech-to-Speech** để khuyến khích trẻ giao tiếp;
- **kết nối với cơ sở chuyên gia**, chia sẻ dữ liệu của trẻ khi phụ huynh đồng ý.

### 1.2 Nguyên tắc bất biến

1. **Không phải hệ thống chẩn đoán.** Mọi kết quả là "sàng lọc tham khảo", luôn kèm disclaimer. Không dùng "chẩn đoán", "trẻ bị tự kỷ", "mắc ASD" trong UI hay câu trả lời LLM. Điểm mô hình được gọi là **"điểm sàng lọc"**, không phải "xác suất mắc ASD".
2. **AI Agent/LLM không tư vấn lộ trình điều trị hay lời khuyên y tế.** Kiến thức ASD trả lời phụ huynh phải trích được nguồn.
3. **Quyền riêng tư của trẻ:** chỉ xử lý video khi có **consent** của phụ huynh (đã có trong code); khuôn mặt được **làm mờ** khi lưu trên máy ML; **video gốc bị xoá** khỏi backend sau khi phân tích thành công; không log tên/nội dung video; không commit video, credentials, `.env`.
4. **Không công bố hiệu năng mô hình** khi chưa chạy quy trình đánh giá subject-level trong `research_src/EVALUATION.md` (§8).
5. Ngôn ngữ UI và câu trả lời cho người dùng: **tiếng Việt**.

---

## 2. Phạm vi theo đề cương → module kỹ thuật

Ký hiệu: ✅ đã có, chạy được · 🟡 có một phần / chờ triển khai / chưa kiểm chứng thật · ⬜ chưa bắt đầu

| # | Tính năng (theo đề cương) | Module kỹ thuật | Trạng thái |
|---|---|---|---|
| F1 | AI hỗ trợ sàng lọc ASD từ chuỗi skeleton | ML `server_openpose.py` (ST-GCN + calibration), backend `screeningProcessor.ts` (hàng đợi), `screeningResult.ts`, UI `ScreeningUploadPanel` | 🟡 (luồng hoàn chỉnh; mô hình chưa được đánh giá lại; máy GPU đang lỗi CUDA) |
| F2 | Phân tích chuyển động không xâm lấn (camera thường + OpenPose 2D) | OpenPose BODY_25; đặc trưng dáng đi `gaitFeatures.ts`; làm mờ mặt `API/services/anonymize.py` | ✅ code (ML mới chưa triển khai lên máy GPU) |
| F3 | Bài tập tương tác: nhân vật hướng dẫn động tác | — (Admin Skeleton dùng để tạo chuyển động mẫu) | ⬜ |
| F4 | Đánh giá mức độ bắt chước | — | ⬜ |
| F5 | AI Agent: trợ lý phụ huynh, kiến thức ASD có nguồn | `chatMock.ts` (regex); `server_llama.py` (chưa nối) | 🟡 (mock) |
| F6 | Nhân vật LLM + Speech-to-Speech | — | ⬜ |
| F7 | Cá nhân hóa độ khó/loại/tốc độ động tác | — | ⬜ |
| F8 | Theo dõi tiến trình qua các phiên | Lịch sử sàng lọc + chỉ số dáng đi mỗi lần quay | 🟡 |
| F9 | Dashboard người chăm sóc | `HomePage`, `HistoryPage`, `AdminPage` (thống kê, hàng đợi, sức khoẻ ML) | 🟡 |
| F10 | Kết nối cơ sở chuyên gia | — | ⬜ |

---

## 3. Kiến trúc hiện tại

```text
Trình duyệt (React/Vite :5173; Docker: nginx :3000 proxy /api)
   │  axios + Bearer JWT (localStorage "asdr_token", header gắn đồng bộ khi login/logout; 401 → tự đăng xuất)
   ▼
Backend Express + TS (:4000, mọi router dưới /api)
   ├─ Prisma ──► PostgreSQL "asdr" (DB dùng chung: 100.104.148.57:5433 qua Tailscale — lịch sử migration lệch repo, §5.4)
   ├─ Consent: ConsentRecord (phụ huynh đồng ý theo từng trẻ, có thu hồi, lưu nguyên văn nội dung đã đồng ý)
   ├─ Hàng đợi bền vững: bảng ScreeningJob + worker trong process (FOR UPDATE SKIP LOCKED, heartbeat 30s,
   │   tự phục hồi job "chết" sau 2 phút, retry backoff 30s/60s, tối đa SCREENING_MAX_ATTEMPTS)
   ├─ Đặc trưng dáng đi (gaitFeatures.ts) + chất lượng video, tính từ keypoints trả về
   └─ openposeService.ts ──fetch + X-API-Key + semaphore (ML_MAX_CONCURRENCY)──►
ML server FastAPI "ASD OpenPose + ST-GCN" (:8000 trên máy GPU GTX 1650, public qua ngrok)
   ├─ openpose.bin BODY_25 → storage/asd_subjects/<subject_id>/ (keypoints, metadata, prediction)
   ├─ làm mờ mặt → input_blurred.mp4 (VIDEO_RETENTION=blurred|none|raw), xoá input.mp4 gốc
   ├─ ST-GCN finetuned_best_model.pth (+ calibration.json nếu khớp sha256) → p_asd, ngưỡng, thông tin model
   └─ /health (công khai): model, CUDA, OpenPose, calibration, chế độ lưu video, auth
(Chưa nối) Llama server FastAPI: Llama-3.2-3B-Instruct 4-bit + LoRA asd_lora_1 / asd_lora_2
```

- `subject_id` trên máy ML = `VideoUpload.id` (UUID) → khớp 1–1 với DB.
- **Máy ML đang chạy ở ngrok vẫn là bản CŨ** (không có `/health`, không API key, không làm mờ) và OpenPose trên đó đang lỗi `Cuda check failed (100 vs. 0): no CUDA-capable device is detected` (kiểm tra 2026-10-05). Backend mới tương thích ngược với bản cũ.
- Môi trường phát triển: Windows, PowerShell/Git Bash, Node 20+ (máy dev hiện có Node 24). Máy ML: Linux, OpenPose tại `/workspace/openpose/build_gtx1650_nocudnn`, Python 3.10. Workspace huấn luyện: `/home/nhomk23/workspace/NCKH_25-26/`.

---

## 4. Cấu trúc repo

```text
Main/
├─ backend/
│  ├─ prisma/               schema.prisma, migrations/ (20260521_init, 20260926_add_screening_error_message,
│  │                        20261005_screening_privacy_queue), seed.ts
│  ├─ src/app.ts            CORS, json, /api/health, mount routers, errorHandler (KHÔNG còn route /uploads công khai)
│  ├─ src/routes/           auth, children (+consent), consent, screenings, results, chat, articles,
│  │                        admin (+ml-health), skeleton, subjects*, pipeline* (*: proxy ML, chỉ ADMIN)
│  ├─ src/services/         openposeService (client ML, lỗi có phân loại), screeningProcessor (hàng đợi DB),
│  │                        screeningResult (ngưỡng/mức/khuyến nghị), gaitFeatures, consentService, aiMock, chatMock
│  ├─ src/lib/              env, prisma, consent (nội dung đồng ý), serializers, semaphore, prismaErrors
│  ├─ src/middleware/       auth, requireRole, asyncHandler, errorHandler, subjectId
│  ├─ scripts/purgeProcessedVideos.ts   xoá video gốc của các lượt đã COMPLETED (mặc định dry-run)
│  ├─ test/                 node:test — gaitFeatures (bộ dáng đi tổng hợp), screeningResult, semaphore, prismaErrors
│  └─ uploads/              video upload (gitignored; video được xoá sau khi phân tích thành công)
├─ frontend/src/
│  ├─ components/           ScreeningUploadPanel, ConsentPanel, ScreeningResultView, GaitFeaturesCard, RiskPill
│  │                        (RiskPill + ModelScoreBar), UploadDropzone, Card, AIAssistantCard, RecentResultsCard…
│  ├─ lib/                  api (401 interceptor, apiErrorCode/apiErrorMessage), types, skeleton (vẽ BODY_25),
│  │                        video (đọc thời lượng/kích thước trước upload), format
│  ├─ pages/                Home, Screening, History, Admin, AdminSkeleton, Guide, Login, …
│  └─ state/auth.tsx
├─ API/
│  ├─ server_openpose.py    FastAPI OpenPose + ST-GCN (bản mới, chưa triển khai lên máy GPU)
│  ├─ server_llama.py       FastAPI Llama LoRA (chưa nối)
│  ├─ services/             stgcn_service.py, anonymize.py (làm mờ mặt, probe video), llama_service.py
│  ├─ tests/                fake_openpose.py, helpers.py, test_anonymize.py, test_server.py
│  ├─ requirements.txt, requirements-llama.txt, Dockerfile, .dockerignore
│  ├─ ASD_Model/            (TRỐNG trong repo; checkpoint + calibration.json chỉ có trên máy GPU, gitignored)
│  ├─ Llama/                (TRỐNG; adapter trên server, gitignored)
│  └─ storage/asd_subjects/ 4 subject test cũ — VẪN ĐANG NẰM TRONG GIT kèm input.mp4 (đã gitignore, cần git rm --cached)
├─ research_src/            ST-GCN.py, BiLSTM.py, SRM.py, fine_tune.py (đã sửa), calibrate_evaluate.py,
│                           predict_dataset.py, tests/, EVALUATION.md, training_llama.py, test_llama.py
├─ docker-compose.yml, .env.example (cho compose), DOCKER_DEPLOY.md
├─ README.md
└─ master_prompt.md         file này
```

---

## 5. Môi trường, chạy và kiểm chứng

### 5.1 Dịch vụ

- Frontend dev: `http://localhost:5173` / `http://127.0.0.1:5173`. Backend dev: `http://localhost:4000`, health `GET /api/health`.
- DB dùng chung: `100.104.148.57:5433`, DB `asdr` (cần Tailscale đang kết nối). `backend/.env` trỏ `DATABASE_URL` tới đó. Không in/commit credentials.
- ML server: origin lấy từ `OPENPOSE_SERVER_URL`, nếu trống thì `EXTRACT_API_URL` (hiện là URL ngrok). Nếu máy ML yêu cầu key thì `OPENPOSE_API_KEY` (backend) phải bằng `ML_API_KEY` (ML).

### 5.2 Chạy

```powershell
# Backend
cd backend
npm install
npm run prisma:generate
npm run dev                  # predev = prisma generate (EPERM nếu có backend khác đang giữ engine, xem §15)

# Frontend
cd frontend
npm install
npm run dev -- --host 127.0.0.1

# Không có máy ML: đặt BYPASS_EXTRACT_API=true trong backend/.env (kết quả mô phỏng, UI ghi rõ)
```

ML server trên máy GPU (bản mới):

```bash
cd API
pip install -r requirements.txt          # có pandas/openpyxl; torch theo index CUDA 12.1
export ML_API_KEY=<bí mật, giống OPENPOSE_API_KEY của backend>
export VIDEO_RETENTION=blurred           # blurred | none | raw
# tuỳ chọn: OPENPOSE_BIN, OPENPOSE_MODEL_DIR, STGCN_CHECKPOINT, CALIBRATION_PATH, ML_MAX_CONCURRENT_JOBS=1
python3 -m uvicorn server_openpose:app --host 0.0.0.0 --port 8000
curl http://localhost:8000/health        # kiểm tra cuda_available, openpose_available, calibrated
```

Tài khoản demo sau seed: Admin `admin@asdr.local` / `admin123`, User `user@asdr.local` / `user123` (chỉ môi trường thử).

### 5.3 Kiểm thử tự động (tất cả đạt ngày 2026-10-05)

```bash
cd backend && npm run typecheck && npm test            # 30 test
cd frontend && npx tsc -b && npm run build              # ESLint còn 2 lỗi có sẵn trong state/auth.tsx
cd API/tests && python -m unittest test_anonymize test_server     # 18 test (OpenPose giả, checkpoint ngẫu nhiên)
python -m unittest discover -s research_src/tests       # 29 test
```

Kiểm chứng runtime: `GET /api/health`, login thật, `GET /api/auth/me`, `GET /api/admin/ml-health` (admin) cho biết ML có kết nối không, có phải bản cũ (`legacy: true`) không.

### 5.4 Migration — ĐỌC KỸ trước khi đụng DB dùng chung

- Lịch sử migration trên DB dùng chung **khác repo**: DB ghi nhận `20261003162407_init` (không có trong repo) thay vì `20260521_init` + `20260926_add_screening_error_message`; schema thực tế thì khớp. Ngày 2026-10-05 migration `20261005_screening_privacy_queue` đã được áp lên DB này bằng cách chạy đúng SQL của nó trong một transaction (`prisma db execute`), rồi `prisma migrate resolve --applied 20261005_screening_privacy_queue`. Đã kiểm tra `prisma migrate diff` → "No difference detected".
- **Không bao giờ** chạy `prisma migrate dev` (sẽ đòi reset DB chung) hay `prisma migrate deploy` (sẽ cố chạy lại init và lỗi) trên DB dùng chung.
- Quy trình cho migration mới trên DB dùng chung:
  1. `npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel <schema trước thay đổi> --script` → phải là migration rỗng (DB đúng trạng thái trước).
  2. Gói SQL của migration mới trong `BEGIN; … COMMIT;` rồi `npx prisma db execute --file <file.sql> --schema prisma/schema.prisma`.
  3. `npx prisma migrate resolve --applied <tên_migration>`; kiểm tra lại bằng `migrate diff --from-schema-datasource … --to-schema-datamodel prisma/schema.prisma --exit-code`.
- DB mới hoàn toàn (Docker, máy cá nhân): `npm run prisma:deploy`.
- Việc "baseline" lại lịch sử migration của DB chung là quyết định của nhóm.
- Schema phải **chỉ thêm** (bảng mới, cột nullable) và code mới vẫn **ghi các cột cũ còn bắt buộc** — thành viên khác có thể chạy code cũ trên cùng DB (Prisma cũ báo P2032 khi gặp NULL ở trường nó cho là bắt buộc).

---

## 6. Backend (Express + Prisma)

### 6.1 Biến môi trường (`backend/src/lib/env.ts`, validate bằng Zod; mẫu: `backend/.env.example`)

| Biến | Mặc định | Ghi chú |
|---|---|---|
| `DATABASE_URL`, `JWT_SECRET` (≥16), `JWT_EXPIRES_IN`, `PORT`, `CORS_ORIGIN` | — / 7d / 4000 / localhost:5173 | như trước |
| `MAX_UPLOAD_MB` / `SKELETON_MAX_UPLOAD_MB` | 1024 / 200 | screenings / admin skeleton |
| `OPENPOSE_SERVER_URL`, `EXTRACT_API_URL` | —, `http://localhost:8000/pipeline/asd` | chỉ dùng origin |
| `OPENPOSE_API_KEY` | (trống) | gửi header `X-API-Key` |
| `EXTRACT_API_TIMEOUT_MS` | 3 600 000 | timeout gọi ML (đọc metadata/keypoints có timeout ngắn hơn) |
| `BYPASS_EXTRACT_API` | false | kết quả mô phỏng, có nhãn `provider: mock` |
| `ML_MAX_CONCURRENCY` | 1 | số lệnh OpenPose đồng thời từ backend + số job worker chạy song song |
| `SCREENING_MAX_ATTEMPTS` / `SCREENING_POLL_INTERVAL_MS` | 3 / 3000 | hàng đợi |
| `SCREENING_THRESHOLD` / `SCREENING_TEMPERATURE` | (trống) | trống = để ML quyết định (calibration.json hoặc 0.5 / 1.0) |
| `SCREENING_HIGH_RISK_THRESHOLD` | 0.7 | chỉ dùng khi ML không gửi `high_risk_threshold` |
| `RETAIN_UPLOADED_VIDEOS` | false | false = xoá video gốc sau khi phân tích thành công |
| `CHAT_API_BASE_URL` | — | chưa dùng |

### 6.2 Data model (Prisma)

- Không đổi: `User`, `ChildProfile`, `ChatMessage`, `Article`.
- `VideoUpload` thêm: `durationMs`, `videoWidth`, `videoHeight` (đo ở trình duyệt), `videoDeletedAt` (video gốc đã xoá), `consentId`, quan hệ `job`.
- `ScreeningResult` thêm: `asdProbability` (p_asd), `decisionThreshold`, `highRiskThreshold`, `calibrated`, `modelVersion` (`<checkpoint>@<sha12>`), `gaitFeatures` (JSON). 4 cột `eyeContactScore/motorPatternScore/responseBehaviorScore/repetitiveBehaviorScore` thành **nullable, deprecated**: vẫn ghi giá trị suy ra như cũ (p_typical ×3, p_asd) chỉ để code cũ đọc được; **không trả qua API, không hiển thị**.
- Mới `ConsentRecord` (userId, childId, version, scopes[] `VIDEO_PROCESSING` bắt buộc / `RESEARCH_USE` tuỳ chọn, `statement` JSON nguyên văn, grantedAt, revokedAt).
- Mới `ScreeningJob` (videoId unique, status `QUEUED|RUNNING|SUCCEEDED|FAILED`, attempts, maxAttempts, runAfter, lockedBy, lockedAt, lastError).
- Cột thời gian là `TIMESTAMP(3)` không múi giờ, lưu UTC; DB có thể chạy múi giờ khác (máy dev: Asia/Bangkok) → trong raw SQL không dùng `NOW()` hay tham số Date trần (xem `claimJobs`).

### 6.3 Bảng API

| Method | Path | Auth | Mô tả |
|---|---|---|---|
| GET | `/api/health` | — | `{ok:true}` |
| POST | `/api/auth/register`, `/api/auth/login`, `/api/auth/logout`; GET `/api/auth/me` | —/JWT | như trước |
| GET/POST | `/api/children` | JWT | list / tạo hồ sơ trẻ (chưa có sửa/xoá) |
| GET | `/api/consent/current` | JWT | nội dung đồng ý, sinh theo cấu hình thực tế (backend có giữ video? ML làm mờ/không lưu/lưu gốc/không rõ) |
| GET/POST/DELETE | `/api/children/:id/consent` | JWT (chủ hồ sơ) | xem / đồng ý (`{accepted:true, version, scopes}`) / thu hồi |
| POST | `/api/screenings/upload?childId=` | JWT + consent | multipart `video` (.mp4/.mov/.avi/.mkv) + `childId`, `durationMs`, `videoWidth`, `videoHeight`; kiểm tra consent trước khi nhận file; 403 `CONSENT_REQUIRED` |
| POST | `/api/screenings/:id/process` | JWT + consent | đưa vào hàng đợi (idempotent; FAILED → chạy lại) → 202 |
| GET | `/api/screenings`, `/api/screenings/:id` | JWT | đã serialize: không còn `filePath`/`rawAiResponse`/4 điểm cũ; có `job` (+`queuePosition`), `rawVideoDeleted`, `result.asdProbability`, `gaitFeatures`, `provider` |
| GET | `/api/screenings/:id/keypoints`, `/prediction` | JWT | lỗi ML trả mã chung, không lộ URL |
| GET | `/api/results/:id` | JWT | serialize như trên |
| POST | `/api/chat` | JWT | regex mock |
| GET | `/api/articles`, `/api/articles/:slug` | — | knowledge base |
| GET | `/api/admin/stats` | ADMIN | + thống kê hàng đợi, lỗi kỹ thuật (`jobLastError`) của lượt gần đây |
| GET | `/api/admin/ml-health` | ADMIN | ML có kết nối không, bản cũ hay mới, CUDA/OpenPose/calibration/chế độ lưu video |
| * | `/api/admin/skeleton/*` | ADMIN | §10 |
| * | `/subjects/*`, `/api/subjects/*`, `/pipeline/asd`, `/api/pipeline/asd` | **ADMIN** (trước đây không có auth) | proxy ML thô; `subject_id` phải khớp `^[A-Za-z0-9_-]{1,64}$` |

Lỗi: Zod → 400; Multer → 413/400; lỗi ML trên route admin → giữ mã 4xx của ML hoặc 502 (`ML_SERVER_ERROR`); thiếu bảng/cột (P2021/P2022) → 503 `DATABASE_MIGRATION_REQUIRED`.

### 6.4 Luồng sàng lọc

1. Frontend đọc thời lượng/kích thước video trong trình duyệt → `POST /screenings/upload?childId=…`. Backend kiểm tra hồ sơ trẻ và consent **trước** khi nhận file (file bị xoá nếu request lỗi).
2. `POST /screenings/:id/process` → upsert `ScreeningJob` (QUEUED), `VideoUpload.status = PROCESSING`.
3. Worker (khởi động cùng server) lấy job bằng `FOR UPDATE SKIP LOCKED`, gọi `POST <ML>/pipeline/asd?subject_id=<videoId>&return_keypoints=true` (chỉ gửi threshold/temperature nếu env đặt). Lỗi 409 (subject đã có từ lần trước) → lấy lại kết quả/keypoints có sẵn trên ML.
4. Tính `gaitFeatures` từ keypoints; fps ưu tiên số đo của ML, sau đó tới `số frame / thời lượng` đo ở trình duyệt.
5. `normalizePrediction`: `p_asd ≥ highRisk` → HIGH; `≥ threshold` → MEDIUM; còn lại LOW (ngưỡng lấy từ ML/calibration; HIGH không thấp hơn threshold). Khuyến nghị tiếng Việt theo mức + ghi chú chất lượng video.
6. Lưu `ScreeningResult` + job SUCCEEDED + video COMPLETED trong một transaction, rồi **xoá video gốc** (`videoDeletedAt`).
7. Lỗi tạm thời (mạng, ngrok, 5xx, timeout, ML còn đang xử lý) → retry sau 30s, 60s…; hết lượt → FAILED với thông báo thân thiện cho phụ huynh, lỗi kỹ thuật lưu ở `ScreeningJob.lastError` (admin xem được). Video gốc được giữ để "Thử phân tích lại".
8. Backend restart giữa chừng → job RUNNING mất heartbeat > 2 phút được đưa lại hàng đợi.

### 6.5 Đặc trưng dáng đi (`backend/src/services/gaitFeatures.ts`)

- Theo dõi trẻ qua các frame (ghép người theo vị trí, chọn track dài và có chân chuyển động — người lớn đứng yên không chiếm chỗ).
- Chuẩn hoá theo chiều dài chân/thân của chính trẻ (trung vị trượt → trẻ đi về phía camera vẫn đúng).
- Góc quay: `side` / `frontal` / `oblique` theo tỉ lệ vai/thân.
- Bước chân: cực trị của khoảng cách hai cổ chân (ngang khi quay ngang, dọc khi quay chính diện), định vị dưới mức frame.
- Chỉ số: số bước, nhịp bước, thời gian bước, độ dao động (CV), chênh lệch trái–phải, độ dài bước*, tốc độ*, nghiêng thân*, độ lắc thân, biên độ vung tay trái/phải* và chênh lệch, tỉ lệ nhón gót* (thử nghiệm) — (*) chỉ khi quay ngang.
- Chất lượng `good/fair/poor` + cảnh báo tiếng Việt (video ngắn, thiếu chân, nhiều người, < 4 bước, không rõ fps, quay chính diện).
- **Chỉ mô tả, không dùng để tính mức sàng lọc, chưa có ngưỡng chuẩn cho trẻ em.** Kiểm thử bằng người đi tổng hợp có đáp án (`backend/test/syntheticGait.ts`). Với 4 clip mẫu trong `API/storage` (2–3 giây) kết quả là `fair` + cảnh báo quay dài hơn.

---

## 7. ML service (`API/`)

### 7.1 `server_openpose.py` (bản 2.0.0, **chưa triển khai lên máy GPU**)

Biến môi trường (đường dẫn tương đối tính từ thư mục `API/`):

| Biến | Mặc định |
|---|---|
| `OPENPOSE_BIN` / `OPENPOSE_MODEL_DIR` | `/workspace/openpose/build_gtx1650_nocudnn/examples/openpose/openpose.bin` / `/workspace/openpose/models` |
| `OPENPOSE_NET_RESOLUTION` / `OPENPOSE_TIMEOUT_SECONDS` | `-1x256` / 3600 |
| `SUBJECT_ROOT` | `storage/asd_subjects` |
| `STGCN_CHECKPOINT` / `CALIBRATION_PATH` / `STGCN_DEVICE` | `ASD_Model/finetuned_best_model.pth` / cạnh checkpoint: `calibration.json` / `cuda` |
| `ML_API_KEY` | (trống = không yêu cầu key) |
| `ML_MAX_CONCURRENT_JOBS` | 1 |
| `VIDEO_RETENTION` | `blurred` (`none` = không giữ video, `raw` = giữ gốc) |

Endpoints (giữ nguyên contract cũ, chỉ thêm trường):

| Method | Path | Ghi chú |
|---|---|---|
| GET | `/`, `/health` | công khai; `/health` trả model_loaded, model_device, calibrated, video_retention, auth_required, openpose_available, cuda_available |
| POST | `/subjects/extract`, `/pipeline/asd` | thêm `video` (fps, width, height, frame_count, duration_sec) và `video_retention` trong kết quả; nhận thêm `.webm` |
| POST | `/subjects/{id}/predict` | `threshold`/`temperature` giờ tuỳ chọn: thiếu thì dùng calibration hoặc 0.5/1.0 |
| GET | `/subjects`, `/subjects/{id}`, `/subjects/{id}/keypoints`, `/subjects/{id}/prediction`; DELETE `/subjects/{id}` | keypoints kèm `video` |

- Mọi route trừ `/`, `/health` cần `X-API-Key` khi `ML_API_KEY` được đặt.
- `subject_id` bị kiểm tra (`^[A-Za-z0-9_-]{1,64}$`, không thoát khỏi `SUBJECT_ROOT`) → 422.
- OpenPose và dự đoán chạy qua semaphore (mặc định 1 job).
- Không có frame hợp lệ (không thấy người) → **422** kèm thông báo tiếng Việt (trước đây 500).
- Làm mờ mặt (`services/anonymize.py`): pixelate + blur vùng đầu theo khớp mũi/mắt/tai/cổ; giữ box tối đa 10 frame khi mất dấu; frame không phát hiện người bị **làm mờ toàn bộ**; làm mờ lỗi → xoá luôn video gốc (ưu tiên riêng tư). Đã đo trên clip thật: độ nét vùng đầu còn ~0,6% so với gốc.
- Calibration chỉ được nạp khi có `checkpoint_sha256` khớp checkpoint đang chạy; nếu không thì bỏ qua (`calibrated: false`).

### 7.2 Layout lưu trữ (`storage/asd_subjects/<subject_id>/`)

```text
input_blurred.mp4        # VIDEO_RETENTION=blurred (mặc định); "none": không có video; "raw": input.mp4 gốc
openpose_json/input_<12 số>_keypoints.json
keypoints_body25.json    # {subject_id, keypoint_format, num_frames, video, frames:[…]}
metadata.json            # + video, video_retention, anonymization{frames, head_boxes, carried_frames, fully_blurred_frames}
prediction.json          # {subject_id, created_at, prediction}
```

`prediction` = `{file, T_in, J, p_typical, p_asd, logit_typical, logit_asd, pred_argmax, label_threshold, threshold, temperature, label_name, high_risk_threshold, calibrated, model:{checkpoint, sha256, num_joints}}`.

### 7.3 ST-GCN (không đổi)

BatchNorm → 3 block ST-GCN 64→128→256, kernel thời gian 9, residual, 3 partition + edge importance → FC 2 lớp. Input `(N, C=2, T=128, V)`, 1 người/frame (người có confidence trung bình cao nhất). Tiền xử lý: bỏ frame thiếu, cắt frame 0 ở hai đầu, BODY_25 → thứ tự Kinect-25, bỏ khớp còn 18 (checkpoint đang dùng) hoặc 17, chuẩn hoá theo config checkpoint, nội suy về T=128.

### 7.4 Llama server (chưa nối)

Llama-3.2-3B-Instruct 4-bit + LoRA `asd_lora_1`, `asd_lora_2`. Thư mục adapter: `LLAMA_ADAPTER_ROOT`, nếu không có thì tự chọn `Llama/` hoặc `LLama/`. Thư viện: `requirements-llama.txt`. Bản proxy cũ trong backend: `git show 99db6a4:backend/src/routes/chat.ts` (người dùng tự chạy lệnh git).

### 7.5 Docker phía ML

Image dùng Python 3.10, cài từ `requirements.txt`, **không có OpenPose**; compose profile `ml` mount bản build OpenPose của máy host (chưa kiểm chứng). Cách đã kiểm chứng: chạy trực tiếp trên máy GPU.

---

## 8. Nghiên cứu và đánh giá mô hình (`research_src/`)

| Script | Nội dung |
|---|---|
| `calibrate_evaluate.py` (mới) | `split` (chia train/val/test theo subject, phân tầng, seed), `calibrate` (temperature scaling NLL trên val, ngưỡng Youden hoặc theo độ nhạy, ngưỡng HIGH theo độ đặc hiệu → `calibration.json` kèm sha256 checkpoint), `evaluate` (chỉ chạy 1 lần trên test, chặn rò rỉ val→test, bootstrap CI 95% theo subject → `test_results.json`). |
| `predict_dataset.py` (mới) | chạy đúng tiền xử lý của server (`STGCNPredictor`) trên keypoints JSON / thư mục OpenPose JSON / Excel → CSV logits để calibrate/evaluate. |
| `fine_tune.py` (đã sửa) | thêm `--splits`; nếu không có thì tách val từ subject train (`--val-ratio`); chọn epoch theo **val** macro-F1; test 1 lần cuối; lưu `num_joints` và `test_results.json`. Sửa thêm lỗi: bản cũ lưu `state_dict()` theo tham chiếu nên "best" thực ra là epoch cuối. Vẫn phụ thuộc 2 module chỉ có trên server. |
| `EVALUATION.md` (mới) | quy trình + lệnh cho máy GPU. |
| `ST-GCN.py`, `BiLSTM.py`, `SRM.py`, `training_llama.py`, `test_llama.py` | như trước (split subject-level 70/15/15, SRM có 5-fold theo subject). |

Phát hiện quan trọng:

- Checkpoint đang deploy được chọn theo **test accuracy** và còn dính lỗi `state_dict` tham chiếu → mọi con số cũ **không dùng được**. Phải chạy lại theo `EVALUATION.md` rồi mới báo cáo.
- Dữ liệu `Dataset_video` đặt tên `video_1…video_50` (50 ASD, 49 Typical); regex subject mặc định `^([^/]+)` giả định **1 video = 1 trẻ** — nếu một trẻ có nhiều video phải truyền `--subject-regex`.
- Trong `API/storage`: `36` và `136` là cùng một video, hai thư mục UUID cũng vậy → phải gộp chung một subject nếu dùng.
- Kinect (train gốc) và OpenPose (inference) vẫn lệch miền; ngưỡng phải calibrate lại mỗi lần đổi checkpoint.

---

## 9. Frontend (React + Vite)

### 9.1 Routes (không đổi)

`/login`, `/register` (public) · `/`, `/screening`, `/children` (tạm dùng ScreeningPage), `/history`, `/assistant`, `/knowledge`, `/knowledge/:slug`, `/guide`, `/settings` (ProtectedRoute) · `/admin`, `/admin/skeleton` (AdminRoute).

### 9.2 Hành vi chính

- **Home / Screening** dùng chung `ScreeningUploadPanel`:
  - chọn/tạo hồ sơ trẻ;
  - xác nhận đồng ý (`ConsentPanel`, nội dung lấy từ backend; có ô tuỳ chọn cho phép dùng skeleton để nghiên cứu) và thu hồi;
  - đọc thời lượng/kích thước video, cảnh báo nếu ngắn hơn 4 giây;
  - thanh tiến trình upload, trạng thái hàng đợi (vị trí chờ / đang phân tích / đang thử lại);
  - polling 2 giây, tự huỷ khi rời trang;
  - nút "Thử phân tích lại" khi thất bại (nếu video gốc còn).
- **Kết quả** (`ScreeningResultView`):
  - mức cần theo dõi;
  - thanh **"Điểm sàng lọc của mô hình"** = `asdProbability` có vạch ngưỡng (sửa lỗi cũ: `confidenceScore = max(p_asd, p_typical)` từng bị hiển thị là "Khả năng ASD", nên trẻ điển hình có thể hiện 96%);
  - cảnh báo chất lượng video, khuyến nghị;
  - thẻ "Chỉ số dáng đi (tham khảo)";
  - ghi chú khi ngưỡng chưa calibrate;
  - nhãn "Chế độ mô phỏng" cho kết quả mock.
- **History:** trạng thái tiếng Việt, chi tiết dùng cùng `ScreeningResultView`, gửi/chạy lại phân tích.
- **Admin:** thống kê, hàng đợi, thẻ sức khoẻ máy ML (cảnh báo nếu là bản cũ), lỗi kỹ thuật của lượt thất bại.
- **Auth:**
  - header Authorization được gắn **đồng bộ** khi login/logout/khởi động (sửa lỗi cũ: các request đầu tiên sau đăng nhập bị 401, bản production sẽ thấy danh sách trẻ trống);
  - interceptor 401 tự đăng xuất.
- **Đã gỡ:**
  - form login điền sẵn tài khoản demo;
  - lời gọi `GET /chat/models` (backend không có);
  - `BehaviorChart` (chỉ để vẽ 4 điểm giả).
- **Guide:** hướng dẫn quay dáng đi (6–10 giây, quay ngang, thấy bàn chân, một mình trẻ) và quyền riêng tư.

### 9.3 Design system (không đổi)

Theme "Duo" (xanh đậm `#166534`…), Nunito, lucide-react, class `btn-duo*`, `card-duo*`, `panel-duo`, `input-duo`, `link-duo`. Trang mới phải dùng `DashboardLayout`, `Card`, `UploadDropzone` (prop `accept` tuỳ chỉnh).

---

## 10. Admin Skeleton

- **Backend** (`/api/admin/skeleton`, JWT + ADMIN):
  - extract (giới hạn `SKELETON_MAX_UPLOAD_MB`; nhận .mp4/.mov/.avi/.mkv/.webm);
  - list, get, keypoints, delete; kiểm tra `subject_id`;
  - ZIP gồm `keypoints_body25.json`, `metadata.json` (thêm `video`), `README.txt`, `keypoints_flat.csv` và `frames/frame_NNNN.json`. Đã kiểm tra một ZIP thật: 71 file, CSV 1675 dòng = 67 frame × 25 khớp;
  - lỗi stream sau khi đã gửi header được xử lý.
- **Frontend:**
  - danh sách subject trên máy ML, mở/xoá (có xác nhận);
  - canvas dùng **kích thước video thật** (letterbox, không méo; đã kiểm tra với video dọc 1080×1920), nếu không có thì căn theo phạm vi skeleton;
  - vẽ tất cả người, người chính được tô nổi;
  - phát theo **fps thật** (0.25×/0.5×/1×);
  - **xuất WebM đúng tốc độ, phát một lần** (cần tab đang hiển thị vì dùng `requestAnimationFrame`);
  - lỗi tải ZIP đọc được nội dung (Blob).
- `typings archiver` v8: dùng `import archiver = require('archiver')` + `new archiver.ZipArchive(...)`.
- Mapping BODY_25 chuẩn (trong `frontend/src/lib/skeleton.ts`): `0-1, 1-2, 2-3, 3-4, 1-5, 5-6, 6-7, 1-8, 8-9, 9-10, 10-11, 8-12, 12-13, 13-14, 0-15, 15-17, 0-16, 16-18, 14-21, 14-19, 19-20, 11-24, 11-22, 22-23`.

---

## 11. TIẾN ĐỘ DỰ ÁN

### 11.1 Mốc thời gian

| Ngày | Mốc |
|---|---|
| 2026-05-21/22 | Initial commit web ASDr + `API/` (OpenPose/ST-GCN, Llama). |
| 2026-05-23 | `research_src/` (ST-GCN, BiLSTM, SRM, fine-tune, Llama training). |
| 2026-07-13 | Gọi API thật trong `screeningProcessor`; gỡ proxy Llama, chat về mock. |
| 2026-09-25 | Nộp đề cương AIMBRACE (AI for Life 2026). |
| 2026-09-26 | Docker, migration `errorMessage`, theme xanh đậm + Lucide. |
| 2026-10-03 | `openposeService.ts`, router `/subjects`, `/pipeline`. |
| 2026-10-04 | Admin Skeleton (route + trang + ZIP/WebM). |
| **2026-10-05** | **Giai đoạn 1–2** (chưa commit): bảo mật proxy ML, gỡ `/uploads` công khai, consent, hàng đợi bền vững, đặc trưng dáng đi + chất lượng video, sửa hiển thị điểm ASD, ML server 2.0 (API key, làm mờ mặt, `/health`, calibration, probe video), công cụ đánh giá/calibration, sửa `fine_tune.py`, Docker/compose, test tự động (77 test), áp migration mới lên DB chung. |

### 11.2 Tiến độ theo "Nội dung thực hiện" của đề cương

| Hạng mục | Việc | Trạng thái | Bằng chứng / ghi chú |
|---|---|---|---|
| **0. Khảo sát** | ASD, skeleton action recognition, imitation | 🟡 | 3 họ model đã thử; phần bắt chước chưa có. |
| **1. Thu thập & xử lý** | Video đi thẳng → skeleton | ✅ | OpenPose BODY_25 + probe fps/kích thước. |
| | Ghi hoạt động khi tập bài tập | ⬜ | |
| | Lưu trữ riêng tư (che mặt, consent) | 🟡 | Code xong: consent + làm mờ mặt + xoá video gốc. Chờ triển khai ML mới và dọn video cũ (§12). |
| | Tiền xử lý skeleton | ✅ | Như trước + theo dõi trẻ/chuẩn hoá cho đặc trưng dáng đi. |
| **2. AI sàng lọc** | Huấn luyện + đánh giá | 🟡 | Công cụ split/calibrate/evaluate + `fine_tune.py` đã sửa; **chưa chạy trên dữ liệu thật**; số liệu cũ không hợp lệ. |
| | Triển khai cloud | 🟡 | Máy GPU qua ngrok, đang lỗi CUDA; ML 2.0 chưa deploy; Docker đã sửa nhưng chưa build thử. |
| | Sàng lọc → kết quả | ✅ | Hàng đợi bền vững, retry, phục hồi; 3 mức theo ngưỡng (calibration nếu có); chỉ số dáng đi + chất lượng. Đã chạy end-to-end với ML 2.0 cục bộ (OpenPose giả + checkpoint ngẫu nhiên). |
| | API | ✅ | Proxy ML chỉ ADMIN, ML có API key + kiểm tra subject_id. |
| **3. Bài tập & bắt chước** | Thư viện bài tập, thu skeleton, so sánh | ⬜ | Admin Skeleton (đã hoàn thiện) dùng để tạo chuyển động mẫu. |
| **4. AI Agent** | RAG, hỏi đáp về trẻ, guardrail, nhân vật + S2S | ⬜/🟡 | Chat vẫn mock; guardrail mới ở mức system prompt Llama. |
| **5. Cá nhân hóa** | | ⬜ | |
| **6. Quản lý & theo dõi** | Lưu skeleton/kết quả/lịch sử | ✅ | + `gaitFeatures`, `modelVersion`, ngưỡng, consent, job. |
| | Web theo dõi từng trẻ | 🟡 | History có chi tiết + chỉ số dáng đi; chưa có dashboard theo trẻ, chưa CRUD hồ sơ. |
| | Xu hướng dài hạn | ⬜ | Đã có dữ liệu (gait theo từng lần) nhưng chưa có biểu đồ. |
| **7. Chuyên gia** | | ⬜ | |
| **Nền tảng** | Auth, role, knowledge, admin | ✅ | + sức khoẻ ML, hàng đợi. |
| | Test tự động | ✅ | Backend 30, ML server 18, research 29 (trước đây 0). |
| | Docker | 🟡 | Đã sửa CMD/healthcheck/env/nginx/requirements; chưa build thử. |
| | Đổi thương hiệu AIMBRACE | ⬜ | |

### 11.3 Ước lượng tổng quan (chủ quan)

| Khối | Trước 05/10 | Sau Giai đoạn 1–2 |
|---|---|---|
| Nền tảng web (auth, hồ sơ, upload, lịch sử, knowledge, admin) | ~70% | ~80% |
| Pipeline skeleton + sàng lọc (F1, F2) | ~60% | ~75% (thiếu: đánh giá mô hình thật, deploy ML mới, GPU) |
| Theo dõi + dashboard (F8, F9) | ~25% | ~30% |
| AI Agent + nhân vật LLM (F5, F6) | ~10% | ~10% |
| Bài tập + bắt chước + cá nhân hóa (F3, F4, F7) | ~5% | ~5% |
| Kết nối chuyên gia (F10) | 0% | 0% |
| **Toàn đề cương** | **~25–30%** | **~30–35%** |

### 11.4 Trạng thái working tree và việc git cho người dùng

Agent không dùng git (quy định của chủ dự án). Thay đổi Giai đoạn 1–2 nằm trong working tree, chưa commit. Khi muốn commit, người dùng tự chạy:

```bash
# Gỡ khỏi git các file không được phép nằm trong repo (file vẫn còn trên ổ đĩa; đã thêm vào .gitignore)
git rm -r --cached API/storage API/__pycache__ API/services/__pycache__ backend/backend.log backend/response.json
git add -A
git status          # kiểm tra lại trước khi commit
```

- `frontend/src/components/BehaviorChart.tsx` đã bị xoá (sẽ hiện là deleted).
- File `.pyc` trong `API/__pycache__` bị Python tạo lại khi chạy test (rác build).
- Video trẻ vẫn còn trong **lịch sử git** cũ; xoá khỏi lịch sử (filter-repo) là quyết định của nhóm.

---

## 12. Vấn đề còn tồn tại (theo mức ưu tiên)

### P0

1. **Máy GPU: OpenPose lỗi `Cuda check failed (100 vs. 0): no CUDA-capable device is detected`.** Mọi lượt sàng lọc thật đang FAILED sau 3 lần thử. Cần kiểm tra driver/GPU trên máy ML (`nvidia-smi`, `/health` → `cuda_available`).
2. **ML server production vẫn là bản cũ:** không API key, không làm mờ, lưu video gốc, `subject_id` không kiểm tra. Cần triển khai các file trong "Thay đổi trong API/" (§13), đặt `ML_API_KEY` ở cả hai phía, `VIDEO_RETENTION=blurred`. Trước khi deploy, nội dung consent đã tự ghi rõ là máy phân tích "có thể lưu bản sao video gốc".
3. **Video cũ:**
   - `backend/uploads` còn ~58 video từ trước chính sách xoá: chạy `npm run privacy:purge-videos` để xem (dry-run), rồi `-- --yes` nếu đồng ý;
   - `API/storage` (4 video test) vẫn trong git: xem §11.4.

### P1

4. **Hiệu năng mô hình chưa biết; ngưỡng chưa calibrate** (UI có ghi chú). Chạy `research_src/EVALUATION.md`, đặt `calibration.json` cạnh checkpoint.
5. **Lịch sử migration DB chung lệch repo** (§5.4).
6. **Chọn người không thống nhất:** ST-GCN trên ML chọn người theo confidence từng frame; đặc trưng dáng đi theo track trẻ đang đi. Với video nhiều người, mô hình có thể phân tích nhầm người lớn (đã có cảnh báo chất lượng).
7. **Chỉ số dáng đi:** chưa có chuẩn theo tuổi; nhón gót là thử nghiệm; quay chính diện chỉ có nhịp bước.

### P2

8. Docker/compose chưa build thử (Docker Desktop không chạy lúc sửa); container ML không có OpenPose.
9. Job chạy trong process backend: nhiều instance thì an toàn (SKIP LOCKED) nhưng giới hạn GPU chỉ tính trong từng process.
10. JWT giữ role trong token: hạ quyền admin chỉ có hiệu lực khi token hết hạn.

### P3

11. `state/auth.tsx` còn 2 lỗi ESLint có sẵn.
12. `RecentResultsCard` không tự làm mới sau khi có kết quả mới.
13. Thanh điều hướng mobile thiếu admin/guide/settings.
14. `/children` vẫn là trang sàng lọc.
15. README frontend là template.

---

## 13. Roadmap

Thứ tự ưu tiên dựa trên đề cương và rủi ro. Mỗi bước nên là một PR nhỏ, có kiểm chứng thật.

Lưu ý: Bạn không được dùng git trong project hiện tại.

### Giai đoạn 1 — Ổn định và bảo mật ✅ (code)

Xong:

- Admin Skeleton kiểm thử end-to-end (extract qua ML cục bộ, keypoints, canvas, ZIP, xoá, 401/403).
- Sửa canvas và WebM.
- Khoá proxy ML, gỡ `/uploads` công khai, sửa login điền sẵn.
- `.gitignore`, Docker/compose/nginx.

Còn:

- người dùng chạy lệnh git ở §11.4;
- build thử Docker.

### Giai đoạn 2 — Sàng lọc chuẩn hóa ✅ (code)

Xong:

- Công cụ đánh giá lại mô hình, sửa `fine_tune.py`.
- Làm mờ mặt, xoá video gốc, consent.
- Bỏ 4 điểm giả, thêm chỉ số dáng đi + chất lượng.
- Ngưỡng từ calibration; hàng đợi bền vững + giới hạn GPU.

Còn:

- chạy đánh giá trên máy GPU;
- triển khai ML 2.0;
- sửa CUDA trên máy GPU;
- dọn video cũ.

**Thay đổi trong `API/` (cần triển khai lên máy GPU):**

- `server_openpose.py` — cấu hình bằng biến môi trường; yêu cầu API key; kiểm tra `subject_id`; giới hạn số job GPU đồng thời; thêm `/health`; trả thông tin video (fps, kích thước); làm mờ mặt và chính sách lưu video; nạp `calibration.json` khi khớp checkpoint và trả thêm ngưỡng/cờ calibrated/thông tin model; "không thấy người" trả 422; nhận `.webm`; khởi động bằng lifespan.
- `services/anonymize.py` (mới) — làm mờ vùng đầu theo keypoint, làm mờ toàn khung khi không thấy người; đọc thông tin video.
- `server_llama.py` — tự chọn thư mục adapter `Llama/` hoặc `LLama/` (hoặc biến `LLAMA_ADAPTER_ROOT`).
- `requirements.txt` — sửa dòng index PyTorch sai; thêm pandas, openpyxl.
- `requirements-llama.txt` (mới) — thư viện cho server Llama.
- `Dockerfile` — Python 3.10 nhất quán, bỏ bước copy gói sai, thêm ffmpeg/thư viện OpenCV; ghi rõ không có OpenPose.
- `.dockerignore` — loại tests, storage, model, adapter khỏi image.
- `tests/` (mới: `fake_openpose.py`, `helpers.py`, `test_anonymize.py`, `test_server.py`) — 18 test chạy không cần GPU.
- `__pycache__/*.pyc` — bị tạo lại khi chạy test (rác, đã gitignore).

### Giai đoạn 3 — Theo dõi trẻ và dashboard (F8, F9) — tiếp theo

- Trang hồ sơ trẻ thật (CRUD, kèm xoá dữ liệu khi phụ huynh yêu cầu), dashboard theo trẻ: lịch sử sàng lọc, biểu đồ xu hướng các chỉ số dáng đi (đã có dữ liệu), điểm bài tập.
- Đổi thương hiệu sang **AIMBRACE** ở UI (giữ `asdr_token`, DB `asdr`).

### Giai đoạn 4 — Bài tập tương tác và đánh giá bắt chước (F3, F4)

- Model dữ liệu: `Exercise`, `ExerciseSession`, `SessionScore`.
- Tạo mẫu bằng Admin Skeleton.
- Chấm điểm:
  - chuẩn hoá skeleton (gốc mid-hip, scale theo thân — có thể tái dùng phần chuẩn hoá trong `gaitFeatures.ts`);
  - DTW trên góc khớp;
  - điểm 0–100 kèm phản hồi theo bộ phận.
- Ghi video bằng webcam (MediaRecorder; ML 2.0 đã nhận `.webm`).

### Giai đoạn 5 — AI Agent và nhân vật LLM (F5, F6)

- Khôi phục proxy Llama hoặc dùng LLM API.
- RAG có trích nguồn (pgvector).
- Guardrail 2 lớp.
- Tool đọc dữ liệu trẻ đúng `userId`.
- Nhân vật + STT/TTS tiếng Việt.

### Giai đoạn 6 — Cá nhân hóa (F7)

Luật đơn giản, giải thích được, trước khi dùng bandit hoặc mô hình học.

### Giai đoạn 7 — Chuyên gia (F10)

Role `EXPERT`, `ExpertOrganization`, `ExpertLink` (phụ huynh cấp/thu hồi quyền theo từng trẻ), trang chuyên gia, đặt lịch.

---

## 14. Quy tắc làm việc cho agent

1. **Không dùng git** (quy định của chủ dự án). Nắm trạng thái bằng cách đọc file; mọi lệnh git (commit, `git rm --cached`, `git show`) đưa cho người dùng tự chạy.
2. Đọc abstraction sở hữu gần nhất trước khi sửa:
   - gọi ML qua `openposeService.ts`;
   - hàng đợi qua `enqueueScreeningProcessing`;
   - ngưỡng/mức qua `screeningResult.ts`;
   - consent qua `consentService.ts`;
   - dữ liệu trả cho phụ huynh qua `serializers.ts`;
   - auth qua `requireAuth` / `requireRole`;
   - frontend gọi API qua `lib/api.ts` (`apiErrorCode`, `apiErrorMessage`).
3. Tái hiện vấn đề bằng lệnh nhỏ nhất; nêu giả thuyết và phép kiểm tra phân biệt trước lần sửa đầu tiên.
4. Sửa nhỏ, tập trung; chạy test hẹp nhất, rồi typecheck/build package bị ảnh hưởng (§5.3).
5. Thay đổi runtime: kiểm chứng bằng HTTP thật. Có thể dựng PostgreSQL tạm từ `C:\Program Files\PostgreSQL\15\bin` (initdb/pg_ctl, port riêng, thư mục Temp) và ML server cục bộ với `API/tests/fake_openpose.py` + checkpoint ngẫu nhiên, để không đụng DB chung.
6. Schema: chỉ thêm (bảng mới, cột nullable), ghi tiếp các cột cũ còn bắt buộc; tạo migration có tên rõ ràng; áp lên DB chung theo §5.4; không sửa migration đã áp.
7. Không in hay commit credentials và `.env`.
8. Không đưa dữ liệu trẻ thật vào test hay fixture; dùng dữ liệu tổng hợp.
9. Không refactor `research_src/` hay `API/ST_GCN.py` khi làm việc web; giữ contract JSON của ML (chỉ thêm trường).
10. Văn bản cho người dùng: tiếng Việt, có disclaimer, tuân thủ §1.2.
11. Khi bàn giao:
    - phân biệt rõ cái đã kiểm chứng và cái chỉ là suy luận;
    - báo đúng lỗi của ML;
    - **nếu có sửa file trong `API/`, liệt kê tên file + chỉnh sửa chính (mô tả ngắn, không mô tả code).**

---

## 15. Debugging playbook

1. **Prisma `EPERM` trên `query_engine-windows.dll.node`:** một tiến trình Node khác (backend dev khác, kể cả instance test của agent) đang giữ engine. Dừng đúng tiến trình đó, hoặc đổi tên file `.dll.node` đang bị khoá rồi chạy lại `npx prisma generate` (Windows cho đổi tên DLL đang nạp). Không xoá file khác của người dùng.
2. **`The table public.ScreeningJob does not exist` / P2021 / P2022 / API trả 503 `DATABASE_MIGRATION_REQUIRED`:** DB chưa có migration mới. DB chung: §5.4. DB mới: `npm run prisma:deploy`. Worker tự tạm dừng 60s mỗi lần thay vì spam log.
3. **Nodemon báo `app crashed`:** lấy stack trace đầu tiên sau `starting tsx src/server.ts`; chạy `npm run typecheck` riêng.
4. **Backend chạy được không có nghĩa DB truy cập được:** test `/api/health`, login, `/api/auth/me`. DB chung cần Tailscale đang kết nối (`tailscale status`).
5. **Login 401 trên DB mới:** chưa seed (`npm run prisma:seed`, chỉ khi muốn có dữ liệu demo).
6. **Lỗi ML:**
   - timeout;
   - HTML từ tunnel ngrok đã chết;
   - JSON hỏng;
   - 5xx;
   - **`Cuda check failed … no CUDA-capable device`** (máy GPU không thấy GPU).

   Phụ huynh thấy thông báo thân thiện; chi tiết kỹ thuật ở `ScreeningJob.lastError` (trang Admin) và log backend `[screening-queue]`.
7. **Lượt sàng lọc FAILED:** xem `jobLastError` trên Admin. Sửa nguyên nhân rồi bấm "Thử phân tích lại" (video gốc còn nếu chưa thành công).
8. **Retry dồn dập hoặc job không bao giờ chạy:** kiểm tra múi giờ. Các cột thời gian lưu UTC; raw SQL phải đổi thời điểm sang UTC tường minh (xem `claimJobs`).
9. **Upload trả 403 `CONSENT_REQUIRED`:** phụ huynh chưa đồng ý hoặc đã thu hồi cho trẻ đó, hoặc version consent đã đổi (409 `CONSENT_VERSION_OUTDATED` khi đồng ý với nội dung cũ).
10. **Ngay sau login các request bị 401:** header Authorization phải được gắn đồng bộ (đã sửa trong `state/auth.tsx`; đừng chuyển lại vào `useEffect`).
11. **Skeleton lệch hoặc méo:** kiểm tra `video.width/height` trong keypoints (chỉ ML 2.0 có); nếu không có, canvas căn theo phạm vi skeleton.
12. **ML server không khởi động:** chạy từ `API/` hay chưa (đường dẫn tương đối giờ tính theo thư mục file); có checkpoint không; đã cài pandas chưa; `OPENPOSE_BIN` có tồn tại không; `VIDEO_RETENTION` có hợp lệ không.
13. **Calibration không có tác dụng** (`/health` → `calibrated:false`): file thiếu `checkpoint_sha256`, sha không khớp checkpoint đang chạy, hoặc giá trị ngoài khoảng (xem log ML).
14. **Không tuyên bố đã có** MP4 export, RAG, realtime, hiệu năng mô hình, hay ML 2.0 đang chạy production khi chưa thực sự có.

---

## 16. Nhật ký phiên 2026-10-05 và checklist việc cần làm

### 16.1 Những gì đã xảy ra trong phiên (để đọc lại)

1. **Lỗi `The table public.ScreeningJob does not exist`** khi chủ dự án chạy backend mới:
   - Nguyên nhân: migration `20261005_screening_privacy_queue` mới chỉ được áp lên DB tạm để test, chưa áp lên DB `asdr` chung.
   - DB chung có lịch sử migration lệch repo (`20261003162407_init`), nên không dùng `migrate deploy`/`migrate dev`.
   - Cách sửa: so sánh schema thật với schema trước thay đổi (khớp 100%) → chạy SQL migration trong một transaction (`prisma db execute`) → `prisma migrate resolve --applied` → `migrate diff` báo không còn khác biệt.
   - Đã kiểm chứng: backend chạy với DB thật, worker không lỗi, `/api/screenings`, `/api/admin/stats` trả 200.
   - Gia cố: thiếu migration → API 503 `DATABASE_MIGRATION_REQUIRED`, worker tạm dừng 60s; code mới vẫn ghi 4 cột điểm cũ để code cũ của thành viên khác đọc được (tránh P2032).
2. **ML server thật (ngrok) online nhưng là bản cũ**, và OpenPose lỗi `Cuda check failed (100 vs. 0): no CUDA-capable device is detected`.
   - Lượt upload của chủ dự án lúc 10:34 (file `backend/uploads/2da8ce43-….mp4`) đã FAILED sau 3 lần thử vì lỗi này.
   - Video được giữ lại có chủ đích → sau khi sửa GPU vào Lịch sử bấm "Thử phân tích lại".
3. **Bug phát hiện và sửa khi test thật:**
   - Múi giờ: tham số Date trong raw SQL bị đổi theo múi giờ phiên DB (Asia/Bangkok) → backoff retry bị bỏ qua (3 lần thử trong 9 giây). Đã sửa trong `claimJobs`.
   - Frontend (có sẵn từ trước): request đầu tiên sau login không kèm token (header gắn trong `useEffect` của component cha chạy sau effect của con) → bản production thấy danh sách trẻ trống. Đã sửa trong `state/auth.tsx`.
   - UI cũ hiển thị `confidenceScore = max(p_asd, p_typical)` là "Khả năng ASD" → trẻ điển hình có thể hiện 96%. Đã thay bằng "Điểm sàng lọc" = `asdProbability`.
   - Thông báo lỗi 5xx cho phụ huynh từng gợi ý "không nhận diện được người" dù lỗi thật là GPU → đã đổi thành "sự cố kỹ thuật".
   - Route admin skeleton trả 500 cho subject không tồn tại → giờ giữ đúng 404 của ML (lỗi mạng/5xx → 502).
   - Upload lỗi bất ngờ sau khi multer đã ghi file có thể để lại file mồ côi → giờ luôn xoá file.
   - `fine_tune.py` cũ: chọn epoch theo test và lưu `state_dict()` theo tham chiếu ("best" thực ra là epoch cuối) → số liệu cũ không hợp lệ.
4. **EPERM Prisma trong lúc test:** backend test của agent (cổng 4100) giữ file engine cùng lúc với `npm run dev` của chủ dự án → có thể gây EPERM. Các instance test đã tắt; file engine cũ/tạm đã dọn.
5. **Cuối phiên:** backend :4000 và frontend :5173 của chủ dự án không còn chạy (không phải crash; không còn tiến trình node nào). Chạy lại `npm run dev` ở cả hai.
6. **Môi trường test đã dọn:** PostgreSQL tạm (port 55432 trong Temp), ML server cục bộ (8100), backend/frontend test (4100/5175), static server (8200), thư mục Temp chứa bản video đã làm mờ, `.claude/launch.json` tạm.

### 16.2 Kết quả kiểm chứng cuối phiên

| Hạng mục | Kết quả |
|---|---|
| Backend typecheck + test | sạch, 30/30 |
| Frontend `tsc -b` + `vite build` | sạch (ESLint: 2 lỗi có sẵn trong `state/auth.tsx`) |
| ML server test (`API/tests`) | 18/18 |
| Research test (`research_src/tests`) | 29/29 |
| End-to-end UI với ML 2.0 cục bộ (OpenPose giả, checkpoint ngẫu nhiên) | consent → upload → hàng đợi → kết quả; `.mkv`/webm; History; Admin; Admin Skeleton (video dọc 1080×1920 không méo); ZIP 71 file, CSV 1675 dòng |
| Làm mờ mặt trên clip thật | độ nét vùng đầu còn ~0,6% (67/67 frame), phần còn lại ~89% |
| Backend cuối cùng với DB thật | khởi động sạch, worker không lỗi, cổng auth đúng |
| Chưa kiểm chứng | build Docker; OpenPose thật với ML 2.0; server Llama; hiệu năng mô hình |

### 16.3 Checklist việc cần làm (chủ dự án / nhóm)

- [ ] Chạy lại dev: `cd backend && npm run dev`, `cd frontend && npm run dev -- --host 127.0.0.1`.
- [ ] **Máy GPU:** sửa lỗi CUDA (`nvidia-smi`; sau khi deploy ML mới thì `/health` phải báo `cuda_available: true`, `openpose_available: true`).
- [ ] **Triển khai ML 2.0** lên máy GPU: các file trong danh sách "Thay đổi trong `API/`" (§13), cài lại `requirements.txt`, đặt `ML_API_KEY` (ML) = `OPENPOSE_API_KEY` (`backend/.env`), `VIDEO_RETENTION=blurred`. Kiểm tra trang Admin → thẻ "Máy chủ phân tích" không còn cảnh báo "phiên bản cũ".
- [ ] Sau khi GPU chạy: vào Lịch sử, "Thử phân tích lại" lượt upload 10:34.
- [ ] **Git** (agent không chạy git): `git rm -r --cached API/storage API/__pycache__ API/services/__pycache__ backend/backend.log backend/response.json`, rồi `git add -A`, kiểm tra `git status`, commit. Cân nhắc xoá video trẻ khỏi lịch sử git (quyết định của nhóm).
- [ ] **Dọn video cũ:** `cd backend && npm run privacy:purge-videos` (xem trước), rồi `npm run privacy:purge-videos -- --yes`.
- [ ] **Đánh giá lại mô hình** trên máy GPU theo `research_src/EVALUATION.md` (split theo trẻ → fine-tune chọn theo val → predict → calibrate → evaluate test một lần); copy `calibration.json` (có `checkpoint_sha256`) cạnh checkpoint; chỉ báo cáo số liệu từ `test_results.json`.
- [ ] Thống nhất với nhóm việc baseline lịch sử migration của DB chung (§5.4); tuyệt đối không `migrate dev` trên DB chung.
- [ ] Build thử Docker khi có Docker Desktop (`DOCKER_DEPLOY.md`).
- [ ] Bắt đầu Giai đoạn 3 (CRUD hồ sơ trẻ, dashboard theo trẻ với biểu đồ chỉ số dáng đi, đổi thương hiệu AIMBRACE).
