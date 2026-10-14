# AIMBRACE — Master Prompt (Handoff cho AI agent và thành viên nhóm)

> **Cập nhật:** 2026-10-14, phiên 14/10. Bảng hỏi M-CHAT-R/F chạy trọn trong app (20 câu + Follow-Up tự động), đã kiểm chứng trên màn hình thật, **chỉ thử nội bộ** (chưa có giấy phép); sửa 1 lỗi frontend; cách test bằng tay ở §5.5; xem §20. **Chat mới: bắt đầu từ §20.6.** Trước đó: 2026-10-13 DB chung, sidebar, M-CHAT phần 1 (§19); 2026-10-07 Giai đoạn 4 và bảng hỏi (§18).
> **Nguồn:** đề cương "AIMBRACE – AI for Life 2026" (25/09/2026), khảo sát repo tại commit `c6b011e`, Giai đoạn 1–2 (người dùng đã commit trong `09d23fe`) và thay đổi chưa commit của phiên 2026-10-06 (Giai đoạn 3, §17), 2026-10-07 (Giai đoạn 4 + bảng hỏi, §18), 2026-10-13 (§19) và 2026-10-14 (§20).
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
17. [Nhật ký phiên 2026-10-06 (GPU đã sửa, Giai đoạn 3) và checklist mới](#17-nhật-ký-phiên-2026-10-06-gpu-đã-sửa-giai-đoạn-3-và-checklist-mới)
18. [Nhật ký phiên 2026-10-07 (Giai đoạn 4 + bảng hỏi M-CHAT-R/F) và checklist mới](#18-nhật-ký-phiên-2026-10-07-giai-đoạn-4--bảng-hỏi-m-chat-rf-và-checklist-mới)
19. [Nhật ký phiên 2026-10-13 (DB chung, sidebar, nội dung M-CHAT phần 1) và checklist mới](#19-nhật-ký-phiên-2026-10-13-db-chung-sidebar-nội-dung-m-chat-phần-1-và-checklist-mới)
20. [Nhật ký phiên 2026-10-14 (M-CHAT-R/F: bật và kiểm chứng Follow-Up trong app) và checklist mới — bàn giao ở §20.6](#20-nhật-ký-phiên-2026-10-14-m-chat-rf-bật-và-kiểm-chứng-follow-up-trong-app-và-checklist-mới)

---

## 1. Dự án là gì

| Mục            | Nội dung                                                                                                                                                                                                                            |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Tên đề tài  | **AIMBRACE – Nền tảng AI hỗ trợ sàng lọc, theo dõi và cá nhân hóa hoạt động của trẻ có dấu hiệu ASD**                                                                                                      |
| Cuộc thi       | AI for Life 2026 — Khoa Khoa học Máy tính, Trường ĐH CNTT và Truyền thông Việt–Hàn (VKU), Đà Nẵng                                                                                                                    |
| Nhóm           | Phạm Viết Chí Luân (chủ repo), Nguyễn Văn Lâm, Nguyễn Văn Phụng — ngành Trí tuệ nhân tạo, lớp 23AI                                                                                                                 |
| GVHD            | TS. Lê Thị Thu Nga                                                                                                                                                                                                                 |
| Tên trong code | UI đã đổi sang**AIMBRACE** (2026-10-06: sidebar, header, login, tiêu đề tab, trợ lý, disclaimer). Còn giữ **ASDr/asdr** ở package, DB `asdr`, localStorage key `asdr_token`, email demo `@asdr.local`. |

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
6. **Điểm luyện tập bài tập** chỉ để khích lệ và so với chính trẻ qua các lần tập cùng một bài (cùng phiên bản mẫu); không so giữa các bài, không dùng để sàng lọc.
7. **Bản quyền M-CHAT-R/F:** không viết nội dung câu hỏi, ví dụ, hướng dẫn hay phần Follow-Up của M-CHAT-R/F vào code, test, tài liệu hay commit. Nội dung chỉ nằm trong file có giấy phép `backend/content/mchat-rf.vi.json` (gitignore). Kết quả bảng hỏi dùng ngôn ngữ "khả năng thấp/trung bình/cao", "nên đánh giá phát triển", không dùng "dương tính", "nguy cơ mắc", phần trăm.

---

## 2. Phạm vi theo đề cương → module kỹ thuật

Ký hiệu: ✅ đã có, chạy được · 🟡 có một phần / chờ triển khai / chưa kiểm chứng thật · ⬜ chưa bắt đầu

| #   | Tính năng (theo đề cương)                                                             | Module kỹ thuật                                                                                                                                                                                                                                                                            | Trạng thái                                                                                                                               |
| --- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| F1  | AI hỗ trợ sàng lọc ASD từ chuỗi skeleton                                              | ML`server_openpose.py` (ST-GCN + calibration), backend `screeningProcessor.ts` (hàng đợi), `screeningResult.ts`, UI `ScreeningUploadPanel`                                                                                                                                        | 🟡 (luồng hoàn chỉnh, đã chạy thật trên GPU ngày 2026-10-06; mô hình chưa được đánh giá lại; ML 2.0 chưa triển khai)  |
| F2  | Phân tích chuyển động không xâm lấn (camera thường + OpenPose 2D)                 | OpenPose BODY_25; đặc trưng dáng đi`gaitFeatures.ts`; làm mờ mặt `API/services/anonymize.py`                                                                                                                                                                                     | ✅ code (ML mới chưa triển khai lên máy GPU)                                                                                          |
| F3  | Bài tập tương tác: nhân vật hướng dẫn động tác                                 | Thư viện bài tập (`Exercise`/`ExerciseTemplate`, 6 bài dựng sẵn), nhân vật **bạn Mầm** (`GuidePuppet`, vẽ từ khung xương của mẫu, tốc độ 1×/chậm), ghi webcam (`WebcamRecorder`, MediaRecorder) hoặc tải video, Admin tạo mẫu từ video người lớn | 🟡 (code xong, e2e + UI với ML giả; chưa thử với ML thật — G0;`EXERCISE_MODE=admin_only`)                                         |
| F4  | Đánh giá mức độ bắt chước                                                          | `services/imitation/` (imitation-v1: góc khớp, DTW con, chế độ soi gương, điểm theo bộ phận, sao, phản hồi tiếng Việt), hàng đợi `exerciseProcessor.ts`                                                                                                                | 🟡 (hằng số cố định + test tổng hợp;**chưa hiệu chỉnh trên video thật** — C1)                                           |
| F5  | AI Agent: trợ lý phụ huynh, kiến thức ASD có nguồn                                   | `chatMock.ts` (regex); `server_llama.py` (chưa nối)                                                                                                                                                                                                                                    | 🟡 (mock)                                                                                                                                  |
| F6  | Nhân vật LLM + Speech-to-Speech                                                           | —                                                                                                                                                                                                                                                                                           | ⬜                                                                                                                                         |
| F7  | Cá nhân hóa độ khó/loại/tốc độ động tác                                        | —                                                                                                                                                                                                                                                                                           | ⬜                                                                                                                                         |
| F8  | Theo dõi tiến trình qua các phiên                                                      | `ChildDetailPage`: `GaitTrendChart` (dáng đi) + `ChildExercisesSection` (`ExerciseProgressChart`: điểm luyện tập theo từng bài) + `ChildQuestionnairesSection` (lịch sử bảng hỏi)                                                                                      | 🟡 (đủ 3 nguồn dữ liệu; chưa có dữ liệu thật)                                                                                    |
| F9  | Dashboard người chăm sóc                                                                | `HomePage`, `ChildrenPage`/`ChildDetailPage`, `HistoryPage` (lọc theo trẻ, xoá), `AdminPage` (thống kê, hàng đợi, sức khoẻ ML)                                                                                                                                           | 🟡                                                                                                                                         |
| F10 | Kết nối cơ sở chuyên gia                                                               | —                                                                                                                                                                                                                                                                                           | ⬜                                                                                                                                         |
| +   | (Bổ sung) Bảng hỏi phụ huynh M-CHAT-R/F (16–30 tháng), đánh giá thêm ngoài video | `lib/questionnaires/*` (chấm điểm, tuổi, engine Follow-Up bản 2025), `routes/questionnaires.ts`, trang `/questionnaires`                                                                                                                                                          | ✅ thử nội bộ (`MCHAT_MODE=inapp` từ 2026-10-14: 20 câu + Follow-Up trong app, đã kiểm chứng; đưa ra ngoài nhóm cần giấy phép tác giả — L1) |

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
   ├─ Bài tập (Giai đoạn 4): bảng ExerciseSession + worker riêng exerciseProcessor.ts (cùng mẫu hàng đợi DB);
   │   chấm bắt chước imitation-v1 ngay trong backend từ keypoints; subject ML "ex_<sessionId>" (lượt tập), "tpl_…" (mẫu)
   ├─ Bảng hỏi M-CHAT-R/F: QuestionnaireResponse; chấm điểm + engine Follow-Up chạy hoàn toàn trong backend (không gọi ML)
   └─ openposeService.ts ──fetch + X-API-Key + semaphore (ML_MAX_CONCURRENCY)──►
ML server FastAPI "ASD OpenPose + ST-GCN" (:8000 trên máy GPU GTX 1650, public qua ngrok)
   ├─ openpose.bin BODY_25 → storage/asd_subjects/<subject_id>/ (keypoints, metadata, prediction)
   ├─ làm mờ mặt → input_blurred.mp4 (VIDEO_RETENTION=blurred|none|raw), xoá input.mp4 gốc
   ├─ ST-GCN finetuned_best_model.pth (+ calibration.json nếu khớp sha256) → p_asd, ngưỡng, thông tin model
   └─ /health (công khai): model, CUDA, OpenPose, calibration, chế độ lưu video, auth
(Chưa nối) Llama server FastAPI: Llama-3.2-3B-Instruct 4-bit + LoRA asd_lora_1 / asd_lora_2
```

- `subject_id` trên máy ML = `VideoUpload.id` (UUID) → khớp 1–1 với DB.
- **Máy ML đang chạy ở ngrok vẫn là bản CŨ 1.0.0** (không có `/health`, không API key, không làm mờ, không trả fps; có `DELETE /subjects/{id}`). Lỗi CUDA ngày 2026-10-05 **đã được sửa**: ngày 2026-10-06 hai lượt sàng lọc thật chạy xong trên GPU. Backend mới tương thích ngược với bản cũ.
- Môi trường phát triển: Windows, PowerShell/Git Bash, Node 20+ (máy dev hiện có Node 24). Máy ML: Linux, OpenPose tại `/workspace/openpose/build_gtx1650_nocudnn`, Python 3.10. Workspace huấn luyện: `/home/nhomk23/workspace/NCKH_25-26/`.

---

## 4. Cấu trúc repo

```text
Main/
├─ backend/
│  ├─ prisma/               schema.prisma, migrations/ (20260521_init, 20260926_add_screening_error_message,
│  │                        20261005_screening_privacy_queue, 20261007_exercise_imitation,
│  │                        20261007_parent_questionnaire), seed.ts
│  ├─ src/app.ts            CORS, json, /api/health, mount routers, errorHandler (KHÔNG còn route /uploads công khai)
│  ├─ src/routtes/           auth, children (+consent), consent, screenings, results, chat, articles,
│  │                        admin (+ml-health, questionnaires/status), skeleton, subjects*, pipeline* (*: proxy ML, chỉ ADMIN),
│  │                        exercises, exerciseSessions, childExercises, adminExercises, questionnaires
│  ├─ src/services/         openposeService (client ML, lỗi có phân loại), screeningProcessor (hàng đợi DB),
│  │                        screeningResult (ngưỡng/mức/khuyến nghị), gaitFeatures, consentService,
│  │                        dataDeletion (xoá vĩnh viễn trẻ / lượt sàng lọc / lượt tập / bảng hỏi), aiMock, chatMock,
│  │                        poseTracking (theo dõi người, tách nguyên văn từ gaitFeatures), imitation/ (imitation-v1),
│  │                        exerciseProcessor (hàng đợi bài tập), mlCapabilities (ML có /health, nhận .webm không)
│  ├─ src/lib/              env, prisma, consent (nội dung đồng ý), serializers (+serializeChild), semaphore,
│  │                        prismaErrors, childInput (kiểm tra họ tên/ngày sinh/ghi chú), screeningData
│  │                        (subject ML, "có dữ liệu trên ML không", tóm tắt theo trẻ), exerciseInput, exerciseData,
│  │                        exerciseSerializers, errorLog (log lỗi đã che dữ liệu), questionnaireSerializers,
│  │                        questionnaires/ (mchatRf, age, copy, mchatRfStructure, mchatContent, followUpEngine)
│  ├─ src/middleware/       auth, requireRole, asyncHandler, errorHandler, subjectId
│  ├─ scripts/purgeProcessedVideos.ts   xoá video gốc của các lượt đã COMPLETED (mặc định dry-run)
│  │                        + probeMlExercise (G0), calibrateImitation (C1), purgeExerciseUploads,
│  │                        mchatContentTemplate, validateMchatContent
│  ├─ content/              mchat-rf.template.json (chỉ mã, không chữ) + README.md; mchat-rf.vi.json (nội dung có giấy phép) bị gitignore
│  ├─ test/                 node:test — gaitFeatures (bộ dáng đi tổng hợp), screeningResult, semaphore, prismaErrors,
│  │                        childInput, screeningData, poseTracking, imitation*, exercise*, mchatRf, questionnaire*,
│  │                        mchatRfStructure, followUpEngine, mchatContent (21 file, 334 test);
│  │                        test/e2e/ (PostgreSQL tạm + ML giả bằng Node: exercise, questionnaire, questionnaireInApp — 40 test)
│  └─ uploads/              video upload (gitignored; video được xoá sau khi phân tích thành công)
├─ frontend/src/
│  ├─ components/           ScreeningUploadPanel, ConsentPanel, ScreeningResultView, GaitFeaturesCard, RiskPill
│  │                        (RiskPill + ModelScoreBar), GaitTrendChart (biểu đồ xu hướng + bảng), ChildForm,
│  │                        ChildAvatar, UploadDropzone, Card, AIAssistantCard, RecentResultsCard…
│  │                        exercise/ (GuidePuppet, WebcamRecorder, ImitationResultView, ExerciseProgressChart, …),
│  │                        questionnaire/ (InAppQuestionnaire, FollowUpStepView, ResultStateCard, DoctorSummary, …),
│  │                        children/ (ChildExercisesSection, ChildQuestionnairesSection)
│  ├─ lib/                  api (401 interceptor, apiErrorCode/apiErrorMessage), types, skeleton (vẽ BODY_25),
│  │                        video (đọc thời lượng/kích thước trước upload), format (ngày, tuổi, nhãn),
│  │                        gaitMetrics (định nghĩa chỉ số dáng đi dùng chung), children (thông báo lỗi hồ sơ/xoá),
│  │                        exercises, exerciseTypes, useExerciseCapabilities, recording, puppet,
│  │                        questionnaires, questionnaireTypes, useQuestionnairesEnabled
│  ├─ pages/                Home, Screening, Children, ChildDetail, History, Admin, AdminSkeleton, Guide, Login, …
│  │                        Exercises, ExercisePractice, ExerciseSession, AdminExercises, AdminExerciseEdit,
│  │                        AdminRecorderProbe, Questionnaires, QuestionnaireEntry, QuestionnaireResult, QuestionnaireFollowUp
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
├─ docs/MCHAT_PERMISSION.md  giấy phép M-CHAT-R/F, bản tiếng Việt nên dùng, cách bật chế độ hỏi trong app, email xin phép (nháp)
├─ README.md
└─ master_prompt.md         file này
```

---

## 5. Môi trường, chạy và kiểm chứng

### 5.1 Dịch vụ

- Frontend dev: `http://localhost:5173` / `http://127.0.0.1:5173`. Backend dev: `http://localhost:4000`, health `GET /api/health`.
- DB dùng chung: `100.104.148.57:5433`, DB `asdr` (cần Tailscale đang kết nối). `backend/.env` trỏ `DATABASE_URL` tới đó. Không in/commit credentials. Container `asdr-db` trên máy `user-KHMT02` mất cổng sau mỗi lần máy chủ reboot cho tới khi sửa dứt điểm (§15 mục 24, §19.1).
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
curl http://
localhost:8000/health        # kiểm tra cuda_available, openpose_available, calibrated
```

Tài khoản demo sau seed: Admin `admin@asdr.local` / `admin123`, User `	` / `user123` (chỉ môi trường thử).

### 5.3 Kiểm thử tự động (backend đạt ngày 2026-10-14; API/ và research_src/ đạt ngày 2026-10-07)

```bash
cd backend && npm run typecheck && npm test            # 334 test
cd backend && npm run test:e2e                         # 41 test: PostgreSQL tạm :55432 + backend :4100 + ML giả :8100 (không đụng DB chung)
cd frontend && npx tsc -b && npm run build              # ESLint còn 2 lỗi có sẵn trong state/auth.tsx
cd API/tests && python -m unittest test_anonymize test_server     # 18 test (OpenPose giả, checkpoint ngẫu nhiên)
python -m unittest discover -s research_src/tests       # 29 test
```

Kiểm chứng runtime: `GET /api/health`, login thật, `GET /api/auth/me`, `GET /api/admin/ml-health` (admin) cho biết ML có kết nối không, có phải bản cũ (`legacy: true`) không.

### 5.4 Migration — ĐỌC KỸ trước khi đụng DB dùng chung

- Lịch sử migration trên DB dùng chung **khác repo**: DB ghi nhận `20261003162407_init` (không có trong repo) thay vì `20260521_init` + `20260926_add_screening_error_message`; schema thực tế thì khớp. Ngày 2026-10-05 migration `20261005_screening_privacy_queue` đã được áp lên DB này bằng cách chạy đúng SQL của nó trong một transaction (`prisma db execute`), rồi `prisma migrate resolve --applied 20261005_screening_privacy_queue`. Đã kiểm tra `prisma migrate diff` → "No difference detected".
- Ngày 2026-10-07 hai migration chỉ-thêm đã được áp lên DB chung theo đúng quy trình dưới đây: `20261007_exercise_imitation` (4 bảng `Exercise`, `ExerciseTemplate`, `ExerciseSession`, `SessionScore` + 3 enum) và `20261007_parent_questionnaire` (bảng `QuestionnaireResponse`). `migrate diff` sau đó → "No difference detected".
- **Không bao giờ** chạy `prisma migrate dev` (sẽ đòi reset DB chung) hay `prisma migrate deploy` (sẽ cố chạy lại init và lỗi) trên DB dùng chung.
- Quy trình cho migration mới trên DB dùng chung:
  1. `npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel <schema trước thay đổi> --script` → phải là migration rỗng (DB đúng trạng thái trước).
  2. Gói SQL của migration mới trong `BEGIN; … COMMIT;` rồi `npx prisma db execute --file <file.sql> --schema prisma/schema.prisma`.
  3. `npx prisma migrate resolve --applied <tên_migration>`; kiểm tra lại bằng `migrate diff --from-schema-datasource … --to-schema-datamodel prisma/schema.prisma --exit-code`.
- DB mới hoàn toàn (Docker, máy cá nhân): `npm run prisma:deploy`.
- Việc "baseline" lại lịch sử migration của DB chung là quyết định của nhóm.
- Schema phải **chỉ thêm** (bảng mới, cột nullable) và code mới vẫn **ghi các cột cũ còn bắt buộc** — thành viên khác có thể chạy code cũ trên cùng DB (Prisma cũ báo P2032 khi gặp NULL ở trường nó cho là bắt buộc).

### 5.5 Test Follow-Up M-CHAT-R/F bằng tay (màn hình thật)

Điều kiện: `MCHAT_MODE=inapp`; `npm run questionnaires:validate-content` báo `State: ready`; tài khoản phụ huynh seed (`backend/prisma/seed.ts`); một trẻ 16–30 tháng (trên DB chung: Bé An, 28 tháng tại 14/10/2026; hoặc tạo hồ sơ mới).

1. Menu **Bảng hỏi** → **Làm lại** ở dòng của trẻ → chọn người trả lời → tick đồng ý → **Xác nhận đồng ý** → **Bắt đầu trả lời**.
2. Trả lời **"Có" cả 20 câu** (phím C). Câu 2, 5, 12 "Có" là điểm → 3 điểm = mức trung bình → **Gửi câu trả lời** → app tự vào Follow-Up ("Có 3 mục cần hỏi thêm").
3. **Bắt đầu phần hỏi thêm**, rồi chọn kết quả muốn thử:
   - mọi câu Có/Không trả lời **"Không"**, câu mở bấm **Tiếp tục** → "Khả năng thấp sau phần hỏi thêm";
   - mọi câu trả lời **"Có"**, câu chọn chọn bất kỳ → câu 2 và 5 còn điểm → "Khả năng cao".
4. Nên thử thêm:
   - "Không chắc" → phải hỏi tiếp "thường là Có hay Không";
   - ví dụ cuối của câu 5 là ô "Khác": "Có" + vài chữ mô tả → trang kết quả ghi "Mục cần xem lại: câu 5";
   - "Quay lại";
   - "Tạm dừng, làm tiếp sau", rồi vào lại từ **Bảng hỏi** hoặc hồ sơ trẻ → tiếp tục đúng chỗ.
5. Trang kết quả: mức khớp cách trả lời; "Tóm tắt cho bác sĩ" có điểm từng mục, không có chữ câu hỏi; **In / lưu PDF** chạy.
6. Dọn DB chung: **Xoá lần trả lời này**.

Muốn phủ cả 20 câu Follow-Up: gửi nhiều lượt mức trung bình, mỗi lượt trượt ≤ 7 câu (câu 2, 5, 12 trượt khi "Có", các câu khác khi "Không"). Ba nhóm đã dùng ngày 14/10: {1, 2, 5, 6, 7, 13, 14}, {3, 4, 8, 9, 10, 11, 12}, {15–20} (§20.3). Test tự động tương ứng (nội dung giả, DB tạm): `npm run test:e2e` (§5.3).

---

## 6. Backend (Express + Prisma)

### 6.1 Biến môi trường (`backend/src/lib/env.ts`, validate bằng Zod; mẫu: `backend/.env.example`)

| Biến                                                                                  | Mặc định                                | Ghi chú                                                                                                                                                                                                                                                                                                   |
| -------------------------------------------------------------------------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`, `JWT_SECRET` (≥16), `JWT_EXPIRES_IN`, `PORT`, `CORS_ORIGIN` | — / 7d / 4000 / localhost:5173            | như trước                                                                                                                                                                                                                                                                                               |
| `MAX_UPLOAD_MB` / `SKELETON_MAX_UPLOAD_MB`                                         | 1024 / 200                                 | screenings / admin skeleton                                                                                                                                                                                                                                                                                |
| `OPENPOSE_SERVER_URL`, `EXTRACT_API_URL`                                           | —,`http://localhost:8000/pipeline/asd`  | chỉ dùng origin                                                                                                                                                                                                                                                                                          |
| `OPENPOSE_API_KEY`                                                                   | (trống)                                   | gửi header`X-API-Key`                                                                                                                                                                                                                                                                                   |
| `EXTRACT_API_TIMEOUT_MS`                                                             | 3 600 000                                  | timeout gọi ML (đọc metadata/keypoints có timeout ngắn hơn)                                                                                                                                                                                                                                          |
| `BYPASS_EXTRACT_API`                                                                 | false                                      | kết quả mô phỏng, có nhãn`provider: mock`                                                                                                                                                                                                                                                          |
| `ML_MAX_CONCURRENCY`                                                                 | 1                                          | số lệnh OpenPose đồng thời từ backend + số job worker chạy song song                                                                                                                                                                                                                               |
| `SCREENING_MAX_ATTEMPTS` / `SCREENING_POLL_INTERVAL_MS`                            | 3 / 3000                                   | hàng đợi                                                                                                                                                                                                                                                                                                |
| `SCREENING_THRESHOLD` / `SCREENING_TEMPERATURE`                                    | (trống)                                   | trống = để ML quyết định (calibration.json hoặc 0.5 / 1.0)                                                                                                                                                                                                                                          |
| `SCREENING_HIGH_RISK_THRESHOLD`                                                      | 0.7                                        | chỉ dùng khi ML không gửi`high_risk_threshold`                                                                                                                                                                                                                                                       |
| `RETAIN_UPLOADED_VIDEOS`                                                             | false                                      | false = xoá video gốc sau khi phân tích thành công                                                                                                                                                                                                                                                   |
| `EXERCISE_MODE`                                                                      | admin_only                                 | `off` (ẩn + dừng worker) / `admin_only` (chỉ ADMIN, tới khi qua C1) / `on` (cả phụ huynh)                                                                                                                                                                                                      |
| `EXERCISE_WORKER_ENABLED`                                                            | true                                       | worker chấm bài tập trong process backend                                                                                                                                                                                                                                                               |
| `EXERCISE_MAX_UPLOAD_MB` / `EXERCISE_MAX_DURATION_SEC`                             | 100 / 60                                   | giới hạn file / độ dài tuyệt đối (mỗi mẫu còn giới hạn riêng)                                                                                                                                                                                                                                |
| `EXERCISE_MAX_PENDING_PER_CHILD` / `EXERCISE_MAX_ATTEMPTS`                         | 3 / 2                                      | số lượt chờ chấm mỗi trẻ (429) / số lần thử của worker                                                                                                                                                                                                                                          |
| `EXERCISE_EXTRACT_TIMEOUT_MS` / `EXERCISE_POLL_INTERVAL_MS`                        | 600 000 / 3000                             | timeout gọi ML cho clip bài tập / chu kỳ worker                                                                                                                                                                                                                                                        |
| `EXERCISE_WEBM_AS_MKV`                                                               | false                                      | gửi`.webm` cho ML 1.0 dưới tên `.mkv`; chỉ bật khi G0 xác nhận ML đọc được                                                                                                                                                                                                                |
| `MCHAT_MODE`                                                                         | off (`backend/.env` hiện là `inapp`) | `off` / `entry` (nhập theo số câu từ phiếu chính thức) / `inapp` (hỏi trong app + Follow-Up; cần giấy phép + file nội dung; file mới đủ phần 1 → chỉ phần 1 trong app, Follow-Up nhập tay; chưa có thì chạy như `entry`). `backend/.env` đặt `inapp` từ 2026-10-13 |
| `MCHAT_CONTENT_PATH`                                                                 | `content/mchat-rf.vi.json`               | file nội dung có giấy phép cho`inapp` (gitignore)                                                                                                                                                                                                                                                    |
| `CHAT_API_BASE_URL`                                                                  | —                                         | chưa dùng                                                                                                                                                                                                                                                                                                |

### 6.2 Data model (Prisma)

- Không đổi: `User`, `ChildProfile`, `ChatMessage`, `Article`.
- `VideoUpload` thêm: `durationMs`, `videoWidth`, `videoHeight` (đo ở trình duyệt), `videoDeletedAt` (video gốc đã xoá), `consentId`, quan hệ `job`.
- `ScreeningResult` thêm: `asdProbability` (p_asd), `decisionThreshold`, `highRiskThreshold`, `calibrated`, `modelVersion` (`<checkpoint>@<sha12>`), `gaitFeatures` (JSON). 4 cột `eyeContactScore/motorPatternScore/responseBehaviorScore/repetitiveBehaviorScore` thành **nullable, deprecated**: vẫn ghi giá trị suy ra như cũ (p_typical ×3, p_asd) chỉ để code cũ đọc được; **không trả qua API, không hiển thị**.
- Mới `ConsentRecord` (userId, childId, version, scopes[] `VIDEO_PROCESSING` bắt buộc / `RESEARCH_USE` tuỳ chọn, `statement` JSON nguyên văn, grantedAt, revokedAt).
- Mới `ScreeningJob` (videoId unique, status `QUEUED|RUNNING|SUCCEEDED|FAILED`, attempts, maxAttempts, runAfter, lockedBy, lockedAt, lastError).
- **Giai đoạn 4** (migration `20261007_exercise_imitation`):
  - `Exercise`: slug, tiêu đề, mô tả, `childPrompt` (lời bạn Mầm), độ khó, `bodyFocus`, `source` (dựng sẵn / admin), `status` `DRAFT|PUBLISHED|ARCHIVED`, `currentTemplateId`;
  - `ExerciseTemplate`: bản mẫu có version, không sửa sau khi tạo — nguồn + `sourceAttestation` (admin xác nhận là người lớn tự quay), fps, `mirrorPolicy` `EITHER|ANATOMICAL_ONLY|MIRROR_ONLY`, `algorithmVersion`, `templateHash`, đoạn chuyển động, `guideTrack` (cho bạn Mầm), `features`, `quality`, `selfTest`;
  - `ExerciseSession`: một lượt tập đồng thời là một job hàng đợi — `status` `QUEUED|PROCESSING|SCORED|INSUFFICIENT|FAILED`, cách ghi / cách tập / tốc độ mẫu, thông tin file, `mlSubjectId` + thời điểm xoá, attempts/runAfter/lockedBy/lockedAt, `lastError` (chỉ admin), `errorMessage` (cho phụ huynh), `consentId`;
  - `SessionScore`: duy nhất theo `sessionId + algorithmVersion` — overall, stars, band, mode (thường/soi gương), reasonCodes, `detail` theo bộ phận.
- **Bảng hỏi** (migration `20261007_parent_questionnaire`): `QuestionnaireResponse` — instrument `MCHAT_RF`, phiên bản cấu trúc / cách tính điểm / nội dung, `mode` `OFFICIAL_FORM_ENTRY|IN_APP`, người trả lời, tuổi (tháng) lúc làm, `answers` (20 câu), `totalScore`, `band`, `failedItems`, trạng thái / nguồn / kết quả Follow-Up, `followUpAnswers` (đường đi trong engine), `outcome` `SCREEN_NEGATIVE|FOLLOW_UP_NEEDED|REFER`, `rescreenAfter`, nguyên văn consent.
- Chỉ thêm back-relation ở `User`, `ChildProfile`, `ConsentRecord`; không đổi cột cũ nào.
- Cột thời gian là `TIMESTAMP(3)` không múi giờ, lưu UTC; DB có thể chạy múi giờ khác (máy dev: Asia/Bangkok) → trong raw SQL không dùng `NOW()` hay tham số Date trần (xem `claimJobs`).

### 6.3 Bảng API

| Method          | Path                                                                                                | Auth                                            | Mô tả                                                                                                                                                                                                                                                                                   |
| --------------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET             | `/api/health`                                                                                     | —                                              | `{ok:true}`                                                                                                                                                                                                                                                                             |
| POST            | `/api/auth/register`, `/api/auth/login`, `/api/auth/logout`; GET `/api/auth/me`             | —/JWT                                          | như trước                                                                                                                                                                                                                                                                              |
| GET/POST        | `/api/children`                                                                                   | JWT                                             | list (mỗi trẻ kèm`summary`: số lần, số có kết quả, lần gần nhất, mức gần nhất, `hasActiveConsent`) / tạo (họ tên trim 1–100 ký tự; ngày sinh `YYYY-MM-DD` hợp lệ, không sau hôm nay, từ 1900; ghi chú ≤ 1000)                                          |
| GET             | `/api/children/:id`                                                                               | JWT (chủ hồ sơ)                              | dashboard:`child` (+summary), `consent`, `screenings` (mới nhất trước, đã serialize kèm kết quả)                                                                                                                                                                           |
| PATCH           | `/api/children/:id`                                                                               | JWT (chủ hồ sơ)                              | sửa một phần`fullName`, `dateOfBirth`, `gender`, `note` (`null`/rỗng = xoá ghi chú); 400 `INVALID_DATE_OF_BIRTH`                                                                                                                                                        |
| DELETE          | `/api/children/:id`                                                                               | JWT (chủ hồ sơ)                              | **xoá vĩnh viễn** trẻ + mọi lượt sàng lọc, kết quả, job, consent, video gốc còn lưu, subject trên ML (§6.6); 409 `SCREENING_IN_PROGRESS`, 503 `ML_UNAVAILABLE`                                                                                                  |
| GET             | `/api/consent/current`                                                                            | JWT                                             | nội dung đồng ý, sinh theo cấu hình thực tế (backend có giữ video? ML làm mờ/không lưu/lưu gốc/không rõ)                                                                                                                                                                |
| GET/POST/DELETE | `/api/children/:id/consent`                                                                       | JWT (chủ hồ sơ)                              | xem / đồng ý (`{accepted:true, version, scopes}`) / thu hồi                                                                                                                                                                                                                         |
| POST            | `/api/screenings/upload?childId=`                                                                 | JWT + consent                                   | multipart`video` (.mp4/.mov/.avi/.mkv) + `childId`, `durationMs`, `videoWidth`, `videoHeight`; kiểm tra consent trước khi nhận file; 403 `CONSENT_REQUIRED`                                                                                                               |
| POST            | `/api/screenings/:id/process`                                                                     | JWT + consent                                   | đưa vào hàng đợi (idempotent; FAILED → chạy lại) → 202                                                                                                                                                                                                                          |
| GET             | `/api/screenings`, `/api/screenings/:id`                                                        | JWT                                             | đã serialize: không còn`filePath`/`rawAiResponse`/4 điểm cũ; có `job` (+`queuePosition`), `rawVideoDeleted`, `result.asdProbability`, `gaitFeatures`, `provider`; danh sách lọc thêm được `?childId=`                                                     |
| DELETE          | `/api/screenings/:id`                                                                             | JWT (chủ lượt)                               | **xoá vĩnh viễn** một lượt: upload, kết quả, job, video gốc, subject trên ML; 409/503 như xoá trẻ                                                                                                                                                                      |
| GET             | `/api/screenings/:id/keypoints`, `/prediction`                                                  | JWT                                             | lỗi ML trả mã chung, không lộ URL                                                                                                                                                                                                                                                    |
| GET             | `/api/results/:id`                                                                                | JWT                                             | serialize như trên                                                                                                                                                                                                                                                                      |
| POST            | `/api/chat`                                                                                       | JWT                                             | regex mock                                                                                                                                                                                                                                                                                |
| GET             | `/api/articles`, `/api/articles/:slug`                                                          | —                                              | knowledge base                                                                                                                                                                                                                                                                            |
| GET             | `/api/admin/stats`                                                                                | ADMIN                                           | + thống kê hàng đợi, lỗi kỹ thuật (`jobLastError`) của lượt gần đây                                                                                                                                                                                                       |
| GET             | `/api/admin/ml-health`                                                                            | ADMIN                                           | ML có kết nối không, bản cũ hay mới, CUDA/OpenPose/calibration/chế độ lưu video                                                                                                                                                                                                |
| *               | `/api/admin/skeleton/*`                                                                           | ADMIN                                           | §10                                                                                                                                                                                                                                                                                      |
| GET             | `/api/exercises/capabilities`                                                                     | JWT                                             | chế độ bài tập với người đang đăng nhập (`available`), ML có nhận `.webm` không                                                                                                                                                                                        |
| GET             | `/api/exercises` (`?childId=`), `/api/exercises/:id`, `/api/exercises/consent-statement`    | JWT + chế độ cho phép                       | thư viện bài đã PUBLISHED (+ tiến độ của trẻ), chi tiết +`guideTrack` cho bạn Mầm, nội dung đồng ý ghi hình bài tập                                                                                                                                                 |
| GET/POST/DELETE | `/api/children/:childId/exercise-consent`                                                         | JWT (chủ hồ sơ)                              | đồng ý riêng cho bài tập (version`exercise-2026-10-07`, scope `EXERCISE_VIDEO`); DELETE luôn mở kể cả khi tắt chế độ                                                                                                                                                    |
| GET             | `/api/children/:childId/exercise-progress`                                                        | JWT (chủ hồ sơ)                              | tiến độ theo từng bài: số lần, điểm cao nhất, lần gần nhất, chuỗi điểm cho biểu đồ                                                                                                                                                                                     |
| POST            | `/api/exercise-sessions/upload?childId=&exerciseId=&templateId=`                                  | JWT + consent bài tập                         | multipart`video` + `durationMs`, `recordedVia`, `practiceMode`, `playbackRate`, kích thước; 403 `EXERCISE_CONSENT_REQUIRED`, 409 `TEMPLATE_OUTDATED`, 422 `RECORDING_TOO_SHORT`/`RECORDING_TOO_LONG`, 415 `RECORDING_FORMAT_UNSUPPORTED`, 429 `TOO_MANY_PENDING` |
| GET/POST/DELETE | `/api/exercise-sessions` (`?childId=`), `/:id`, POST `/:id/retry`, DELETE `/:id`          | JWT (chủ lượt)                               | danh sách / chi tiết (điểm + phản hồi theo bộ phận) / chấm lại lượt FAILED / xoá vĩnh viễn (DB + file + subject ML); DELETE luôn mở                                                                                                                                      |
| *               | `/api/admin/exercises/*`                                                                          | ADMIN                                           | danh sách/tạo/sửa/xoá bài,`builtins/sync` (6 bài dựng sẵn), `queue`, `:id/stats`, `:id/template-sources` (video người lớn → subject `tpl_`), `:id/templates` (biên dịch mẫu, có `dryRun`), `:id/publish`, guide, xoá subject nguồn                      |
| GET             | `/api/questionnaires`, `/api/questionnaires/content`, `/api/questionnaires/consent-statement` | JWT                                             | bảng hỏi có bật không, chế độ, link phiếu chính thức / nội dung câu hỏi (chỉ khi`inapp` và file nội dung `ready`) / nội dung đồng ý                                                                                                                              |
| GET/POST        | `/api/children/:childId/questionnaires`                                                           | JWT (chủ hồ sơ)                              | độ tuổi (16–30 tháng) + lịch sử / nộp 20 câu trả lời + người trả lời + consent; 400`INCOMPLETE_ANSWERS` (kèm `missing`), 422 `AGE_OUT_OF_RANGE`, 409 `CONSENT_VERSION_OUTDATED`                                                                                   |
| GET/DELETE      | `/api/questionnaire-responses/:id`                                                                | JWT (chủ hồ sơ)                              | kết quả (đọc được cả khi tắt chế độ) / xoá vĩnh viễn                                                                                                                                                                                                                       |
| GET/POST        | `/api/questionnaire-responses/:id/follow-up`, `/follow-up/answer`, `/follow-up/back`          | JWT (chủ hồ sơ)                              | Follow-Up trong app do server điều khiển (bước hiện tại / trả lời / quay lại); POST`/follow-up` = nhập kết quả Follow-Up đã làm cùng nhân viên y tế; điểm và cờ "cần xem lại" chỉ trả khi COMPLETED                                                         |
| GET             | `/api/admin/questionnaires/status`                                                                | ADMIN                                           | chế độ, trạng thái file nội dung, số liệu tổng hợp (không có câu trả lời riêng)                                                                                                                                                                                           |
| *               | `/subjects/*`, `/api/subjects/*`, `/pipeline/asd`, `/api/pipeline/asd`                      | **ADMIN** (trước đây không có auth) | proxy ML thô;`subject_id` phải khớp `^[A-Za-z0-9_-]{1,64}$`                                                                                                                                                                                                                        |

Lỗi: JSON hỏng → 400 `INVALID_JSON`; Zod → 400; Multer → 413/400; lỗi ML trên route admin → giữ mã 4xx của ML hoặc 502 (`ML_SERVER_ERROR`); thiếu bảng/cột (P2021/P2022) → 503 `DATABASE_MIGRATION_REQUIRED`; chế độ tắt → 403 `EXERCISES_DISABLED` / 503 `QUESTIONNAIRE_DISABLED` (các GET đọc kết quả bảng hỏi và các DELETE vẫn mở). Lỗi 500 trả thông báo chung; log lỗi đi qua `lib/errorLog.ts` (che tên, tên file, nội dung body). Proxy ML thô và Admin Skeleton chặn subject `ex_`/`tpl_` (403 `EXERCISE_SUBJECT_PROTECTED`).

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

### 6.6 Xoá dữ liệu theo yêu cầu phụ huynh (`backend/src/services/dataDeletion.ts`)

1. Từ chối (409 `SCREENING_IN_PROGRESS`) nếu có job `RUNNING`: ML sẽ tạo lại subject khi job chạy xong.
2. **Xoá trên máy ML trước** (`DELETE /subjects/{id}`) cho mọi lượt có thể đã tới ML (`mayHaveMlData`: có kết quả không phải mock, hoặc job đã chạy ≥ 1 lần, hoặc lượt cũ không có job mà không ở trạng thái UPLOADED). 404 JSON = không có gì để xoá; **404 dạng HTML (tunnel ngrok chết), lỗi mạng, 5xx, 401 = thất bại** → 503 `ML_UNAVAILABLE`, DB và file giữ nguyên để phụ huynh thử lại (tránh để lại dữ liệu khung xương "mồ côi" trên ML).
3. Một transaction: khoá dòng `ChildProfile`/`VideoUpload` (`FOR UPDATE`, chặn upload mới cho trẻ) và các dòng `ScreeningJob` (worker dùng `SKIP LOCKED` nên không thể nhận job đó); đọc lại, nếu job vừa được nhận hoặc vừa chạy lại sau bước 2 → 409; rồi xoá (cascade: upload, kết quả, job, consent).
4. Sau commit: xoá video gốc trong `uploads/` (chỉ đường dẫn nằm trong `uploads/`).
5. Worker tự vệ: nếu upload bị xoá ngoài luồng trong lúc phân tích (xoá trực tiếp DB…), worker xoá file gốc + subject ML vừa tạo thay vì báo lỗi. Mọi lỗi khi ghi nhận thất bại đều được bắt (trước đây một lỗi DB lúc đó có thể thành unhandled rejection và làm sập backend).
6. Từ Giai đoạn 4: xoá trẻ cũng xoá mọi lượt tập (file + subject `ex_` trên ML) và câu trả lời bảng hỏi; 409 `EXERCISE_IN_PROGRESS` nếu có lượt tập đang chấm. Xoá từng lượt tập: `deleteExerciseSessionData`; từng bảng hỏi: `deleteQuestionnaireResponse`. DB chưa có bảng mới (`exerciseTablesPresent()` = false) thì bỏ qua phần đó.

### 6.7 Bài tập bắt chước (Giai đoạn 4, `services/imitation/`, `exerciseProcessor.ts`)

- **Chế độ:** `EXERCISE_MODE` (mặc định `admin_only`: chỉ ADMIN thấy menu "Bài tập" và tập được). Frontend hỏi `GET /exercises/capabilities`.
- **Đồng ý riêng:** `ConsentRecord` có version `exercise-2026-10-07`, scope `EXERCISE_VIDEO`. Thu hồi consent sàng lọc không đụng tới consent bài tập và ngược lại. Thu hồi trong lúc lượt đang chờ → worker chuyển FAILED, xoá video, không gửi ML.
- **Luồng phụ huynh:**
  1. `/exercises?childId=` → đồng ý ghi hình bài tập → chọn bài.
  2. `/exercises/:id/practice`: xem bạn Mầm làm mẫu (puppet vẽ từ `guideTrack`, tốc độ bình thường / chậm hơn), checklist khung hình, cách tập "Làm cùng bạn Mầm" hoặc "Xem trước rồi làm theo", "Chế độ cho bé" (toàn màn hình, giữ nút để thoát).
  3. Ghi webcam (MediaRecorder, `.webm`) hoặc tải video quay sẵn → `POST /exercise-sessions/upload` (kiểm tra consent trước khi nhận file; độ dài tối thiểu = max(1 giây, 0,6 × mẫu), tối đa theo mẫu và `EXERCISE_MAX_DURATION_SEC`).
  4. Worker (cùng mẫu với hàng đợi sàng lọc: `FOR UPDATE SKIP LOCKED`, heartbeat, phục hồi job chết, SQL an toàn múi giờ) gửi clip lên ML `/subjects/extract` với subject `ex_<sessionId>`, đọc keypoints, chấm imitation-v1, lưu `SessionScore`, rồi **xoá video gốc và subject trên ML**.
  5. `/exercise-sessions/:id`: điểm luyện tập 0–100 + sao, nhãn "Thử nghiệm", điểm và nhận xét theo bộ phận (tay trái/phải, chân, thân), gợi ý cho lần sau, "Video gốc: đã xoá". Dashboard trẻ có `ChildExercisesSection` + `ExerciseProgressChart` (một đường, kèm bảng).
- **imitation-v1** (hằng số cố định trong `imitation/constants.ts`, có sha snapshot trong test; đổi hằng số = đổi `algorithmVersion`): lấy mẫu lại 15 Hz, làm sạch keypoint (conf ≥ 0,3, lấp khoảng trống ≤ 0,4 giây), đặc trưng góc khớp + vị trí tương đối, **subsequence DTW** (tìm đoạn khớp trong clip dài hơn mẫu), chế độ soi gương theo `mirrorPolicy` (`EITHER` chấm cả hai, lấy điểm cao hơn), điểm theo bộ phận (bộ phận đứng yên trong mẫu được chấm "giữ yên"), hệ số biên độ và nhịp, sao ≥ 80 → 3, ≥ 60 → 2, còn lại 1. Không đủ dữ liệu (không thấy người, thiếu khớp, quá ngắn, nhiều người, quay lưng…) → `INSUFFICIENT` với lý do tiếng Việt, không có điểm.
- **Mẫu:** 6 bài dựng sẵn (`dang-tay`, `gio-tay-chao`, `vuon-cao`, `nghieng-nguoi`, `ngoi-xuong`, `buoc-deu`) sinh bằng khung xương tổng hợp — `POST /admin/exercises/builtins/sync` rồi publish từng bài. Mẫu từ video người lớn: Admin tải video + xác nhận (attestation) → subject `tpl_…` trên ML → biên dịch (`dryRun` để xem cổng chất lượng trước) → publish. ML 1.0 bỏ qua `subject_id` thì không tạo được mẫu từ video (cần G0 báo `subjectIdHonoured: true`).
- **ML 1.0:** không có `/health`, có thể không nhận `.webm`. `mlCapabilities.ts` dò và cache 60 giây; nếu ML trả lời là không nhận thì upload trả 415 `RECORDING_FORMAT_UNSUPPORTED` (frontend gợi ý tải MP4). `EXERCISE_WEBM_AS_MKV=true` chỉ sau khi G0 xác nhận.
- **Cổng của chủ dự án:** G0 `npm run exercises:probe-ml` (một video người lớn với ML thật: webm, subject_id, fps); C1 `npm run exercises:calibrate` (người lớn tự quay làm đúng / sai / soi gương) trước khi đặt `EXERCISE_MODE=on`. Thuật toán chưa được kiểm chứng trên trẻ em.
- **Dọn dữ liệu:** `npm run privacy:purge-exercise-uploads` (dry-run) / `-- --yes`.

### 6.8 Bảng hỏi phụ huynh M-CHAT-R/F (`lib/questionnaires/`, `routes/questionnaires.ts`)

- **Phạm vi:** trẻ 16–30 tháng tuổi; là nguồn đánh giá **bổ sung**, tách biệt với sàng lọc bằng video (không gộp điểm). Trang `/questionnaires` liệt kê từng trẻ: trong độ tuổi / chưa tới tuổi (ngày có thể làm) / ngoài độ tuổi (gợi ý mốc phát triển CDC).
- **Chế độ** `MCHAT_MODE`:
  - `off`: ẩn menu; các GET kết quả đã lưu vẫn đọc được, xoá vẫn được; tạo/sửa → 503 `QUESTIONNAIRE_DISABLED`;
  - `entry`: phụ huynh làm trên phiếu chính thức (link mchatscreen.com) rồi nhập Có/Không theo **số câu** — app không hiển thị chữ của câu hỏi; Follow-Up nhập theo kết quả đã làm cùng nhân viên y tế;
  - `inapp`: hỏi từng câu trong app + Follow-Up tự động, **chỉ khi** file nội dung có giấy phép hợp lệ (`questionnaires:validate-content` báo `ready`, khớp structure hash). Từ 2026-10-13: file mới đủ phần 1 (metadata + `ui.stage1Instructions` + 20 câu; validate báo `Stage 1 in app: ready`) thì hỏi 20 câu trong app, còn Follow-Up đi đường nhập tay (`getStage1Content`, `GET /questionnaires` → `inApp.followUpAvailable=false`). Không có file dùng được thì chạy như `entry`. **Từ 2026-10-14 file đủ cả Follow-Up (`State: ready`) và `backend/.env` là `inapp`: app đang hỏi 20 câu + Follow-Up tự động** (chỉ thử nội bộ, chưa có giấy phép — §20).
- **Chấm điểm** (`mchatRf.ts`, quy tắc đã công bố): 20 câu Có/Không; câu 2, 5, 12 "Có" là điểm; 0–2 khả năng thấp (`SCREEN_NEGATIVE`; dưới 24 tháng → hẹn làm lại sau sinh nhật 2 tuổi), 3–7 trung bình (`FOLLOW_UP_NEEDED`, Follow-Up chỉ cho các câu chưa đạt; còn ≥ 2 câu → `REFER`), 8–20 cao (`REFER`, không bao giờ hạ mức). Tuổi tính theo lịch (`age.ts`).
- **Engine Follow-Up** (`followUpEngine.ts`, chỉ `inapp`): đồ thị câu hỏi bản 2025 là hằng số trong repo (`mchatRfStructure.ts`, chỉ mã nút, không chữ); chữ lấy từ file nội dung theo mã. Server giữ đường đi (`followUpAnswers`) và tính lại từ đầu mỗi lần trả lời / quay lại; khoá dòng `SELECT … FOR UPDATE`. Nút: PROMPT, YES_NO, CHECKLIST, MOST_OFTEN, CHOICE; trả lời "Không chắc" dẫn tới bước làm rõ. Ô "Khác" của checklist: câu 5 và câu 12 được tính và gắn cờ cần xem lại; các câu 3, 9, 15, 17, 20 không tính nhưng gắn cờ. Điểm và cờ chỉ hiện khi Follow-Up COMPLETED.
- **Kết quả** (`/questionnaire-responses/:id`): mức khả năng + việc nên làm, tóm tắt cho bác sĩ (số câu, không có chữ câu hỏi), hướng dẫn nơi đánh giá, in/lưu PDF, disclaimer "không phải chẩn đoán", dòng bản quyền. Đồng ý: `questionnaire-2026-10-08` (gửi kèm câu trả lời).
- **Giấy phép (L1):** dùng điện tử cần tác giả cho phép (`docs/MCHAT_PERMISSION.md`: bản tiếng Việt khuyến nghị CCIHP 2015, email nháp gửi mchatscreen2009@gmail.com). Giấy phép của a365 / QĐ 2254/QĐ-BYT không chuyển sang AIMBRACE. Từ 2026-10-14 `inapp` bật **chỉ để thử nội bộ** (quyết định chủ dự án, §20).
- **Test bằng tay:** §5.5.

---

## 7. ML service (`API/`)

### 7.1 `server_openpose.py` (bản 2.0.0, **chưa triển khai lên máy GPU**)

Biến môi trường (đường dẫn tương đối tính từ thư mục `API/`):

| Biến                                                          | Mặc định                                                                                                   |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `OPENPOSE_BIN` / `OPENPOSE_MODEL_DIR`                      | `/workspace/openpose/build_gtx1650_nocudnn/examples/openpose/openpose.bin` / `/workspace/openpose/models` |
| `OPENPOSE_NET_RESOLUTION` / `OPENPOSE_TIMEOUT_SECONDS`     | `-1x256` / 3600                                                                                             |
| `SUBJECT_ROOT`                                               | `storage/asd_subjects`                                                                                      |
| `STGCN_CHECKPOINT` / `CALIBRATION_PATH` / `STGCN_DEVICE` | `ASD_Model/finetuned_best_model.pth` / cạnh checkpoint: `calibration.json` / `cuda`                    |
| `ML_API_KEY`                                                 | (trống = không yêu cầu key)                                                                               |
| `ML_MAX_CONCURRENT_JOBS`                                     | 1                                                                                                             |
| `VIDEO_RETENTION`                                            | `blurred` (`none` = không giữ video, `raw` = giữ gốc)                                               |

Endpoints (giữ nguyên contract cũ, chỉ thêm trường):

| Method | Path                                                                                                                      | Ghi chú                                                                                                                               |
| ------ | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/`, `/health`                                                                                                        | công khai;`/health` trả model_loaded, model_device, calibrated, video_retention, auth_required, openpose_available, cuda_available |
| POST   | `/subjects/extract`, `/pipeline/asd`                                                                                  | thêm`video` (fps, width, height, frame_count, duration_sec) và `video_retention` trong kết quả; nhận thêm `.webm`          |
| POST   | `/subjects/{id}/predict`                                                                                                | `threshold`/`temperature` giờ tuỳ chọn: thiếu thì dùng calibration hoặc 0.5/1.0                                             |
| GET    | `/subjects`, `/subjects/{id}`, `/subjects/{id}/keypoints`, `/subjects/{id}/prediction`; DELETE `/subjects/{id}` | keypoints kèm`video`                                                                                                                |

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

| Script                                                                             | Nội dung                                                                                                                                                                                                                                                                                                                                                                    |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `calibrate_evaluate.py` (mới)                                                   | `split` (chia train/val/test theo subject, phân tầng, seed), `calibrate` (temperature scaling NLL trên val, ngưỡng Youden hoặc theo độ nhạy, ngưỡng HIGH theo độ đặc hiệu → `calibration.json` kèm sha256 checkpoint), `evaluate` (chỉ chạy 1 lần trên test, chặn rò rỉ val→test, bootstrap CI 95% theo subject → `test_results.json`). |
| `predict_dataset.py` (mới)                                                      | chạy đúng tiền xử lý của server (`STGCNPredictor`) trên keypoints JSON / thư mục OpenPose JSON / Excel → CSV logits để calibrate/evaluate.                                                                                                                                                                                                                    |
| `fine_tune.py` (đã sửa)                                                       | thêm`--splits`; nếu không có thì tách val từ subject train (`--val-ratio`); chọn epoch theo **val** macro-F1; test 1 lần cuối; lưu `num_joints` và `test_results.json`. Sửa thêm lỗi: bản cũ lưu `state_dict()` theo tham chiếu nên "best" thực ra là epoch cuối. Vẫn phụ thuộc 2 module chỉ có trên server.                    |
| `EVALUATION.md` (mới)                                                           | quy trình + lệnh cho máy GPU.                                                                                                                                                                                                                                                                                                                                             |
| `ST-GCN.py`, `BiLSTM.py`, `SRM.py`, `training_llama.py`, `test_llama.py` | như trước (split subject-level 70/15/15, SRM có 5-fold theo subject).                                                                                                                                                                                                                                                                                                    |

Phát hiện quan trọng:

- Checkpoint đang deploy được chọn theo **test accuracy** và còn dính lỗi `state_dict` tham chiếu → mọi con số cũ **không dùng được**. Phải chạy lại theo `EVALUATION.md` rồi mới báo cáo.
- Dữ liệu `Dataset_video` đặt tên `video_1…video_50` (50 ASD, 49 Typical); regex subject mặc định `^([^/]+)` giả định **1 video = 1 trẻ** — nếu một trẻ có nhiều video phải truyền `--subject-regex`.
- Trong `API/storage`: `36` và `136` là cùng một video, hai thư mục UUID cũng vậy → phải gộp chung một subject nếu dùng.
- Kinect (train gốc) và OpenPose (inference) vẫn lệch miền; ngưỡng phải calibrate lại mỗi lần đổi checkpoint.

---

## 9. Frontend (React + Vite)

### 9.1 Routes

`/login`, `/register` (public) · `/`, `/screening` (`?childId=` chọn sẵn trẻ), `/children` (ChildrenPage), `/children/:id` (ChildDetailPage), `/history`, `/exercises` (`?childId=`), `/exercises/:exerciseId/practice`, `/exercise-sessions/:id`, `/questionnaires`, `/children/:id/questionnaires/mchat`, `/questionnaire-responses/:id`, `/questionnaire-responses/:id/follow-up`, `/assistant`, `/knowledge`, `/knowledge/:slug`, `/guide`, `/settings` (ProtectedRoute) · `/admin`, `/admin/skeleton`, `/admin/exercises`, `/admin/exercises/:id`, `/admin/exercises/recorder-probe` (AdminRoute). Các trang mới được lazy-load. Sidebar (sửa 2026-10-13, §19): nhóm chính Trang chủ · Hồ sơ trẻ · Sàng lọc · Bảng hỏi (khi `MCHAT_MODE` khác `off`) · Bài tập (khi `capabilities.available`) · Lịch sử; nhóm hỗ trợ Trợ lý AI · Kiến thức · Hướng dẫn; ghim ở đáy: Quản trị (chỉ ADMIN; các mục con Tổng quan / Skeleton / Bài tập chỉ hiện khi đang ở `/admin/*`) · Cài đặt. Thanh điều hướng mobile: Home, Sàng lọc, Trẻ, Lịch sử, AI, Học (thay bằng "Tập" khi bài tập dùng được).

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
- **Hồ sơ trẻ (`/children`):** thẻ mỗi trẻ (tuổi, giới tính, số lần sàng lọc, lần gần nhất + mức, trạng thái đồng ý), tạo hồ sơ (`ChildForm`), thông báo sau khi xoá.
- **Dashboard theo trẻ (`/children/:id`):**
  - thông tin + sửa hồ sơ, trạng thái đồng ý, nút "Sàng lọc mới" (→ `/screening?childId=`);
  - ô chỉ số: số lần sàng lọc, số có kết quả, kết quả gần nhất;
  - **`GaitTrendChart`**: chọn chỉ số (chip, chỉ hiện chỉ số có dữ liệu), một đường màu thương hiệu, trục bắt đầu từ 0, điểm rỗng = video chất lượng thấp, nhãn trực tiếp ở lần gần nhất, crosshair + tooltip (chuột, chạm, phím mũi tên), chế độ **Bảng**, cảnh báo khi trộn góc quay; ghi rõ chưa có ngưỡng chuẩn và không dùng để tính mức;
  - danh sách lần sàng lọc (đánh số theo thời gian, mở xem `ScreeningResultView`, thử lại, xoá lượt); tự làm mới mỗi 4 giây khi có lượt đang phân tích;
  - vùng "Xoá hồ sơ và dữ liệu": phải gõ đúng tên trẻ mới bật nút xoá.
- **History:** trạng thái tiếng Việt, chi tiết dùng cùng `ScreeningResultView`, gửi/chạy lại phân tích, **lọc theo trẻ**, link "Hồ sơ trẻ", **xoá lượt sàng lọc**.
- **Admin:** thống kê, hàng đợi, thẻ sức khoẻ máy ML (cảnh báo nếu là bản cũ), lỗi kỹ thuật của lượt thất bại.
- **Auth:**
  - header Authorization được gắn **đồng bộ** khi login/logout/khởi động (sửa lỗi cũ: các request đầu tiên sau đăng nhập bị 401, bản production sẽ thấy danh sách trẻ trống);
  - interceptor 401 tự đăng xuất.
- **Đã gỡ:**
  - form login điền sẵn tài khoản demo;
  - lời gọi `GET /chat/models` (backend không có);
  - `BehaviorChart` (chỉ để vẽ 4 điểm giả).
- **Bài tập (Giai đoạn 4):** thư viện theo trẻ (đồng ý ghi hình riêng), trang tập với bạn Mầm, kết quả lượt tập, mục bài tập + biểu đồ tiến độ trên dashboard trẻ; Admin: danh sách bài, đồng bộ bài dựng sẵn, tạo mẫu từ video người lớn (cổng chất lượng, cắt đoạn), publish, thống kê, thử ghi hình (recorder probe). Chi tiết §6.7.
- **Bảng hỏi:** trang `/questionnaires` (chọn trẻ theo độ tuổi, kết quả gần nhất, nhắc Follow-Up còn dở), nhập theo phiếu (`entry`) hoặc hỏi từng câu (`inapp`: một câu mỗi màn hình, phím C/K, xem lại trước khi gửi), Follow-Up từng bước, trang kết quả, mục bảng hỏi trên dashboard trẻ, thẻ trạng thái ở Admin. Chi tiết §6.8.
- **Guide:** hướng dẫn quay dáng đi (6–10 giây, quay ngang, thấy bàn chân, một mình trẻ) và quyền riêng tư (thêm: quyền xoá từng lượt / cả hồ sơ, kể cả dữ liệu trên máy phân tích).

### 9.3 Design system (không đổi)

Theme "Duo" (xanh đậm `#166534`…), Nunito, lucide-react, class `btn-duo*`, `card-duo*`, `panel-duo`, `input-duo`, `link-duo`. Trang mới phải dùng `DashboardLayout`, `Card`, `UploadDropzone` (prop `accept` tuỳ chỉnh).

- Avatar trẻ dùng `ChildAvatar`: chữ cái đầu của tên gọi (từ cuối — tên trẻ thường bắt đầu bằng "Bé"), màu theo băm của cả tên.
- Ngày giờ dùng `lib/format.ts`: `formatDateTime` ("16:20 06/10/2026"), `formatBirthDate` (ngày sinh lưu UTC 00:00 nên định dạng theo UTC), `formatAge`.
- Biểu đồ: một chuỗi dùng màu `#166534` (đã chạy validator), lưới hairline `#E5E5E5`, luôn có tooltip + chế độ bảng; không dùng 2 trục y.

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

| Ngày                | Mốc                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2026-05-21/22        | Initial commit web ASDr +`API/` (OpenPose/ST-GCN, Llama).                                                                                                                                                                                                                                                                                                                                                                                            |
| 2026-05-23           | `research_src/` (ST-GCN, BiLSTM, SRM, fine-tune, Llama training).                                                                                                                                                                                                                                                                                                                                                                                    |
| 2026-07-13           | Gọi API thật trong`screeningProcessor`; gỡ proxy Llama, chat về mock.                                                                                                                                                                                                                                                                                                                                                                            |
| 2026-09-25           | Nộp đề cương AIMBRACE (AI for Life 2026).                                                                                                                                                                                                                                                                                                                                                                                                         |
| 2026-09-26           | Docker, migration`errorMessage`, theme xanh đậm + Lucide.                                                                                                                                                                                                                                                                                                                                                                                          |
| 2026-10-03           | `openposeService.ts`, router `/subjects`, `/pipeline`.                                                                                                                                                                                                                                                                                                                                                                                           |
| 2026-10-04           | Admin Skeleton (route + trang + ZIP/WebM).                                                                                                                                                                                                                                                                                                                                                                                                             |
| **2026-10-05** | **Giai đoạn 1–2**: bảo mật proxy ML, gỡ `/uploads` công khai, consent, hàng đợi bền vững, đặc trưng dáng đi + chất lượng video, sửa hiển thị điểm ASD, ML server 2.0 (API key, làm mờ mặt, `/health`, calibration, probe video), công cụ đánh giá/calibration, sửa `fine_tune.py`, Docker/compose, test tự động (77 test), áp migration mới lên DB chung. Người dùng đã commit (`09d23fe`). |
| **2026-10-06** | GPU đã sửa CUDA, lượt sàng lọc thật chạy xong trên GPU.**Giai đoạn 3** (chưa commit): CRUD hồ sơ trẻ, dashboard theo trẻ + biểu đồ xu hướng chỉ số dáng đi, xoá dữ liệu theo yêu cầu phụ huynh (DB + video + ML), lọc/xoá ở Lịch sử, gia cố worker, đổi tên UI sang AIMBRACE; 18 test mới (95 test tự động). Không đổi schema DB, không sửa `API/`.                                          |
| **2026-10-07** | **Giai đoạn 4** (chưa commit): thư viện bài tập + bạn Mầm + ghi webcam, chấm bắt chước imitation-v1, hàng đợi bài tập, Admin tạo mẫu, tiến độ trên dashboard. **Bảng hỏi M-CHAT-R/F**: nhập theo phiếu (đang bật `entry`) + hỏi trong app với Follow-Up tự động (chờ giấy phép). 2 migration chỉ-thêm đã áp lên DB chung. 331 test đơn vị + 40 test e2e. Không sửa `API/`.            |
| **2026-10-13/14** | DB chung mất kết nối sau khi máy chủ reboot (đã nối lại), sidebar gọn lại. **Bảng hỏi M-CHAT-R/F chạy trọn trong app** (20 câu + Follow-Up tự động; nội dung do chủ dự án điền), kiểm chứng trên màn hình thật; chỉ thử nội bộ, chưa có giấy phép (§19, §20). |

### 11.2 Tiến độ theo "Nội dung thực hiện" của đề cương

| Hạng mục                            | Việc                                                 | Trạng thái | Bằng chứng / ghi chú                                                                                                                                                                                                       |
| ------------------------------------- | ----------------------------------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **0. Khảo sát**               | ASD, skeleton action recognition, imitation           | 🟡           | 3 họ model đã thử; phần bắt chước chưa có.                                                                                                                                                                          |
| **1. Thu thập & xử lý**      | Video đi thẳng → skeleton                          | ✅           | OpenPose BODY_25 + probe fps/kích thước.                                                                                                                                                                                   |
|                                       | Ghi hoạt động khi tập bài tập                   | 🟡           | Webcam (MediaRecorder`.webm`) hoặc tải video → ML trích khung xương; chưa thử với ML thật (G0).                                                                                                                   |
|                                       | Lưu trữ riêng tư (che mặt, consent)              | 🟡           | Code xong: consent + làm mờ mặt + xoá video gốc +**xoá vĩnh viễn theo yêu cầu** (từng lượt / cả hồ sơ, kể cả trên ML). Chờ triển khai ML 2.0 và dọn video cũ (§12).                            |
|                                       | Tiền xử lý skeleton                                | ✅           | Như trước + theo dõi trẻ/chuẩn hoá cho đặc trưng dáng đi.                                                                                                                                                         |
| **2. AI sàng lọc**            | Huấn luyện + đánh giá                            | 🟡           | Công cụ split/calibrate/evaluate +`fine_tune.py` đã sửa; **chưa chạy trên dữ liệu thật**; số liệu cũ không hợp lệ.                                                                                   |
|                                       | Triển khai cloud                                     | 🟡           | Máy GPU qua ngrok, CUDA đã sửa (2026-10-06) nhưng vẫn chạy ML 1.0; ML 2.0 chưa deploy; Docker đã sửa nhưng chưa build thử.                                                                                      |
|                                       | Sàng lọc → kết quả                               | ✅           | Hàng đợi bền vững, retry, phục hồi; 3 mức theo ngưỡng (calibration nếu có); chỉ số dáng đi + chất lượng. Đã chạy end-to-end với ML 2.0 cục bộ và**với GPU thật (ML 1.0) ngày 2026-10-06**. |
|                                       | API                                                   | ✅           | Proxy ML chỉ ADMIN, ML có API key + kiểm tra subject_id.                                                                                                                                                                   |
| **3. Bài tập & bắt chước** | Thư viện bài tập, thu skeleton, so sánh          | 🟡           | 6 bài dựng sẵn + Admin tạo mẫu từ video người lớn; imitation-v1 (DTW góc khớp, soi gương, theo bộ phận); test tổng hợp + e2e; chưa hiệu chỉnh trên video thật (C1).                                     |
| **4. AI Agent**                 | RAG, hỏi đáp về trẻ, guardrail, nhân vật + S2S | ⬜/🟡        | Chat vẫn mock; guardrail mới ở mức system prompt Llama.                                                                                                                                                                   |
| **5. Cá nhân hóa**           |                                                       | ⬜           |                                                                                                                                                                                                                               |
| **6. Quản lý & theo dõi**    | Lưu skeleton/kết quả/lịch sử                     | ✅           | +`gaitFeatures`, `modelVersion`, ngưỡng, consent, job.                                                                                                                                                                  |
|                                       | Web theo dõi từng trẻ                              | ✅           | `/children` + `/children/:id`: CRUD hồ sơ, đồng ý, lịch sử từng trẻ, thử lại/xoá lượt, xoá hồ sơ.                                                                                                        |
|                                       | Bảng hỏi phụ huynh (M-CHAT-R/F, bổ sung)          | ✅           | Từ 2026-10-14 hỏi 20 câu + Follow-Up trong app (`inapp`), đã kiểm chứng trên màn hình thật (§20); chỉ thử nội bộ — đưa ra ngoài nhóm cần giấy phép tác giả (L1).                                                                                          |
|                                       | Xu hướng dài hạn                                  | 🟡           | Biểu đồ xu hướng 10 chỉ số dáng đi + biểu đồ điểm luyện tập theo từng bài (kèm bảng); chưa có dữ liệu thật.                                                                                          |
| **7. Chuyên gia**              |                                                       | ⬜           |                                                                                                                                                                                                                               |
| **Nền tảng**                  | Auth, role, knowledge, admin                          | ✅           | + sức khoẻ ML, hàng đợi.                                                                                                                                                                                                 |
|                                       | Test tự động                                       | ✅           | Backend 331 + e2e 40, ML server 18, research 29 (trước 05/10: 0).                                                                                                                                                           |
|                                       | Docker                                                | 🟡           | Đã sửa CMD/healthcheck/env/nginx/requirements; chưa build thử.                                                                                                                                                           |
|                                       | Đổi thương hiệu AIMBRACE                         | ✅           | Trên UI (2026-10-06); tên package/DB/localStorage vẫn là asdr.                                                                                                                                                            |

### 11.3 Ước lượng tổng quan (chủ quan)

| Khối                                                               | Trước 05/10      | Sau Giai đoạn 1–2                                            | Sau 06/10                                                        | Sau 07/10                                                                                            |
| ------------------------------------------------------------------- | ------------------ | --------------------------------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Nền tảng web (auth, hồ sơ, upload, lịch sử, knowledge, admin) | ~70%               | ~80%                                                            | ~85%                                                             | ~88%                                                                                                 |
| Pipeline skeleton + sàng lọc (F1, F2)                             | ~60%               | ~75% (thiếu: đánh giá mô hình thật, deploy ML mới, GPU) | ~78% (GPU đã chạy; còn deploy ML 2.0, đánh giá mô hình) | ~78% (không đổi) + bảng hỏi M-CHAT-R/F bổ sung (chờ giấy phép cho chế độ hỏi trong app) |
| Theo dõi + dashboard (F8, F9)                                      | ~25%               | ~30%                                                            | ~60% (thiếu điểm bài tập, xu hướng đa chỉ số)          | ~75% (có điểm bài tập, lịch sử bảng hỏi; thiếu dữ liệu thật)                            |
| AI Agent + nhân vật LLM (F5, F6)                                  | ~10%               | ~10%                                                            | ~10%                                                             | ~10%                                                                                                 |
| Bài tập + bắt chước + cá nhân hóa (F3, F4, F7)              | ~5%                | ~5%                                                             | ~5%                                                              | ~45% (F3/F4 xong code, chờ G0/C1; F7 chưa làm)                                                    |
| Kết nối chuyên gia (F10)                                         | 0%                 | 0%                                                              | 0%                                                               | 0%                                                                                                   |
| **Toàn đề cương**                                        | **~25–30%** | **~30–35%**                                              | **~38–42%**                                               | **~50–55%**                                                                                   |

Cập nhật 2026-10-14: bảng hỏi M-CHAT-R/F + Follow-Up chạy trong app (thử nội bộ); các tỉ lệ khác không đổi so với 07/10.

### 11.4 Trạng thái working tree và việc git cho người dùng

Agent không dùng git (quy định của chủ dự án). Giai đoạn 1–2 đã được người dùng commit (`09d23fe`). Thay đổi phiên 2026-10-06 (Giai đoạn 3, §17), 2026-10-07 (Giai đoạn 4 + bảng hỏi, §18), 2026-10-13 (§19) và 2026-10-14 (§20) nằm trong working tree, chưa commit. Khi muốn commit, người dùng tự chạy:

```bash
# Nếu chưa làm ở lần commit trước: gỡ khỏi git các file không được phép nằm trong repo (file vẫn còn trên ổ đĩa; đã có trong .gitignore)
git rm -r --cached API/storage API/__pycache__ API/services/__pycache__ backend/backend.log backend/response.json
git add -A
git status          # kiểm tra lại trước khi commit
```

- File `.pyc` trong `API/__pycache__` bị Python tạo lại khi chạy test (rác build).
- `backend/content/*.json` bị gitignore, trừ `mchat-rf.template.json` (chỉ có mã). Kiểm tra `git status` để chắc chắn `backend/content/mchat-rf.vi.json` (từ 2026-10-14 chứa toàn bộ phiếu) **không** bị add.
- Video trẻ vẫn còn trong **lịch sử git** cũ; xoá khỏi lịch sử (filter-repo) là quyết định của nhóm.

---

## 12. Vấn đề còn tồn tại (theo mức ưu tiên)

> Đã xử lý ngày 2026-10-06: lỗi CUDA trên máy GPU (người dùng sửa), `/children` không còn là trang sàng lọc. Ngày 2026-10-07: điểm bài tập đã có trên dashboard (Giai đoạn 3 "Còn"), body JSON hỏng trả 400 thay vì 500.

### P0

1. **ML server production vẫn là bản cũ 1.0.0:** không API key, không làm mờ, lưu video gốc, `subject_id` không kiểm tra, không trả fps. Cần triển khai các file trong "Thay đổi trong `API/`" (§13), đặt `ML_API_KEY` ở cả hai phía, `VIDEO_RETENTION=blurred`. Trước khi deploy, nội dung consent đã tự ghi rõ là máy phân tích "có thể lưu bản sao video gốc".
2. **Video cũ:**
   - `backend/uploads` còn ~58 video từ trước chính sách xoá: chạy `npm run privacy:purge-videos` để xem (dry-run), rồi `-- --yes` nếu đồng ý;
   - `API/storage` (4 video test) vẫn trong git nếu chưa chạy `git rm --cached` (§11.4).

### P1

3. **Hiệu năng mô hình chưa biết; ngưỡng chưa calibrate** (UI có ghi chú). Chạy `research_src/EVALUATION.md`, đặt `calibration.json` cạnh checkpoint.
4. **Lịch sử migration DB chung lệch repo** (§5.4).
5. **Chọn người không thống nhất:** ST-GCN trên ML chọn người theo confidence từng frame; đặc trưng dáng đi theo track trẻ đang đi. Với video nhiều người, mô hình có thể phân tích nhầm người lớn (đã có cảnh báo chất lượng).
6. **Chỉ số dáng đi:** chưa có chuẩn theo tuổi; nhón gót là thử nghiệm; quay chính diện chỉ có nhịp bước.
7. **Không biết fps khi trình duyệt không đọc được video và ML là bản 1.0** (`.avi`, có thể cả `.mov` HEVC trên Chrome/Windows): không tính được nhịp bước, thời gian bước, tốc độ, nên các lần quay đó không có điểm trên biểu đồ xu hướng. Gặp thật ngày 2026-10-06 (lượt `.avi` 245 frame: `fps: null`). Hết khi deploy ML 2.0 (probe bằng OpenCV). Phương án dự phòng: backend tự đọc header AVI/MP4.
8. **Bài tập chưa thử với ML thật (G0) và chưa hiệu chỉnh (C1):** imitation-v1 chỉ được kiểm bằng khung xương tổng hợp và ML giả. Giữ `EXERCISE_MODE=admin_only` cho tới khi chạy `npm run exercises:probe-ml` (video người lớn) và `npm run exercises:calibrate`. Chưa kiểm chứng trên trẻ em; điểm chỉ để khích lệ.
9. **Giấy phép M-CHAT-R/F (L1):** dùng điện tử cần tác giả cho phép. Từ 2026-10-14 chủ dự án quyết bật `inapp` (20 câu + Follow-Up) **chỉ để thử nội bộ**; trước khi đưa app cho người ngoài nhóm phải có thư cho phép và ghi vào `licenseRef` (hiện `chua co - chi thu noi bo`). Câu 13 bản 2025 có câu thăm dò không có trong bản tiếng Việt 2015; chủ dự án đã tự điền ô này — cần ghi lại nguồn.

### P2

10. Docker/compose chưa build thử (Docker Desktop không chạy lúc sửa); container ML không có OpenPose.
11. Job chạy trong process backend: nhiều instance thì an toàn (SKIP LOCKED) nhưng giới hạn GPU chỉ tính trong từng process.
12. JWT giữ role trong token: hạ quyền admin chỉ có hiệu lực khi token hết hạn.
13. **Xoá dữ liệu cần máy ML online:** khi ML không truy cập được, việc xoá bị từ chối (503 `ML_UNAVAILABLE`), không có gì bị xoá; phụ huynh phải thử lại sau. Chưa có hàng đợi xoá chạy nền. Subject do Admin Skeleton tạo không gắn với lượt sàng lọc nào nên không bị xoá theo trẻ.
14. **ML 1.0 và bài tập:** có thể không nhận `.webm` (ghi webcam → 415, phải tải MP4) và có thể bỏ qua `subject_id` (không tạo được mẫu từ video người lớn; subject lạ bị xoá và trả 502). Hết khi deploy ML 2.0 hoặc G0 cho kết quả tốt.

### P3

15. `state/auth.tsx` còn 2 lỗi ESLint có sẵn.
16. `RecentResultsCard` không tự làm mới sau khi có kết quả mới.
17. Thanh điều hướng mobile đã có "Trẻ" nhưng vẫn thiếu admin/guide/settings.
18. README frontend là template.
19. Biểu đồ xu hướng chỉ cảnh báo khi trộn góc quay (ngang/chính diện), chưa tách riêng theo góc quay; trục X theo thứ tự lần quay (không theo thời gian thực).
20. Lượt tập chỉ so sánh được trong cùng phiên bản mẫu; publish mẫu mới làm lượt đang mở trang tập cũ nhận 409 `TEMPLATE_OUTDATED` (frontend tải lại mẫu).
21. Bản nháp bảng hỏi lưu `sessionStorage` theo trẻ (mất khi đóng tab, có thể còn sau khi đăng xuất trong cùng tab).

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
- ~~sửa CUDA trên máy GPU~~ (xong 2026-10-06);
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

### Giai đoạn 3 — Theo dõi trẻ và dashboard (F8, F9) ✅ phần lớn (2026-10-06, chưa commit)

Xong:

- Trang hồ sơ trẻ thật: CRUD, xoá vĩnh viễn dữ liệu khi phụ huynh yêu cầu (từng lượt / cả hồ sơ; DB + video gốc + dữ liệu trên ML, §6.6).
- Dashboard theo trẻ: lịch sử sàng lọc, biểu đồ xu hướng chỉ số dáng đi (+ bảng), thử lại / xoá lượt.
- Lịch sử: lọc theo trẻ, xoá lượt.
- Đổi thương hiệu sang **AIMBRACE** ở UI (giữ `asdr_token`, DB `asdr`).

Còn:

- ~~điểm bài tập trên dashboard~~ (xong 2026-10-07, Giai đoạn 4);
- tách biểu đồ theo góc quay; trục thời gian thực khi trẻ có nhiều lần quay trải dài nhiều tháng;
- (tuỳ chọn) hàng đợi xoá nền khi máy ML offline (§12 P2.13).

**Thay đổi trong `API/` của Giai đoạn 3:** không có (chỉ dùng `DELETE /subjects/{id}` sẵn có ở cả ML 1.0 và 2.0).

### Giai đoạn 4 — Bài tập tương tác và đánh giá bắt chước (F3, F4) ✅ (code, 2026-10-07, chưa commit)

Xong (§6.7):

- Model `Exercise`, `ExerciseTemplate`, `ExerciseSession`, `SessionScore` (migration đã áp lên DB chung).
- 6 bài dựng sẵn; Admin tạo mẫu từ video người lớn (attestation, cổng chất lượng, cắt đoạn, version, publish).
- Nhân vật hướng dẫn **bạn Mầm** (vẽ từ khung xương mẫu), ghi webcam / tải video, chế độ cho bé.
- imitation-v1: chuẩn hoá, góc khớp, subsequence DTW, soi gương, điểm 0–100 + sao + phản hồi theo bộ phận.
- Hàng đợi bài tập bền vững; xoá video + subject ML sau khi chấm; consent riêng; xoá dữ liệu theo trẻ / theo lượt.
- Tiến độ theo từng bài trên dashboard trẻ.

Còn:

- G0 (thử với ML thật) và C1 (hiệu chỉnh với video người lớn) rồi mới bật `EXERCISE_MODE=on`;
- thử với trẻ thật (cần quy trình đồng ý của nhóm/GVHD);
- cá nhân hoá độ khó dựa trên điểm (Giai đoạn 6).

**Thay đổi trong `API/` của Giai đoạn 4:** không có (dùng `/subjects/extract`, keypoints, `DELETE /subjects/{id}` sẵn có).

### Bổ sung — Bảng hỏi phụ huynh M-CHAT-R/F ✅ (code, 2026-10-07, chưa commit)

Xong (§6.8): chấm điểm theo quy tắc đã công bố, kiểm tra tuổi, nhập theo phiếu chính thức (`entry`), hỏi trong app + engine Follow-Up bản 2025 (`inapp`, **đang bật từ 2026-10-14, chỉ thử nội bộ**), kết quả + tóm tắt cho bác sĩ + hướng dẫn, dashboard, Admin, xoá dữ liệu, tài liệu giấy phép.

Còn: gửi email xin phép (L1); khi được phép, điền file nội dung, `questionnaires:validate-content`, đặt `MCHAT_MODE=inapp`. Cập nhật 2026-10-13 (§19.3): phần 1 (20 câu) đã điền; Follow-Up **tạm hoãn** theo quyết định chủ dự án; câu 13 cần quyết định riêng. Cập nhật 2026-10-14 (§20): chủ dự án điền đủ Follow-Up (kể cả câu 13); Follow-Up trong app đã bật và kiểm chứng trên màn hình thật; chưa cần giấy phép vì chỉ thử nội bộ.

**Thay đổi trong `API/`:** không có.

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
   - xoá dữ liệu của trẻ / lượt sàng lọc / lượt tập / bảng hỏi qua `dataDeletion.ts` (không tự xoá dòng DB hay file ở chỗ khác);
   - chấm bắt chước qua `services/imitation/index.ts` (không sửa hằng số `IMITATION_V1`; muốn đổi thì tạo `algorithmVersion` mới);
   - hàng đợi bài tập qua `exerciseProcessor.ts`; khả năng của ML qua `mlCapabilities.ts`; helper route bài tập (`requireExercisesEnabled`, `findOwnedChild`, `loadProgressRows`) nằm trong `routes/exercises.ts`;
   - dữ liệu bài tập trả cho phụ huynh/admin qua `lib/exerciseSerializers.ts` (không lộ `filePath`, `mlSubjectId`, `lastError`, đặc trưng mẫu);
   - chấm M-CHAT-R/F qua `lib/questionnaires/mchatRf.ts`, tuổi qua `age.ts`, Follow-Up qua `followUpEngine.ts`, nội dung có giấy phép qua `mchatContent.ts`; văn bản kết quả qua `copy.ts`;
   - log lỗi qua `lib/errorLog.ts` (không log tên trẻ, tên file, nội dung body);
   - kiểm tra dữ liệu hồ sơ trẻ qua `lib/childInput.ts`;
   - dữ liệu trả cho phụ huynh qua `serializers.ts` (`serializeChild`, `serializeScreening`);
   - định nghĩa chỉ số dáng đi phía frontend qua `lib/gaitMetrics.ts` (dùng chung cho thẻ chỉ số và biểu đồ);
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
11. Không viết nội dung câu hỏi / ví dụ / hướng dẫn / Follow-Up của M-CHAT-R/F ở bất cứ đâu trong repo (§1.2.7); test dùng nội dung giả dạng `"[key.path]"`.
12. Khi bàn giao:
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
15. **Xoá hồ sơ / lượt sàng lọc trả 409 `SCREENING_IN_PROGRESS`:** có job đang `RUNNING` (hoặc vừa được worker nhận lại giữa chừng) → đợi phân tích xong rồi xoá lại.
16. **Xoá trả 503 `ML_UNAVAILABLE`:** máy ML không xoá được subject (tunnel ngrok chết — HTML 404, mạng, 5xx, sai `X-API-Key`). Không có gì bị xoá; chi tiết ở log backend `[data-deletion]`. Sửa kết nối ML rồi thử lại.
17. **Lượt có kết quả nhưng biểu đồ thiếu nhịp bước/tốc độ:** `gaitFeatures.quality.fps = null` (trình duyệt không đọc được thời lượng video, ML 1.0 không trả fps) — xem §12 P1.7.
18. **Python trên Windows và xuống dòng:** `Path.write_text` ghi CRLF; working copy của repo đang là CRLF (git `autocrlf`), giữ nguyên như vậy để tránh file lẫn hai kiểu xuống dòng.
19. **Lượt tập FAILED / INSUFFICIENT:** xem `lastError` ở Admin → Bài tập → hàng đợi. "ML không truy cập được" được thử lại (worker dò lại ML trước mỗi lần thử, không dùng cache cũ). INSUFFICIENT có lý do cụ thể (không thấy người, thiếu khớp, quá ngắn, nhiều người…) — không phải lỗi.
20. **Upload bài tập trả 415 `RECORDING_FORMAT_UNSUPPORTED`:** ML 1.0 không nhận `.webm` → tải MP4, hoặc chạy G0 rồi cân nhắc `EXERCISE_WEBM_AS_MKV=true`.
21. **Menu "Bài tập" không hiện với phụ huynh:** `EXERCISE_MODE` mặc định `admin_only` — đăng nhập admin hoặc đặt `on` sau C1. Menu "Bảng hỏi" không hiện: `MCHAT_MODE=off`.
22. **`inapp` vẫn chạy như `entry`:** file nội dung thiếu / sai cấu trúc → `npm run questionnaires:validate-content` (Admin → thẻ Bảng hỏi cũng báo trạng thái).
23. **Test e2e:** `npm run test:e2e` tự dựng PostgreSQL tạm :55432, backend :4100, ML giả :8100 và tự dọn; nếu bị ngắt giữa chừng, tắt tiến trình trên đúng các cổng đó (không đụng :4000/:5173) và `pg_ctl -D <Temp>/aimbrace-e2e-*/pgdata stop`.
24. **`Can't reach database server at 100.104.148.57:5433` dù log Postgres báo "ready to accept connections":** thường là sau khi máy chủ DB (`user-KHMT02`) khởi động lại. Kiểm tra theo thứ tự:

    - `tailscale ping 100.104.148.57` → máy có lên mạng không;
    - `Test-NetConnection 100.104.148.57 -Port 5433` → cổng có mở không;
    - trên máy chủ: `docker ps` (cột PORTS của `asdr-db` trống là lỗi) và `docker inspect asdr-db --format "{{json .NetworkSettings.Networks}}"` (`{}` = container không gắn network).

    Chữa: `docker network connect asdr-network asdr-db` (không cần restart Postgres). Chi tiết nguyên nhân: §19.1.
25. **`questionnaires:validate-content` báo `structureHash: does not match`:** cấu trúc trong `mchatRfStructure.ts` đã đổi (ví dụ 2026-10-13: câu không có ví dụ). Chạy `npm run questionnaires:content-template`, rồi sửa đúng trường `structureHash` trong `mchat-rf.vi.json` theo mã mới; nội dung đã điền giữ nguyên nếu các khoá không đổi.

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

| Hạng mục                                                                  | Kết quả                                                                                                                                                    |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Backend typecheck + test                                                    | sạch, 30/30                                                                                                                                                 |
| Frontend`tsc -b` + `vite build`                                         | sạch (ESLint: 2 lỗi có sẵn trong`state/auth.tsx`)                                                                                                      |
| ML server test (`API/tests`)                                              | 18/18                                                                                                                                                        |
| Research test (`research_src/tests`)                                      | 29/29                                                                                                                                                        |
| End-to-end UI với ML 2.0 cục bộ (OpenPose giả, checkpoint ngẫu nhiên) | consent → upload → hàng đợi → kết quả;`.mkv`/webm; History; Admin; Admin Skeleton (video dọc 1080×1920 không méo); ZIP 71 file, CSV 1675 dòng |
| Làm mờ mặt trên clip thật                                              | độ nét vùng đầu còn ~0,6% (67/67 frame), phần còn lại ~89%                                                                                         |
| Backend cuối cùng với DB thật                                           | khởi động sạch, worker không lỗi, cổng auth đúng                                                                                                    |
| Chưa kiểm chứng                                                          | build Docker; OpenPose thật với ML 2.0; server Llama; hiệu năng mô hình                                                                                |

### 16.3 Checklist việc cần làm (chủ dự án / nhóm)

- [X] Chạy lại dev: `cd backend && npm run dev`, `cd frontend && npm run dev -- --host 127.0.0.1`. *(người dùng, 2026-10-06)*
- [X] **Máy GPU:** sửa lỗi CUDA. *(người dùng, 2026-10-06 — đã có lượt thật chạy xong trên GPU; sau khi deploy ML 2.0 thì `/health` phải báo `cuda_available: true`, `openpose_available: true`)*
- [ ] **Triển khai ML 2.0** lên máy GPU: các file trong danh sách "Thay đổi trong `API/`" (§13), cài lại `requirements.txt`, đặt `ML_API_KEY` (ML) = `OPENPOSE_API_KEY` (`backend/.env`), `VIDEO_RETENTION=blurred`. Kiểm tra trang Admin → thẻ "Máy chủ phân tích" không còn cảnh báo "phiên bản cũ".
- [ ] Sau khi GPU chạy: vào Lịch sử, "Thử phân tích lại" lượt upload 10:34.
- [ ] **Git** (agent không chạy git): `git rm -r --cached API/storage API/__pycache__ API/services/__pycache__ backend/backend.log backend/response.json`, rồi `git add -A`, kiểm tra `git status`, commit. Cân nhắc xoá video trẻ khỏi lịch sử git (quyết định của nhóm).
- [ ] **Dọn video cũ:** `cd backend && npm run privacy:purge-videos` (xem trước), rồi `npm run privacy:purge-videos -- --yes`.
- [ ] **Đánh giá lại mô hình** trên máy GPU theo `research_src/EVALUATION.md` (split theo trẻ → fine-tune chọn theo val → predict → calibrate → evaluate test một lần); copy `calibration.json` (có `checkpoint_sha256`) cạnh checkpoint; chỉ báo cáo số liệu từ `test_results.json`.
- [ ] Thống nhất với nhóm việc baseline lịch sử migration của DB chung (§5.4); tuyệt đối không `migrate dev` trên DB chung.
- [ ] Build thử Docker khi có Docker Desktop (`DOCKER_DEPLOY.md`).
- [X] Bắt đầu Giai đoạn 3 (CRUD hồ sơ trẻ, dashboard theo trẻ với biểu đồ chỉ số dáng đi, đổi thương hiệu AIMBRACE). *(2026-10-06, §17)*

Các mục còn mở được chuyển sang checklist §17.3 (rồi §18.4).

---

## 17. Nhật ký phiên 2026-10-06 (GPU đã sửa, Giai đoạn 3) và checklist mới

### 17.1 Trạng thái kiểm tra đầu phiên (chỉ đọc)

- Máy ML qua ngrok **vẫn là bản 1.0.0** (`/health` → 404, `GET /` liệt kê route cũ; OpenAPI có `DELETE /subjects/{subject_id}`).
- GPU đã chạy: subject mới tạo hôm nay được trích xuất + dự đoán. Trong DB chung:
  - lượt 10:34 ngày 05/10 (`b9519c6e…`, file `2da8ce43…mp4` còn giữ): FAILED vì lỗi CUDA → **cần bấm "Thử phân tích lại"**;
  - lượt `.avi` lúc 15:38 ngày 06/10 (`d7523309…`): FAILED vì lỗi CUDA, là bản trùng của lượt `.avi` lúc 15:45 đã COMPLETED → có thể **xoá** bằng tính năng mới;
  - lượt 15:45 (`.avi`, 245 frame): COMPLETED, mức HIGH, `p_asd` 0,89, `calibrated: false`, **`fps: null`** (trình duyệt không đọc được AVI, ML 1.0 không trả fps) → không có nhịp bước/tốc độ; video gốc đã xoá;
  - lượt 15:46 (`.mp4` 2,1 giây, 64 frame): COMPLETED, LOW, chất lượng `fair` (video ngắn, < 4 bước); video gốc đã xoá.
- Agent không có quyền truy cập máy GPU (SSH bị chặn), nên **không** triển khai ML 2.0 và không chạy đánh giá mô hình.

### 17.2 Đã làm (Giai đoạn 3) và đã kiểm chứng

- **Backend:** route hồ sơ trẻ (danh sách kèm tóm tắt, chi tiết, sửa, xoá), xoá từng lượt, lọc lượt theo trẻ, dịch vụ `dataDeletion.ts` (§6.6), kiểm tra đầu vào `childInput.ts`, gia cố worker (không còn unhandled rejection; tự dọn file + subject ML nếu upload bị xoá giữa lúc phân tích; lỗi DB sau khi đã lưu kết quả không còn biến lượt thành FAILED).
- **Frontend:** `/children`, `/children/:id` (dashboard + `GaitTrendChart`), `ChildForm`, `ChildAvatar`, Lịch sử lọc theo trẻ / xoá / link hồ sơ (và tự chọn lại mục đầu khi lọc), `/screening?childId=`, thanh mobile có "Trẻ", định dạng ngày giờ thống nhất, đổi tên UI sang AIMBRACE, Guide/PrivacyCard ghi rõ quyền xoá dữ liệu.
- **Không đổi schema DB, không chạy migration, không sửa `API/`, không ghi dữ liệu nào vào DB chung.**

| Hạng mục                                                                                                                                 | Kết quả                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backend typecheck + test                                                                                                                   | sạch, 48/48 (18 test mới:`childInput`, `screeningData`)                                                                                                                                                                                                                                                                                                                                             |
| Frontend`tsc -b` + `vite build`                                                                                                        | sạch; ESLint chỉ còn 2 lỗi có sẵn trong`state/auth.tsx`                                                                                                                                                                                                                                                                                                                                           |
| ML server test / research test                                                                                                             | 18/18, 29/29                                                                                                                                                                                                                                                                                                                                                                                              |
| E2E API (PostgreSQL tạm :55432, ML 2.0 cục bộ với OpenPose giả + checkpoint ngẫu nhiên, người đi tổng hợp`syntheticGait.ts`) | 35/35 + 3/3 (ML tắt) + 3/3 (giả lập ngrok offline trả HTML 404) + 6/6 (xoá trẻ): validate, quyền sở hữu (404 cho tài khoản khác), consent, nhịp bước khớp đáp án tổng hợp (107 / 115 / 129 bước/phút), 409 khi job RUNNING, 503 khi ML không xoá được và không mất dữ liệu, DB/ML/file sạch sau khi xoá, worker không sập khi xoá thẳng DB giữa lúc phân tích |
| UI (trình duyệt tích hợp, desktop 1366×900 + mobile 375×812)                                                                         | danh sách trẻ, dashboard, biểu đồ (tooltip chuột/chạm, bàn phím, bảng, điểm rỗng cho video chất lượng thấp), sửa hồ sơ, chọn sẵn trẻ khi "Sàng lọc mới", xoá lượt (dashboard + Lịch sử), xoá hồ sơ (gõ tên xác nhận), trang chủ không lỗi console                                                                                                                |
| Chưa kiểm chứng                                                                                                                         | các route mới trên DB chung và với máy ML thật (cần đăng nhập tài khoản thật; agent không dùng dữ liệu thật để thử xoá)                                                                                                                                                                                                                                                            |

Môi trường thử (PostgreSQL tạm, ML cục bộ :8100, backend :4100, frontend :5175, thư mục Temp) đã dọn. Backend :4000 và frontend :5173 của chủ dự án vẫn chạy và đã tự nạp code mới (nodemon/HMR).

### 17.3 Checklist việc cần làm (thay cho §16.3; đã được thay bằng §18.4)

- [ ] Vào **Lịch sử** → lượt 10:34 ngày 05/10 → **"Thử phân tích lại"** (GPU đã chạy).
- [ ] Xoá lượt `.avi` FAILED lúc 15:38 ngày 06/10 (bản trùng) bằng nút **"Xoá lượt sàng lọc này"** — đây cũng là lần thử thật đầu tiên của tính năng xoá với ML 1.0 qua ngrok.
- [ ] **Triển khai ML 2.0** lên máy GPU (danh sách file ở §13 "Thay đổi trong `API/`"; Giai đoạn 3 không thêm file nào), cài lại `requirements.txt`, đặt `ML_API_KEY` (ML) = `OPENPOSE_API_KEY` (`backend/.env`), `VIDEO_RETENTION=blurred`. Sau đó trang Admin không còn cảnh báo "phiên bản cũ" và video `.avi` sẽ có fps.
- [ ] **Git** (agent không chạy git): kiểm tra `git status`; nếu chưa làm thì `git rm -r --cached API/storage API/__pycache__ API/services/__pycache__ backend/backend.log backend/response.json`; rồi `git add -A` và commit thay đổi Giai đoạn 3.
- [ ] **Dọn video cũ:** `cd backend && npm run privacy:purge-videos` (xem trước), rồi `npm run privacy:purge-videos -- --yes`.
- [ ] **Đánh giá lại mô hình** trên máy GPU theo `research_src/EVALUATION.md`; copy `calibration.json` (có `checkpoint_sha256`) cạnh checkpoint; chỉ báo cáo số liệu từ `test_results.json`.
- [ ] Thống nhất với nhóm việc baseline lịch sử migration của DB chung (§5.4); tuyệt đối không `migrate dev` trên DB chung.
- [ ] Build thử Docker khi có Docker Desktop (`DOCKER_DEPLOY.md`).
- [ ] Tiếp theo: **Giai đoạn 4** (bài tập tương tác + chấm điểm bắt chước) — điểm bài tập sẽ vào dashboard theo trẻ đã có.

---

## 18. Nhật ký phiên 2026-10-07 (Giai đoạn 4 + bảng hỏi M-CHAT-R/F) và checklist mới

### 18.1 Diễn biến

- Yêu cầu: làm Giai đoạn 4 (bài tập tương tác với nhân vật hướng dẫn **bạn Mầm**, chấm mức độ bắt chước, theo dõi tiến bộ), sau đó làm chức năng phụ: đánh giá qua **bảng hỏi phụ huynh M-CHAT-R/F**, là phần đánh giá bổ sung ngoài video.
- Cách làm: thiết kế + đặc tả trước, rồi chia gói (lõi imitation → backend bài tập → e2e → frontend bài tập; bảng hỏi: cấu trúc + chấm điểm → backend → frontend → e2e). Mỗi gói có review độc lập; 22 phát hiện của review đã được sửa hoặc ghi lại.
- Phiên bị ngắt hai lần (máy tắt, hết giới hạn phiên) và chạy tiếp từ trạng thái trên đĩa. Phần lõi chấm điểm được kiểm lại sau khi khởi động lại (230 test đạt tại thời điểm đó).
- Chủ dự án báo "chưa thấy bảng hỏi". Nguyên nhân: `MCHAT_MODE` mặc định `off` và DB chung chưa có migration. Theo lựa chọn của chủ dự án, agent đã:
  - áp 2 migration lên DB chung (§5.4);
  - đặt `MCHAT_MODE=entry` trong `backend/.env`;
  - thêm menu "Bảng hỏi" + trang `/questionnaires`;
  - nghiên cứu M-CHAT-R/F và làm xong chế độ hỏi trong app + Follow-Up (`inapp`, chờ giấy phép; `docs/MCHAT_PERMISSION.md`).
- Agent đã lỡ chạy lệnh git chỉ-đọc ở đầu phiên trước khi đọc quy định §14.1; đã ghi nhớ để không lặp lại.

### 18.2 Bug tìm thấy khi test và đã sửa

- Worker bài tập giữ trạng thái "ML không truy cập được" trong cache 60 giây nên lần thử lại cũng thất bại → giờ dò lại ML trước mỗi lần thử.
- Khi tắt bảng hỏi, route trả lời / quay lại Follow-Up trả sai mã → giờ 503 `QUESTIONNAIRE_DISABLED`; các GET đọc kết quả vẫn mở để phụ huynh xem và xoá dữ liệu cũ.
- Body JSON hỏng trả 500 → giờ 400 `INVALID_JSON` (không echo nội dung).
- Từ review:
  - ô "Khác" của câu 5 và 12 phải được tính;
  - view không còn lộ mã ví dụ (dùng `e<n>` theo vị trí);
  - nội dung đồng ý có thêm mục lưu câu trả lời Follow-Up;
  - nhãn trong lịch sử bảng hỏi;
  - giữ phím C/K không còn trả lời lặp;
  - cờ "cần xem lại" bị ẩn khi Follow-Up còn dở.
- Lint `ChildDetailPage` (set-state trong effect) → remount theo `key={id}`.

### 18.3 Kiểm chứng

| Hạng mục                                                                                                                      | Kết quả                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backend typecheck + test                                                                                                        | sạch, 331/331 (21 file)                                                                                                                                                                                                                                                                                       |
| E2E (`npm run test:e2e`: PostgreSQL tạm, ML giả bằng Node, nội dung M-CHAT giả dạng `"[key.path]"`)                   | 40/40: bài tập (upload, consent, hàng đợi, chấm, thử lại, xoá, quyền sở hữu, ML 1.0/2.0, ML offline), bảng hỏi`entry` (tuổi, chấm điểm, Follow-Up nhập tay, chế độ tắt chỉ đọc), bảng hỏi `inapp` 10/10                                                                        |
| Frontend`tsc -b` + `vite build`                                                                                             | sạch; ESLint chỉ còn 2 lỗi có sẵn trong`state/auth.tsx`                                                                                                                                                                                                                                                |
| UI: bảng hỏi trong app (trình duyệt tích hợp, môi trường tách biệt :4100/:5175, desktop 1366×900 + mobile 375×812) | một câu mỗi màn hình, phím C/K, xem lại; MODERATE → Follow-Up (PROMPT, ví dụ có "không chắc", bước làm rõ, ô Khác + ghi chú riêng tư, câu hỏi tần suất) → "khả năng cao – nên đánh giá phát triển sớm" + tóm tắt cho bác sĩ + hướng dẫn + disclaimer + bản quyền |
| UI: bài tập (cùng môi trường)                                                                                             | đồng ý ghi hình, thư viện, trang tập (bạn Mầm, checklist camera, cách tập, tốc độ), kết quả lượt tập (56/100, theo bộ phận, "video gốc: đã xoá"), dashboard trẻ (bảng hỏi: ngoài độ tuổi; bài tập: biểu đồ 56 → 100), mobile không tràn ngang                          |
| DB chung                                                                                                                        | 2 migration đã áp + resolve;`migrate diff` → "No difference detected"                                                                                                                                                                                                                                    |
| Chưa kiểm chứng                                                                                                              | bài tập với ML thật (G0); hiệu chỉnh (C1); ghi webcam thật (trình duyệt tích hợp không có camera); nội dung M-CHAT thật (chưa có giấy phép); các route mới với tài khoản thật trên DB chung                                                                                          |

Môi trường thử (PostgreSQL tạm :55432, ML giả :8100, backend :4100, frontend :5175, thư mục Temp) đã dọn. Backend :4000 và frontend :5173 của chủ dự án không bị đụng tới.

**Thay đổi trong `API/`:** không có.

### 18.4 Checklist việc cần làm (thay cho §17.3; đã được thay bằng §19.5)

- [ ] **Git** (agent không chạy git): `git status`; kiểm tra `backend/content/mchat-rf.vi.json` và `.env` **không** nằm trong danh sách add; nếu chưa làm thì `git rm -r --cached API/storage API/__pycache__ API/services/__pycache__ backend/backend.log backend/response.json`; rồi `git add -A` và commit Giai đoạn 3 + 4 + bảng hỏi.
- [ ] **Khởi động lại backend** :4000 nếu nodemon chưa tự nạp `MCHAT_MODE=entry` (biến `.env` chỉ đọc lúc khởi động). Sau đó thấy menu "Bảng hỏi".
- [ ] **G0:** `cd backend && npm run exercises:probe-ml -- <video người lớn giơ tay phải>` với ML thật (thử thêm một file `.webm` từ Chrome với `--as-mkv`). Cần `rightWristMoves: true`, `subjectIdHonoured: true`.
- [ ] **C1:** quay ≥ 3 người lớn (đúng / nửa biên độ / động tác khác / đứng yên) cho mỗi bài, để **ngoài repo**, rồi `npm run exercises:calibrate -- <thư mục>`. Đạt thì đặt `EXERCISE_MODE=on`; đến lúc đó phụ huynh chưa thấy "Bài tập" (admin vẫn thấy).
- [ ] Admin → Bài tập (Admin) → "Đồng bộ bài mẫu tổng hợp", rồi mở từng bài và "Xuất bản" bài muốn dùng (agent không ghi dữ liệu nào vào DB chung nên ở đó chưa có bài tập).
- [ ] **L1:** gửi email xin phép M-CHAT-R/F (bản nháp ở `docs/MCHAT_PERMISSION.md` §5). Khi được phép: `npm run questionnaires:content-template` → điền `content/mchat-rf.vi.json` nguyên văn bản tiếng Việt chính thức → `npm run questionnaires:validate-content` (phải `ready`) → `MCHAT_MODE=inapp`.
- [ ] Từ §17.3 (vẫn mở): "Thử phân tích lại" lượt 10:34 ngày 05/10; xoá lượt `.avi` trùng lúc 15:38 ngày 06/10; **triển khai ML 2.0** (danh sách file §13, Giai đoạn 4 không thêm file nào); dọn video cũ (`npm run privacy:purge-videos`); đánh giá lại mô hình (`research_src/EVALUATION.md`); thống nhất baseline migration DB chung; build thử Docker.
- [ ] Tiếp theo: **Giai đoạn 5** (AI Agent có nguồn, nhân vật LLM) hoặc **Giai đoạn 6** (cá nhân hoá độ khó / tốc độ bài tập dựa trên điểm luyện tập đã có).

## 19. Nhật ký phiên 2026-10-13 (DB chung, sidebar, nội dung M-CHAT phần 1) và checklist mới

### 19.1 DB chung mất kết nối

- Triệu chứng: backend báo `Can't reach database server at 100.104.148.57:5433` (từ `recoverStaleSessions` trong `exerciseProcessor.ts`), dù log Postgres trên máy chủ báo "ready to accept connections".
- Kiểm tra (chỉ đọc):
  - Tailscale ổn: ping 23 ms, cổng 22 mở.
  - Cổng 5433 đóng.
- Nguyên nhân:
  - Container `asdr-db` trên máy `user-KHMT02` được tạo bằng `docker run` ngày 03/10, không phải bằng compose. Cổng của nó gắn cứng vào IP Tailscale (`100.104.148.57:5433->5432`).
  - Máy chủ reboot lúc 10:07 ngày 08/10. dockerd khởi động trước khi `tailscale0` có IP → `failed to bind host port 100.104.148.57:5433/tcp: cannot assign requested address` → container không start, DB chết từ 08/10.
  - 21:34 ngày 13/10 có người `docker start` lại. Postgres chạy, nhưng container không gắn network nào (`NetworkSettings.Networks = {}`, chỉ có `lo`), nên cổng vẫn đóng.
- Chữa: `docker network connect asdr-network asdr-db` trên máy chủ (SSH `user@100.104.148.57`, key `~/.ssh/id_ed25519_khmt02` trên máy dev).
  - Agent bị chặn chạy lệnh ghi trên máy chủ, nên chủ dự án tự chạy.
  - Sau đó app đăng nhập và tải dữ liệu từ DB chung bình thường.
- Chưa làm (cần sudo trên máy chủ): chống tái diễn bằng `net.ipv4.ip_nonlocal_bind=1` trong `/etc/sysctl.d/99-tailscale-bind.conf`. Thiết lập này cho Docker bind IP Tailscale trước khi IP xuất hiện. Không làm thì lần reboot sau sẽ hỏng y như vậy (§15 mục 24).

### 19.2 Sidebar gọn lại (`frontend/src/components/Sidebar.tsx`)

- Trước: 13 mục phẳng, 3 mục admin trộn với mục phụ huynh, "Skeleton" dùng chung icon với "Sàng lọc", chữ in hoa đậm.
- Sau:
  - Nhóm chính: Trang chủ · Hồ sơ trẻ · Sàng lọc · Bảng hỏi · Bài tập · Lịch sử.
  - Nhóm hỗ trợ: Trợ lý AI · Kiến thức · Hướng dẫn.
  - Ghim ở đáy: Quản trị · Cài đặt.
- "Quản trị" (chỉ ADMIN) gộp 3 mục admin cũ. Các mục con Tổng quan / Skeleton / Bài tập chỉ hiện khi đang ở `/admin/*`, nên mọi trang admin vẫn có đường vào.
- Đổi thứ tự: Hồ sơ trẻ lên thứ 2 (tạo hồ sơ trước, sàng lọc sau); Lịch sử xuống cuối nhóm chính.
- Kiểu chữ: bỏ in hoa toàn bộ, chữ nhẹ hơn; mục đang chọn chỉ còn nền xanh nhạt (bỏ viền `shadow-ring-green`).
- Không đổi: điều kiện hiện "Bảng hỏi" / "Bài tập", route, thanh điều hướng mobile (`DashboardLayout.tsx`).

### 19.3 M-CHAT-R/F: nội dung phần 1, Follow-Up tạm hoãn

- Chủ dự án muốn màn bảng hỏi hiện câu hỏi như PDF CCIHP 2015.
  - Agent không chép nội dung phiếu, vì bản quyền và §14.11; chủ dự án hỏi lại và agent vẫn từ chối.
  - Chủ dự án tự điền 20 câu phần 1 (`stage1.*`).
- Sự cố: nội dung được điền vào `content/mchat-rf.template.json`, file duy nhất trong thư mục **không** bị gitignore.
  - Agent đã chuyển nguyên file sang `content/mchat-rf.vi.json` (gitignore) và tạo lại template trống. Template hiện chỉ có mã.
  - Khi commit vẫn phải kiểm tra lại (§19.5).
- Sửa cấu trúc (`mchatRfStructure.ts`):
  - Câu 2, 11, 13, 14, 16 trên phiếu không có ví dụ, nên `hasExamples=false` (hằng `WITHOUT_EXAMPLES`). Trước đó cả 20 câu bị đánh dấu có ví dụ, khiến file nội dung đúng vẫn bị báo thiếu.
  - Mã cấu trúc đổi `1f2a2762894d3770` → `ee0604d6660a38d0`. Snapshot trong `test/mchatRfStructure.test.ts` đã cập nhật, template đã tạo lại, trường `structureHash` trong `mchat-rf.vi.json` đã sửa theo (không đụng nội dung).
  - Chưa có câu trả lời `IN_APP` nào, nên đổi mã không ảnh hưởng dữ liệu đã lưu.
  - `content/README.md`: sửa dòng "examples bắt buộc cho mọi câu".
- Trạng thái file nội dung (`npm run questionnaires:validate-content` → `invalid`; app vẫn chạy `entry`):
  - Đủ: `stage1` (20 câu).
  - Trống:
    - 4 metadata: `contentVersion`, `licenseRef`, `translationSource`, `copyrightNotice`;
    - 8 ô `ui.*`;
    - toàn bộ `followUp.*` (khoảng 207 ô, trang 6–28 của PDF).
- **Follow-Up: tạm hoãn theo quyết định chủ dự án (13/10).** Các phương án đã bàn:
  1. **Bật trước phần 1 trong app — ĐÃ LÀM (13/10, sau khi chủ dự án hỏi "sao vẫn chưa có câu hỏi").** Hiện 20 câu có chữ (màn `InAppQuestionnaire` sẵn có: mỗi màn một câu); Follow-Up vẫn nhập tay theo kết quả làm cùng nhân viên y tế.
     - Backend:
       - `mchatContent.ts`: `validateContent` có thêm `stage1Ok`, `ContentStatus` có thêm `stage1Ready`; hàm mới `getStage1Content`. "Phần 1 sẵn sàng" = không lỗi cấu trúc và mọi ô trống đều thuộc `followUp.*` hoặc `ui.yes/no/maybe/maybePrompt/mostOftenPrompt/otherDescribe/followUpInstructions`.
       - `routes/questionnaires.ts`: `GET /questionnaires`, `GET /questionnaires/content` và `POST` mode `IN_APP` dùng `stage1Content()`. Follow-Up tự động (khởi tạo `followUpAnswers`, các route `/follow-up` in-app, cờ `followUp.inAppAvailable`) vẫn đòi file đầy đủ. `GET /questionnaires` trả thêm `inApp.followUpAvailable`.
       - Admin status trả thêm `content.stage1Ready`; `questionnaires:validate-content` in dòng `Stage 1 in app`.
     - Frontend:
       - `InAppQuestionnaire`: sau khi gửi, chỉ vào `/follow-up` khi `canTakeFollowUpInApp(response)`; không thì về trang kết quả, nơi có ô nhập Follow-Up làm cùng nhân viên y tế.
       - Thẻ Admin → Bảng hỏi báo "phần 1 đang hỏi trong app".
     - `backend/.env`: `MCHAT_MODE=inapp`. Agent đã điền `contentVersion` (`ccihp-2015-vi`) và `translationSource` (`CCIHP 2015, mchatscreen.com`).
     - Chủ dự án đã dán `ui.stage1Instructions` và `copyrightNotice` (validator không báo lỗi). Đã `rs` backend nên `MCHAT_MODE=inapp` đang chạy.
     - **Còn thiếu đúng 1 ô `licenseRef`**, nên validate báo `Stage 1 in app: not ready` và trang vẫn hiện lưới nhập theo số câu.
     - Ghi gì vào `licenseRef` là quyết định của chủ dự án. Agent đã nêu 2 cách:
       - có thư cho phép thì ghi ngày hoặc mã thư;
       - chưa có thì ghi đúng sự thật, ví dụ `chua co - chi thu noi bo`. Giá trị này hiện ở trang Admin.
     - Agent **không** tự điền ô này và **không** gỡ chốt chặn.
  2. **Điền đủ Follow-Up.** Agent làm bảng Excel chỉ vị trí từng ô trong PDF (trang / cột / thứ tự, không chép chữ) + lệnh nhập ngược vào JSON; chủ dự án dán nội dung.
  3. **Câu 13** (chặn mọi phương án có Follow-Up tự động).
     - Cấu trúc bản 2025 có node `followUp.13.nodes.q1` (câu thăm dò) không có trong bản tiếng Việt 2015, nên validator không bao giờ `ready`.
     - Hướng xử lý: chỉnh sơ đồ câu 13 theo bản 2015 (đổi logic, chờ chủ dự án quyết), hoặc xin tác giả bản dịch. Không tự dịch.
- Giấy phép (L1) vẫn mở: trang 6 của PDF ghi dùng trong sản phẩm điện tử cần cô Diana L. Robins đồng ý qua email; `licenseRef` còn trống.

### 19.4 Kiểm chứng

| Hạng mục                                                                                          | Kết quả                                                                                                                                                                                                                               |
| --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backend`npm test` + `tsc --noEmit`                                                              | 331/331 sau khi đổi mã cấu trúc; 334/334 sau khi thêm "phần 1 sẵn sàng" (3 ca mới trong`mchatContent.test.ts`); sạch                                                                                                       |
| Backend`npm run test:e2e` (PostgreSQL tạm)                                                       | 40/40 sau khi đổi mã cấu trúc; 41/41 sau khi thêm ca`9b` (chỉ phần 1: hỏi trong app, MODERATE không tự vào Follow-Up, nhập tay hoàn tất → REFER) và cập nhật ca 8 (`stage1Ready`); dọn sạch môi trường tạm |
| Frontend`tsc -b` + ESLint `Sidebar.tsx`                                                         | sạch                                                                                                                                                                                                                                   |
| UI sidebar (trình duyệt tích hợp, :5173 của chủ dự án, tài khoản seed admin + phụ huynh) | 1366×768, 1366×657, 768×1024. Phụ huynh: 9 mục, không cuộn. Admin trong`/admin/*` ở chiều cao 657 px phải cuộn khoảng 40 px mới thấy Cài đặt; mục con đánh dấu đúng (vd. `/admin/exercises` → "Bài tập")  |
| `questionnaires:validate-content`                                                                 | phần`stage1` không còn lỗi; tổng thể `invalid` vì metadata / `ui` / `followUp` trống                                                                                                                                    |
| Frontend sau khi thêm "phần 1 sẵn sàng"                                                         | `tsc -b` + ESLint các file sửa: sạch                                                                                                                                                                                               |
| Chưa kiểm chứng                                                                                  | màn hỏi 20 câu với nội dung thật trên :5173 (còn 3 ô chưa điền, backend :4000 chưa khởi động lại); thẻ Admin mới; chống tái diễn lỗi DB sau reboot                                                               |

**Thay đổi trong `API/`:** không có.

**Agent vi phạm quy định trong phiên này:**

- Chạy lệnh git chỉ-đọc (`git status`, `git log`, `git diff --stat`, `git check-ignore`) trước khi đọc §14.1. Đây là lần thứ hai (lần đầu: §18.1).
- In dòng `DATABASE_URL` (có mật khẩu DB chung) ra output công cụ khi đọc `backend/.env` (§14.7). Không đưa vào câu trả lời hay file nào.

### 19.5 Checklist việc cần làm (thay cho §18.4)

- [ ] **Git** (agent không chạy git): trước khi commit, `git status` phải cho thấy `backend/content/mchat-rf.template.json` chỉ có mã (mọi chữ rỗng) và `backend/content/mchat-rf.vi.json` **không** nằm trong danh sách add. Các việc git của §18.4 vẫn mở: `git rm -r --cached API/storage API/__pycache__ API/services/__pycache__ backend/backend.log backend/response.json`, rồi commit Giai đoạn 3 + 4 + bảng hỏi + phiên này.
- [ ] **DB chung, chống tái diễn** (cần sudo trên `user-KHMT02`): `echo net.ipv4.ip_nonlocal_bind=1 | sudo tee /etc/sysctl.d/99-tailscale-bind.conf && sudo sysctl --system`.
- [ ] **M-CHAT phần 1 trong app:** điền `licenseRef` trong `backend/content/mchat-rf.vi.json` (2 ô kia đã xong).
  - `npm run questionnaires:validate-content` phải in `Stage 1 in app: ready`.
  - Không cần `rs`: loader tự đọc lại khi file đổi mtime/size.
  - Tải lại trang bảng hỏi (F5; bỏ `?mode=paper` nếu có).
- [ ] **M-CHAT Follow-Up (tạm hoãn):** phương án 2 ở §19.3 khi muốn Follow-Up tự động, và quyết định cách xử lý câu 13.
- [ ] **L1:** gửi email xin phép M-CHAT-R/F (bản nháp ở `docs/MCHAT_PERMISSION.md` §5); khi được phép, ghi `licenseRef`.
- [ ] Từ §18.4 (vẫn mở):
  - **G0:** probe ML thật (`npm run exercises:probe-ml`).
  - **C1:** quay mẫu hiệu chỉnh, rồi `EXERCISE_MODE=on`.
  - Admin → Bài tập: "Đồng bộ bài mẫu tổng hợp" + "Xuất bản".
  - Các việc của §17.3: thử phân tích lại lượt 10:34 ngày 05/10; xoá lượt `.avi` trùng; triển khai ML 2.0; dọn video cũ; đánh giá lại mô hình; thống nhất baseline migration DB chung; build thử Docker.
- [ ] Tiếp theo: **Giai đoạn 5** (AI Agent có nguồn, nhân vật LLM) hoặc **Giai đoạn 6** (cá nhân hoá bài tập).

### 19.6 Bàn giao cho chat mới (dừng phiên lúc 00h ngày 2026-10-14)

**Đọc trước khi làm bất cứ việc gì:**

- §14: không git, kể cả lệnh chỉ đọc; không in `.env`; không viết nội dung M-CHAT vào repo.
- §19.3 → §19.5.

**Trạng thái các mạch việc:**

| Mạch                                        | Trạng thái                                                                        | Việc tiếp theo                                                                                                                                                                                                                                                                                                                                                                                         |
| -------------------------------------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DB chung (`asdr-db` trên `user-KHMT02`) | Đang chạy (đã`docker network connect`). Chưa chống tái diễn               | Chủ dự án chạy lệnh sysctl ở §19.5 (cần sudo). Nếu lại báo "Can't reach database server" → §15 mục 24                                                                                                                                                                                                                                                                                      |
| Sidebar                                      | Xong, đã xem trên màn hình                                                     | Không còn việc                                                                                                                                                                                                                                                                                                                                                                                        |
| M-CHAT phần 1 trong app                     | Code xong, test xanh (334 unit, 41 e2e). File nội dung thiếu đúng`licenseRef` | Khi chủ dự án báo đã điền: chạy`questionnaires:validate-content` (chỉ in tên ô), rồi **mở màn hình thật** để kiểm tra. Đăng nhập tài khoản seed phụ huynh (`backend/prisma/seed.ts`), vào bảng hỏi của trẻ 16–30 tháng: 20 câu có chữ, gửi thử 1 lượt mức trung bình → về trang kết quả có ô nhập Follow-Up. Xem cả thẻ Admin → Bảng hỏi |
| M-CHAT Follow-Up                             | **Tạm hoãn** theo quyết định chủ dự án                                | Khi làm lại: phương án 2 ở §19.3 (bảng Excel chỉ vị trí + lệnh nhập ngược) và quyết định câu 13                                                                                                                                                                                                                                                                                      |
| Git                                          | Chưa commit gì từ 07/10                                                          | Chủ dự án tự commit theo §19.5. Kiểm tra`mchat-rf.template.json` chỉ có mã, và `mchat-rf.vi.json` không bị add                                                                                                                                                                                                                                                                           |

**Không được làm:**

- Chép, đọc to hay in nội dung câu hỏi / ví dụ / hướng dẫn M-CHAT ra chat hay vào file trong repo. Kiểm tra file nội dung chỉ bằng validator hoặc script in tên ô và độ dài.
- Tự điền `licenseRef`.
- Chạy lệnh ghi trên máy chủ DB. Đưa lệnh cho chủ dự án tự chạy.
- Khởi động lại backend :4000 / frontend :5173 của chủ dự án.

---

## 20. Nhật ký phiên 2026-10-14 (M-CHAT-R/F: bật và kiểm chứng Follow-Up trong app) và checklist mới

### 20.1 Diễn biến

- Chủ dự án nhờ kiểm tra bảng hỏi M-CHAT. Từ lúc bàn giao §19.6, file duy nhất thay đổi là `backend/content/mchat-rf.vi.json` (13:19 ngày 14/10). Chủ dự án đã điền đủ:
  - `licenseRef` = `chua co - chi thu noi bo`;
  - toàn bộ `followUp.*`, kể cả ô câu 13 (`followUp.13.nodes.q1.text`; §19.3 ghi bản 2015 không có nút này — nguồn chữ do chủ dự án nắm).
- File đủ (`State: ready`) + `MCHAT_MODE=inapp` → Follow-Up tự động trong app **tự bật**, không cần sửa backend.
- Chủ dự án quyết (14/10): **hoàn thành bảng hỏi kèm Follow-Up; app chỉ thử nội bộ nên chưa cần giấy phép.** L1 vẫn phải xong trước khi đưa app ra ngoài nhóm.
- Agent: kiểm chứng trên màn hình thật bằng 3 lượt thử (đã xoá), sửa 1 lỗi frontend, cập nhật §6.1 (dòng `MCHAT_MODE`), §6.8, §13.

### 20.2 Sửa

- `frontend/src/lib/questionnaires.ts`: `normalizeQuestionnaires` bỏ mất `inApp.followUpAvailable` khi chuẩn hoá `GET /questionnaires` → thêm lại.
- `frontend/src/pages/QuestionnairesPage.tsx`: câu giới thiệu chỉ có cụm "và phần hỏi thêm" khi `inApp.followUpAvailable`. Trước đó cụm này hiện mỗi khi file đủ phần 1, kể cả lúc Follow-Up chưa làm được trong app.

### 20.3 Kiểm chứng

| Hạng mục | Kết quả |
| --- | --- |
| `questionnaires:validate-content` | `State: ready`, `Stage 1 in app: ready`, 0 lỗi, mã cấu trúc `ee0604d6660a38d0` |
| Rà file nội dung (script chỉ in tên ô và độ dài) | 287 ô chữ. Trống đúng 5 ô `stage1.{2,11,13,14,16}.examples` (thiết kế). Không có ô điền tạm, không lỗi mã hoá, không Unicode NFD; câu dẫn các danh sách không trùng ghi chú. `stage1.19.text`, `stage1.20.text` có khoảng trắng đầu/cuối (không ảnh hưởng hiển thị) |
| Backend `npm test` + `npm run typecheck` | 334/334; sạch (phiên này không sửa backend) |
| Backend `npm run test:e2e` | 41/41; dọn sạch |
| Frontend `tsc -b` + ESLint 2 file sửa | sạch |
| Màn hình thật — phần 1 (:5173, phụ huynh seed, Bé An 28 tháng, DB chung) | 20 câu đều có chữ, đúng 5 câu không có ví dụ, phím C/K, màn "Xem lại và gửi" |
| Màn hình thật — Follow-Up: 3 lượt thử cho Bé An, **đã xoá** bằng API xoá của app | **Lượt 1** trượt {1, 2, 5, 6, 7, 13, 14}, đi bằng giao diện: câu mở, ví dụ từng dòng, "thường xuyên hơn" (câu 1), phần phụ câu 2 (Có/Không + lựa chọn), ô "Khác" có mô tả (câu 5 → cờ cần xem lại), "Không chắc" → màn "thường là Có hay Không", lời dẫn sau câu 6 ở câu 7, lựa chọn câu 7, câu 13, đếm + tần suất câu 14. Điểm đúng theo nhánh; còn 3 mục → "Khả năng cao"; tóm tắt bác sĩ có "Mục cần xem lại: câu 5". **Lượt 2** trượt {3, 4, 8, 9, 10, 11, 12}: điểm đúng (3, 9, 10, 12 còn 1; câu 3 có cờ) → REFER; nhật ký từng bước bị mất vì công cụ hết giờ, chỉ còn điểm. **Lượt 3** trượt {15–20}: câu 18 dừng ở "Có" đầu tiên, "Không chắc" ở câu 19; còn 1 mục → "Khả năng thấp sau phần hỏi thêm". Ở mọi bước đã ghi nhật ký, chữ server trả về đều hiện trên màn (so khớp tự động, không in chữ) |
| `/questionnaires` sau khi sửa | câu giới thiệu có "và phần hỏi thêm" (`followUpAvailable=true`) |
| Chưa kiểm chứng | bố cục Follow-Up trên mobile; thẻ Admin → Bảng hỏi trên giao diện (chỉ xem qua API: `ready`); nút "Tạm dừng, làm tiếp sau" / "Quay lại" trên màn thật (e2e đã phủ) |

### 20.4 Đã xử lý theo yêu cầu chủ dự án (14/10)

1. **Đã ẩn chữ dành cho người phỏng vấn khỏi giao diện phụ huynh:**
   - `frontend/src/pages/QuestionnaireFollowUpPage.tsx`: bỏ hiển thị khối `instructions` (`ui.followUpInstructions`) trong màn giới thiệu Follow-Up (`Intro`), giữ nguyên 3 dòng hướng dẫn thân thiện và xúc tích cho phụ huynh (`FOLLOW_UP_WHY`, thời lượng, tiếp tục làm sau).
   - `frontend/src/components/questionnaire/FollowUpStepView.tsx`: ẩn thẻ `<Text size="sm">{step.note}</Text>` ở các bước câu hỏi mở (`PROMPT`), giúp phụ huynh chỉ đọc câu hỏi gợi mở và bấm "Tiếp tục" mà không bị phân tâm bởi lời dặn dò nghiệp vụ của nhân viên y tế.
2. **Đã cập nhật highlight Sidebar (`Sidebar.tsx`):**
   - Hỗ trợ hàm `isActive: (pathname: string) => boolean` trên từng `NavItem`.
   - Mục **"Bảng hỏi"** tự động sáng khi ở `/questionnaires`, `/questionnaire-responses/*` (làm Follow-Up hoặc xem kết quả) và `/children/:id/questionnaires/*` (đang trả lời 20 câu M-CHAT).
   - Mục **"Hồ sơ trẻ"** sáng khi ở `/children` hoặc xem chi tiết `/children/:id` (không bị trùng sáng khi đang trả lời bảng hỏi).
   - Mục **"Bài tập"** sáng khi ở `/exercises` hoặc xem kết quả lượt tập `/exercise-sessions/:id`.
3. Dòng bản quyền hiện 2 lần trên mỗi màn (đầu trang + cuối thẻ): do thiết kế "bắt buộc trên mọi màn" (`CopyrightLine.tsx`), để nguyên.

**Kiểm chứng:** Frontend `tsc -b && vite build` sạch trong 5.6s; `eslint` trên 3 file đã sửa: 0 cảnh báo/0 lỗi; Backend unit tests: 334/334 pass.

**Thay đổi trong `API/`:** không có.

**Lưu ý quy định:** không chạy git, không đọc `.env`.

### 20.5 Checklist việc cần làm (cập nhật sau khi xong nhóm A)

- [ ] **Git** (agent không chạy git): trước khi commit, `git status` phải cho thấy `backend/content/mchat-rf.template.json` chỉ có mã và `backend/content/mchat-rf.vi.json` (nay chứa toàn bộ phiếu) **không** nằm trong danh sách add. Còn từ §18.4: `git rm -r --cached API/storage API/__pycache__ API/services/__pycache__ backend/backend.log backend/response.json`, rồi commit Giai đoạn 3 + 4 + bảng hỏi + phiên 13/10 + các file frontend đã sửa.
- [ ] **L1, trước khi đưa app ra ngoài nhóm:** gửi email xin phép (bản nháp `docs/MCHAT_PERMISSION.md` §5); có phép thì sửa `licenseRef`. Ghi lại nguồn chữ câu 13.
- [ ] **DB chung, chống tái diễn** (cần sudo trên `user-KHMT02`): `echo net.ipv4.ip_nonlocal_bind=1 | sudo tee /etc/sysctl.d/99-tailscale-bind.conf && sudo sysctl --system`.
- [ ] Từ §18.4 / §17.3 (vẫn mở): G0 (`npm run exercises:probe-ml`), C1 + `EXERCISE_MODE=on`, Admin → Bài tập (đồng bộ + xuất bản), các việc §17.3 (deploy ML 2.0, đánh giá lại mô hình ST-GCN).
- [ ] Tiếp theo: **Giai đoạn 5** (AI Agent có nguồn, nhân vật LLM) hoặc **Giai đoạn 6** (cá nhân hoá bài tập).

### 20.6 Bàn giao cho chat mới

**Đọc trước khi làm bất cứ việc gì:**

- §14: không git, kể cả lệnh chỉ đọc; không in `.env`; không viết nội dung M-CHAT vào repo.
- §20.

**Trạng thái các mạch việc:**

| Mạch | Trạng thái | Việc tiếp theo |
| --- | --- | --- |
| M-CHAT-R/F UI & Sidebar | Đã xong (ẩn chữ phỏng vấn, sidebar sáng đúng route bảng hỏi và bài tập) | Sẵn sàng sử dụng |
| Giấy phép L1 | Chưa có (`licenseRef` ghi rõ "chưa có") | Xin phép trước khi đưa app ra ngoài nhóm; ghi nguồn chữ câu 13 |
| DB chung (`asdr-db` trên `user-KHMT02`) | Đang chạy; chưa chống tái diễn | Chủ dự án chạy lệnh sysctl ở §20.5 (cần sudo). Nếu lại báo "Can't reach database server" → §15 mục 24 |
| Git | Chưa commit gì từ 07/10 | Chủ dự án tự commit theo §20.5; `mchat-rf.vi.json` không được add |
| Bài tập / ML | G0, C1 chưa làm | §20.5 |

**Không được làm:**

- Chép, đọc to hay in nội dung câu hỏi / ví dụ / hướng dẫn M-CHAT ra chat hay vào file trong repo. Kiểm tra file nội dung chỉ bằng validator hoặc script in tên ô và độ dài.
- Chạy lệnh ghi trên máy chủ DB. Đưa lệnh cho chủ dự án tự chạy.
- Khởi động lại backend :4000 / frontend :5173 của chủ dự án.
- Để lại lượt trả lời thử trên DB chung: thử xong thì xoá bằng nút / API xoá của app.
