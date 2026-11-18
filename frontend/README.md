# AIMBRACE — frontend

React 18 + Vite + TypeScript + Tailwind. Tài liệu đầy đủ của dự án nằm ở [`../master_prompt.md`](../master_prompt.md).

```bash
npm install
cp .env.example .env     # VITE_API_URL=http://localhost:4000/api
npm run dev              # http://localhost:5173
npm run dev:sandbox      # http://localhost:5175, dùng backend sandbox (cd ../backend && npm run sandbox)
npm run lint             # eslint
npm test                 # vitest
npm run build            # tsc -b && vite build
```

Thư mục chính trong `src/`: `pages/` (màn hình), `components/`, `layouts/`, `lib/` (gọi API, bài tập, robot Bin, tiện ích), `state/` (đăng nhập).

Mô hình chạy trong trình duyệt nằm ở `public/`: `exercise-coach/` (MediaPipe Pose cho phần nhắc trực tiếp khi tập) và `buddy-vision/` (MediaPipe Face Landmarker + SFace cho robot Bin).
