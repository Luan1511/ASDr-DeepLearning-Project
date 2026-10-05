# Đánh giá lại & hiệu chỉnh (calibrate) model ST-GCN — Giai đoạn 2

> Đây là công cụ **sàng lọc tham khảo**, không phải chẩn đoán. Mọi con số công bố
> (báo cáo, cuộc thi, UI) chỉ được lấy từ `test_results.json` do
> `calibrate_evaluate.py evaluate` sinh ra.

## Nguyên tắc

1. **Chia theo subject** (mỗi trẻ chỉ thuộc đúng một tập train/val/test), stratified theo lớp, seed cố định.
2. Mọi lựa chọn — epoch, siêu tham số, nhiệt độ T, ngưỡng — **chỉ dựa trên val**.
3. Calibrate trên dự đoán val tạo bằng **đúng tiền xử lý của server deploy** (`predict_dataset.py`).
4. **Đánh giá test MỘT lần**, sau khi mọi thứ đã đóng băng. Xem kết quả test rồi quay lại sửa thì tập test
   thành val thứ hai: phải ghi rõ trong báo cáo, hoặc thu thập tập test mới. `evaluate` từ chối ghi đè
   `test_results.json` nếu không có `--force`.

## Thành phần (`research_src/`)

| File | Vai trò |
|---|---|
| `calibrate_evaluate.py` | `split` → `splits.json`; `calibrate` → `calibration.json`; `evaluate` → `test_results.json`. Toán thuần numpy. |
| `predict_dataset.py` | Chạy tiền xử lý + inference **giống hệt server** (`STGCNPredictor`, T=1) → predictions CSV + `<csv>.meta.json` (sha256 checkpoint). |
| `fine_tune.py` | Fine-tune với `--splits`, chọn epoch theo **macro-F1 trên val**, test 1 lần, lưu `num_joints` + `test_results.json`. |
| `tests/test_calibrate_evaluate.py` | Unit test: `python -m unittest discover -s research_src/tests` |

## Quy trình trên máy GPU (đường dẫn là ví dụ)

```bash
cd /path/to/Main                        # giữ bố cục repo: research_src/ nằm cạnh API/ (hoặc dùng --api-dir)
export DATA=/path/to/exports_excels/Dataset_video   # chứa Autism/ và Typical/ (wide Excel)
export CKPT=/path/to/Training_logs/.../checkpoints/best_model.pth
export WORK=/path/to/eval_runs/2026-10-xx           # NGOÀI repo: không đưa artifact vào git
mkdir -p "$WORK"

# 1) Split theo subject — đọc kỹ bảng gom nhóm in ra trước khi ghi file
python research_src/calibrate_evaluate.py split --root "$DATA" --dry-run
python research_src/calibrate_evaluate.py split --root "$DATA" --seed 42 --output "$WORK/splits.json"

# 2) Fine-tune: chọn epoch trên val, test 1 lần
#    (fine_tune.py cần ULTIMATE_*.py — chỉ có trên server — và calibrate_evaluate.py cùng thư mục)
cp research_src/fine_tune.py research_src/calibrate_evaluate.py /path/to/NCKH_25-26/sub_phase/tools/
(cd /path/to/NCKH_25-26 && python3 sub_phase/tools/fine_tune.py --ckpt "$CKPT" \
    --splits "$WORK/splits.json" --epochs 20 --lr 5e-5 --out-dir "$WORK/finetuned")
export FT="$WORK/finetuned/finetuned_best_model.pth"

# 3) Dự đoán val + test bằng tiền xử lý deploy (logit thô, T=1)
python research_src/predict_dataset.py --checkpoint "$FT" --splits "$WORK/splits.json" \
    --only-splits val test --device cuda --output "$WORK/preds.csv"

# 4) Calibrate trên val (T theo NLL, ngưỡng Youden; mức HIGH: specificity >= 0.95)
python research_src/calibrate_evaluate.py calibrate --predictions "$WORK/preds.csv" \
    --checkpoint "$FT" --output "$WORK/calibration.json"
#    ưu tiên độ nhạy:  --threshold-strategy sensitivity --target-sensitivity 0.9

# 5) Đánh giá test — MỘT lần
python research_src/calibrate_evaluate.py evaluate --predictions "$WORK/preds.csv" \
    --calibration "$WORK/calibration.json" --checkpoint "$FT" --output "$WORK/test_results.json"

# 6) Deploy: copy nguyên file (không torch.save lại), sha256 phải trùng checkpoint_sha256
cp "$FT" API/ASD_Model/finetuned_best_model.pth
cp "$WORK/calibration.json" API/ASD_Model/calibration.json
sha256sum API/ASD_Model/finetuned_best_model.pth
```

ML server nạp `API/ASD_Model/calibration.json` và **bỏ qua nó nếu `checkpoint_sha256` không khớp** checkpoint đang
chạy. Nếu `checkpoint_sha256` là `null` (calibrate không có `--checkpoint` và không có `.meta.json`) thì server
không kiểm tra được và sẽ áp dụng cho **mọi** checkpoint, nên luôn truyền `--checkpoint`. Lưu `splits.json`, `preds.csv(.meta.json)`, `calibration.json`, `test_results.json` và checkpoint vào nơi lưu
trữ có version (không commit vào git). Khi báo cáo, chỉ dùng `test_results.json`: metric + CI 95%, số subject mỗi
lớp, confusion matrix, phân bố mức rủi ro, T/ngưỡng, seed split.

## Quy ước

- **Subject regex** (`split --root`): `re.search` trên đường dẫn của mẫu tính từ thư mục lớp (dấu `/`, đã bỏ đuôi
  file); nhóm bắt đầu tiên là subject. Mặc định `^([^/]+)` = thành phần đầu tiên: `video_12.xlsx` → `video_12`
  (Dataset_video: mỗi trẻ 1 video), `12/video/3_2d.xlsx` → `12`, `136/keypoints_body25.json` → `136`. Nếu mỗi trẻ
  có nhiều video, ví dụ `child07_walk2.xlsx`, dùng `--subject-regex '^(child\d+)_'`. Subject id được gắn tiền tố
  thư mục lớp (`Autism/video_12` khác `Typical/video_12`). Có thể dùng `--manifest` (CSV `path,subject_id,label`,
  label 0/1 hoặc Typical/ASD/Autism; đường dẫn tương đối tính từ thư mục chứa manifest).
- **Mẫu `predict_dataset.py` nhận**: file API `keypoints_body25.json`; thư mục frame OpenPose `*_keypoints.json`
  (hoặc thư mục subject của API); wide Excel `kp{j}_x/_y[/_c]`. Mẫu lỗi vẫn có dòng, cột `error` được điền, và bị
  `calibrate`/`evaluate` bỏ qua kèm cảnh báo.
- **Xác suất & mức rủi ro**: `p_asd = softmax(logits / T)[ASD]`; điểm subject = **trung bình** p_asd các mẫu; ASD
  nếu điểm ≥ `threshold`; `LOW < threshold ≤ MEDIUM < high_risk_threshold ≤ HIGH`. Ngưỡng được chọn trong các điểm
  val quan sát được: Youden J (hòa → độ nhạy cao hơn), hoặc ngưỡng lớn nhất đạt độ nhạy mục tiêu; `high_risk` =
  ngưỡng nhỏ nhất ≥ threshold đạt specificity mục tiêu. Nếu `high_risk_threshold_achieved=false` thì
  `high_risk_threshold = threshold`: không có mức HIGH "đặc hiệu cao" thật sự.
- **Metric**: AUC (Mann–Whitney, hòa tính 0,5), sensitivity, specificity, PPV, NPV, F1, accuracy, Brier, ECE
  (10 bin đều); CI 95% bằng bootstrap 2000 lần theo subject, stratified theo lớp (percentile). Metric không xác
  định (ví dụ chỉ một lớp) là `null`.

## Lưu ý & hạn chế

- **Kinect ≠ OpenPose**: model gốc học trên Kinect v2 2D; khi chạy thật dùng OpenPose BODY_25 map sang thứ tự Kinect
  (SpineShoulder = Neck, SpineMid = trung bình Neck–MidHip, khớp tay = 0). Vì lệch miền nên phải calibrate trên dự
  đoán OpenPose với đúng tiền xử lý deploy.
- **Tiền xử lý fine-tune ≠ deploy**: `fine_tune.py` resample nearest *trước* chuẩn hóa, server nội suy tuyến tính
  *sau* chuẩn hóa. Metric trong `fine_tune.py` (theo file, argmax) chỉ dùng nội bộ; việc chọn epoch vẫn chịu lệch này.
- **Dữ liệu nhỏ** (~50 subject/lớp → khoảng 10 subject/lớp cho val và test): CI rất rộng, ngưỡng dao động mạnh
  (1 subject ≈ 10 điểm % độ nhạy). Luôn báo cáo kèm CI.
- **Đổi checkpoint là phải calibrate lại** (sha256 đổi, server sẽ bỏ qua `calibration.json` cũ), kể cả khi chỉ
  fine-tune lại.
- **Điểm subject vs 1 video**: ngưỡng chọn trên điểm trung bình theo subject; khi deploy mỗi lượt sàng lọc thường chỉ
  có 1 video (p phân tán hơn). Xem thêm `sample_level_metrics` trong `test_results.json`.
- **Video trùng**: cùng một video upload hai lần (ví dụ `API/storage/asd_subjects/36` và `136`, hai thư mục UUID)
  phải dùng chung `subject_id`. `predict_dataset.py` cảnh báo khi các subject khác nhau có dự đoán giống hệt nhau.
- **Checkpoint đang deploy** (`finetuned_best_model.pth`) được chọn theo accuracy trên test (rò rỉ). Ngoài ra, bản
  `fine_tune.py` cũ lưu `model.state_dict()` theo tham chiếu, nên trọng số lưu ra thực chất là của epoch cuối. Mọi
  con số cũ của checkpoint này đều không hợp lệ; cần đánh giá lại theo quy trình trên.
