# Đánh giá lại dữ liệu train ST-GCN (2026-10-29)

Chỉ đọc dữ liệu, không sửa gì trong `E:\Scientific research 2025-2026\Linux_src_2`. Script và CSV nằm cạnh file này:
`audit_data.py` → `video_audit.csv`, `kinect_audit.csv`; `camera_motion.py` → `camera_motion.csv`; `video_audit_merged.csv` (gộp hai bảng video); `kinect_subject_groups.csv` (nhóm trẻ trùng). CSV chỉ chứa số đo và tiền tố md5, không có hình ảnh.

Ký hiệu: **đã đo** = có số trong CSV; **suy luận** = giải thích hợp lý nhưng chưa kiểm chứng trực tiếp.

## 1. Nguồn dữ liệu

| Bộ | Đường dẫn | Nội dung |
|---|---|---|
| Kinect | `Datas/Kinect25_ASD/Kinect25_ASD_NoVideos` | Bộ Al-Jubouri và cs. 2020 (ĐH Babylon, Iraq). 50 ASD + 50 Typical; mỗi trẻ có `video/8.xlsx` (3D, mét) + `8_2d.xlsx` (2D, pixel ảnh màu 1920×1080) và 7 bản augmentation (mỗi bản có 3D + 2D). Mỗi clip là **một chu kỳ bước**, 21–60 frame ở 30 fps (~1 giây). Trẻ đi về phía Kinect đặt cố định cao 0,75 m, từ ~3,1 m tới ~2,1 m. |
| Video | `Datas/Kinect25_ASD_Video/Dataset_video` | 50 ASD + 49 Typical `.avi`, 60 fps, 0,75–7,9 giây. Keypoint OpenPose có sẵn trong `Visualized_Results/keypoints`. |
| Fine-tune cũ | `sub_phase/tools/fine_tune.py` + log trong `COMMANDS.md` | Base `stgcn_bbox_no_head_neck_seed42_20260428_033403` (train trên Kinect 2D). Fine-tune trên Excel của bộ video: seed 44, **train 30% / test 70%**, val bị ép 1 video mỗi lớp rồi bỏ đi → 30 train / 67 test / 2 bỏ. Epoch được **chọn theo test acc**. Base trước fine-tune đạt 73% trên test. |

**Không có checkpoint `.pth` nào** trong `Training_logs/` trên máy này. Thư mục base `…20260428_033403` không tồn tại; chỉ còn config/log của 5 lần chạy `stgcn_bbox_no_head_neck_seed42_20260522_*`. Vì vậy thí nghiệm `leg_swap` với checkpoint gốc chưa làm được trên máy này.

## 2. Bộ video (Dataset_video): nhãn trùng với cách quay — vấn đề chính

### 2.1 Độ phân giải và khung hình (đã đo)

| | 1080×1920 (gốc) | Đã cắt khung |
|---|---|---|
| ASD | **35** | 15 |
| Typical | **0** | 49 |

Riêng **chiều rộng video** đã tách được hai lớp với AUC **0,93**, chiều cao 0,88. Model đang deploy (§21.6 của master prompt) chỉ đạt AUC 0,915. Typical đều đã bị cắt và có kích thước lẻ (628–1888 px), tức là hai lớp đã đi qua hai quy trình xử lý khác nhau.

### 2.2 Cách đặt camera (đã đo + xem 10 clip)

`camera_motion.py` đo chuyển động nền bằng optical flow, sau khi che vùng người, và lấy trung vị theo clip:

| | Cầm tay (flow > 0,2) | Cố định |
|---|---|---|
| ASD | **27** | 23 |
| Typical | 2 | **47** |

Đã xem 10 clip (6 ASD, 4 Typical; ảnh tạm đã xoá):
- **ASD:** phần lớn quay bằng điện thoại cầm tay, giơ cao chĩa xuống, trẻ ở gần. Mỗi clip một phòng khác nhau. Trẻ đi lòng vòng, quay người hoặc đi về phía người quay.
- **Typical:** camera đặt cố định ngang tầm trẻ, ở xa. Trẻ đi thẳng về phía camera, chỉ trong vài căn phòng lặp lại, đúng như giao thức của bộ Kinect.

Ngưỡng 0,2 là ước lượng tự động, chưa xem tay từng clip. Ví dụ ASD 20 bị xếp "cố định" nhưng ảnh cho thấy góc quay thay đổi; khi trẻ chiếm gần hết khung, phần nền còn lại quá ít để đo.

### 2.3 Tỉ lệ chân/thân thấp ở ASD là do phối cảnh, không phải do ngồi xổm

Bảng dưới là trung vị theo clip, tính trên frame thấy đủ cổ, hông, gối, cổ chân với confidence > 0,3:

| | Chân/thân | Góc gối | Hông/(cổ→cổ chân) | Lớn dần khi lại gần | Hông dịch ngang (theo chiều cao thân) |
|---|---|---|---|---|---|
| ASD | 1,29 | 173,5° | 0,56 | 1,14 | 0,30 |
| Typical | 1,42 | 175,4° | 0,59 | 1,59 | 0,12 |

- Ở 20 video có tỉ lệ thấp nhất (0,77–1,22, cả 20 đều là ASD), góc gối trung vị vẫn 137–177° và hầu hết trên 150°. Chân gần như thẳng nên **không phải ngồi xổm/cúi** như §21.6 đã đoán. Camera đặt cao chĩa xuống làm chân ngắn lại trên ảnh. (Suy luận, nhưng khớp với ảnh đã xem.)
- Không chỉ tỉ lệ chân/thân, nhiều đặc trưng khác cũng tách được hai lớp chỉ nhờ cách quay:

  | Đặc trưng | AUC |
  |---|---|
  | Độ cao hông trên ảnh | 0,82 |
  | Hông dịch ngang | 0,81 |
  | Tỉ lệ chân/thân | 0,80 |
  | Độ lớn dần khi lại gần | 0,77 |
  | Góc gối | 0,77 |
  | Thời lượng | 0,65 |

- **Chỉ xét video camera cố định** (23 ASD, 47 Typical), hai lớp vẫn tách được: chiều rộng 0,93, hông dịch ngang 0,82, chân/thân 0,75. Vậy ngay cả khi bỏ video cầm tay, chiều cao/góc đặt camera và cách trẻ đi vẫn khác nhau giữa hai lớp.

**Hệ quả:** augmentation co giãn chân 0,8–1,2 (kế hoạch cuối master prompt) chỉ che được **một** trong nhiều tín hiệu. Model vẫn có thể dựa vào độ cao hông, quỹ đạo đi ngang, mức lớn dần khi lại gần, nhịp thời gian... Với bộ video này, không cách xử lý nào ở mức skeleton tách được "ASD" khỏi "cách quay video ASD".

### 2.4 Trùng lặp và rò rỉ

- **5 cặp Typical trùng byte** (md5 và keypoint giống hệt): 9=32, 14=44, 15=33, 16=47, 18=45. Còn 44 trẻ Typical, 50 ASD.
- Lần fine-tune cũ (dựng lại theo seed 44): 4 cặp trùng nằm vắt qua train/test (cặp 14=44 là train/bỏ). Vì vậy 85–86% "test" của lần đó bị thổi phồng, cộng thêm việc chọn epoch theo test.
- Tập test calibration 27/10 (20 video):
  - **6 video** nằm trong train của lần fine-tune cũ;
  - 2 video (15, 14) là bản trùng của video train fine-tune (33, 44);
  - video 16 trùng với 47 trong val.

  Tổng cộng **8/20 video test** model đã thấy lúc train. AUC 0,95 của ngày 27/10 không dùng được.

## 3. Bộ Kinect

### 3.1 Trẻ trùng giữa các thư mục (đã đo, so hash toạ độ 2D làm tròn 0,01)

| Nhóm | Ghi chú |
|---|---|
| ASD 1 = 34 | dùng chung một phần bản augmentation |
| ASD 7 = 18 | dùng chung một phần bản augmentation |
| ASD 30 = 40 | trùng cả bản gốc |
| Typical 1 = 7 = 16 = 20 = 29 | 6/7 bản augmentation giống hệt, bản gốc 7 = 29 |
| Typical 2 = 26 = 40 | dùng chung bản augmentation |
| Typical 4 = 23 = 28 | trùng cả bản gốc |
| Typical 13 = 14 | trùng bản gốc |

Không có file nào trùng giữa hai nhãn. Sau khi gộp: **47 ASD, 41 Typical** (giới hạn trên; một số nhóm chỉ trùng augmentation nên có thể là trẻ khác bị chép nhầm file).

Base train chia theo **thư mục** (`subject_wise_split`, seed 42, 70/15/15). Dựng lại theo code: 4/14 trẻ test (đều Typical) có bản trùng nằm trong train hoặc val. Kết quả test của base cũng bị thổi phồng. Tập test chỉ có 14 trẻ nên sai số rất lớn. (Suy luận từ code, chưa đối chiếu log của lần chạy đó.)

### 3.2 Chiều của lối tắt ngược với bộ video (đã đo)

| | Chân/thân 2D (pixel) | Chân/thân 3D (mét) |
|---|---|---|
| ASD | 1,06 | 1,13 |
| Typical | 0,98 | 1,06 |
| AUC | 0,70 (**cao** = ASD) | 0,68 (**cao** = ASD) |

Trong Kinect, trẻ ASD có tỉ lệ chân/thân **cao hơn**. Trong bộ video thì ngược lại. Vậy lối tắt "chân ngắn = ASD" của model đang deploy **đến từ bộ video, không thể đến từ Kinect**. Đây là bằng chứng ở mức dữ liệu cho nhánh "lối tắt do fine-tune" trong kế hoạch. Thí nghiệm `leg_swap` trên checkpoint gốc vẫn nên làm khi tìm được file.

Kinect vẫn có chênh lệch giữa hai lớp mà không phải dáng đi (AUC 0,67–0,75: số frame, góc gối, kích thước trên ảnh), nhưng nhỏ hơn bộ video nhiều.

### 3.3 Ghi chú khác

- **ASD 8:** tỉ lệ 2D = 52,7 (toạ độ 2D vai/hông hỏng), trong khi 3D bình thường (1,33). Cần loại hoặc sửa file 2D.
- Bản augmentation có số frame khác bản gốc (+3,7 frame trung bình; cả 7 bản cùng độ dài). Có vẻ chúng được tạo từ một chu kỳ bước khác chứ không chỉ biến đổi bản gốc. Bản 4 kéo dài chân 6% (3D).
- Không ghép được trẻ Kinect số k với `video_k`: tương quan tỉ lệ chân/thân giữa hai bên ≈ 0. Không có bằng chứng hai bộ là cùng một nhóm trẻ theo cùng số thứ tự.

## 4. Lệch miền Kinect → OpenPose (đọc code)

- `_openpose25_to_kinect25` gán **cùng điểm cổ OpenPose** cho cả Kinect `Neck` và `SpineShoulder`; `SpineMid` là trung điểm cổ–hông. Khớp hông Kinect và OpenPose cũng không cùng vị trí giải phẫu.
- Kinect là 1 chu kỳ bước trong ~1 giây ở 30 fps. Video là 1–4 chu kỳ trong 1–8 giây ở 60 fps. Sau khi resample về 128 frame, tần số bước trên mỗi frame lệch nhau 2–4 lần.
- Kinect: camera cố định thấp 0,75 m. Video ASD: cầm tay, cao, chĩa xuống.

## 5. Đề xuất trước khi fine-tune lại

1. **Không dùng `Dataset_video` nguyên trạng để train hay báo cáo** bài toán ASD vs Typical: nhãn gần như trùng với cách quay. Chỉ fine-tune trên tập con "camera cố định" cũng không đủ, vì tập đó vẫn tách được hai lớp bằng kích thước và quỹ đạo (AUC 0,82–0,93).
2. **Hỏi nguồn gốc video:** ai quay, ai cắt khung Typical, video ASD có phải ảnh màu Samsung Note 9 trong bộ Al-Jubouri (bộ này có thêm 9 trẻ ASD nặng chỉ có video màu) hay không. Cách sửa thật là có dữ liệu đối chứng cùng cách quay: Typical quay cầm tay như ASD, và/hoặc ASD quay cố định như Typical.
3. **Kinect làm nguồn train chính:** gộp 7 nhóm trùng, chia train/val/test theo nhóm, sửa hoặc loại ASD 8, chọn epoch theo val, test một lần. Báo cáo cả khoảng tin cậy vì chỉ có ~88 trẻ.
4. **Cổng kiểm tra lối tắt cho mọi model mới**, trên tập đánh giá:
   - AUC của các đặc trưng cách quay (kích thước video, flow nền, chân/thân, độ cao hông, hông dịch ngang, độ lớn dần khi lại gần) phải thấp hơn rõ AUC model;
   - điểm của model không được đổi theo cách quay khi cùng nhãn (ví dụ ASD cầm tay so với ASD cố định);
   - chạy lại `leg_swap.py`, `shortcut_check.py`.
5. Muốn có số liệu trên video thật thì dùng một tập ngoài, quay cùng giao thức cho cả hai nhóm, và không có trẻ nào nằm trong dữ liệu đã train.

## 6. Kiểm tra domain Kinect ↔ video (đầu vào model)

Script `domain_gap.py` import đúng hàm từ `ULTIMATE_FINAL_TRAINING_ROUND.py` / `ULTIMATE_TRAINING_OPENPOSE_STGCN.py` và đưa hai bộ về đầu vào 18 khớp (layout `kinect23`) × 128 frame:

- Kinect: `_read_2d_excel_pairwise` → bỏ khớp [1, 9–14] → bbox từng frame → resample **tuyến tính**;
- video: Excel wide (`sub_phase/exports_excels`) → trim → BODY_25 → Kinect25 → bỏ khớp → resample **nearest** → bbox (đúng `fine_tune.py`).

Dữ liệu: Kinect bản gốc, đã bỏ 12 thư mục trùng và ASD 8 (46 ASD + 41 Typical); video đã bỏ 5 bản trùng (50 + 44). Kết quả: `domain_features.csv`, `domain_gap_summary.csv`, `video_missing_joints.csv`, `domain_gap.png` (chỉ skeleton trung vị và histogram).

Lưu ý: script train trên máy dev bỏ 8 khớp (17 khớp), còn checkpoint đang deploy dùng 18 khớp, nên bản code train base thật có thể khác bản này. Phân tích dùng 18 khớp như checkpoint.

### 6.1 Hai domain tách nhau gần như hoàn toàn (đã đo)

Logistic regression trên 29 đặc trưng tóm tắt, CV 5 fold: **AUC 0,99** khi phân biệt Kinect với video. Nhiều đặc trưng đơn lẻ đã đạt ≥ 0,95.

| Khác biệt | Kinect | Video | AUC domain | Nguyên nhân |
|---|---|---|---|---|
| **Trái/phải** (x vai trái − x vai phải, trẻ đi về phía camera) | 0/87 clip dương | 90/94 clip dương | 0,98 | **Kinect 2D bị lật gương** so với ảnh thường: khớp "Left" của Kinect nằm bên trái ảnh, khớp "L" của OpenPose nằm bên phải. Model học vai trò trái/phải ngược nhau giữa base và fine-tune; nhớ là model đang bất đối xứng trái/phải (§21.6: lật gương Typical_14 0,999 → 0,088). |
| Độ dài clip gốc | 29 frame, 1 chu kỳ bước | 119 frame, 2 chu kỳ (trung vị; tới 17) | 1,00 / 0,80 | Kinect cắt sẵn 1 chu kỳ ở 30 fps, video 60 fps và dài hơn. Sau resample 128, tốc độ mỗi bước thời gian chênh **~10 lần** (vel 0,005 vs 0,052). Kernel thời gian 9 frame nhìn thấy hai thang thời gian khác hẳn nhau. |
| Nhiễu (gia tốc/vận tốc) | 0,32 | 1,84 | 1,00 | Kinect làm mượt + nội suy tuyến tính; OpenPose rung + resample nearest lặp frame. |
| Khớp thiếu | 0 (đã nội suy) | trung vị 3–4% frame có khớp = (0,0); 23 clip > 20% | — | Video giữ (0,0) toạ độ ảnh, nên bbox từng frame bị kéo tới góc ảnh và skeleton bị ép. Server ML hiện cũng giữ (0,0) để khớp fine-tune (§7.3). |
| Frame lặp do resample | 0 | Typical 12%, ASD 0% | — | Clip Typical ngắn hơn 128 frame nên bị nhân frame, ASD dài hơn nên bị bỏ frame → tín hiệu lệch theo lớp do tiền xử lý tạo ra. |
| Định nghĩa khớp (chia cho thân) | hông rộng 0,27, đùi 0,55, cẳng 0,49, SpineMid 0,58 | 0,38 / 0,71 / 0,65 / 0,50 | 0,85–0,99 | Hông, cổ, SpineMid của Kinect và OpenPose khác vị trí giải phẫu (SpineMid video là trung điểm tổng hợp). Chân/thân: Kinect ≈ 1,0, video ≈ 1,37. |
| Biên độ tay (trục y) | 0,17 | 0,90 | 0,89 | Video lớn hơn 5 lần; một phần do khớp cổ tay bị thiếu (0,0) và nhiễu. |

### 6.2 Tín hiệu ASD không chuyển được giữa hai domain (đã đo)

- Trong 31 đặc trưng, đa số có **hướng ASD–Typical ngược nhau** giữa hai bộ (`same_direction=False` trong `domain_gap_summary.csv`). Ví dụ:
  - chân/thân: Kinect cao = ASD (0,66), video thấp = ASD (0,20);
  - cẳng chân: 0,71 vs 0,18;
  - vị trí gối, hông trên trục y: ngược chiều.
- Logistic regression học ASD trên đặc trưng Kinect rồi thử trên video: AUC **0,50**. Học trên video thử trên Kinect: **0,51**. Không có tín hiệu "dáng đi ASD" chung nào ở mức đặc trưng tóm tắt. (Model ST-GCN có thể học đặc trưng tinh hơn, nhưng không có checkpoint để kiểm tra.)

### 6.3 Hệ quả

1. "Fine-tune từ base Kinect" hiện là chuyển giữa hai domain khác nhau ở **trái/phải, thang thời gian, định nghĩa khớp và nhiễu**. Phần base học được khó mang sang, nên fine-tune với 30 video gần như học lại từ đầu, và học luôn lối tắt của bộ video (§2).
2. Việc cần làm trước bất kỳ lần train hay fine-tune nào:
   - **lật x của Kinect 2D** (hoặc hoán đổi Left/Right) cho cùng quy ước với OpenPose; cộng augmentation lật gương cho cả hai;
   - **thống nhất thang thời gian**: cắt video theo chu kỳ bước, hoặc resample theo thời gian thực (giây) thay vì về 128 frame cố định; dùng cùng kiểu resample (tuyến tính) cho cả hai;
   - **nội suy khớp thiếu** (hoặc bỏ khỏi bbox) thay vì giữ (0,0); sửa đồng thời ở `fine_tune.py` và `API/services/stgcn_service.py` để train và suy luận vẫn khớp nhau;
   - cân nhắc chuẩn hoá theo chiều dài thân (`SpineShoulder`–`SpineBase`) thay vì bbox, và bỏ các khớp lệch định nghĩa (SpineMid tổng hợp);
   - lọc nhiễu OpenPose (tương tự `services/preprocessing.py`) ngay lúc train.
3. Kể cả khi đã làm hết các bước trên, §2 vẫn đúng: bộ video không đánh giá được ASD vs Typical vì nhãn trùng cách quay. Kiểm tra domain chỉ trả lời câu hỏi "base Kinect có dùng được cho OpenPose không". Câu trả lời hiện là **chưa**, nếu chưa sửa các lệch trên.

## 7. Đối chiếu dataset gốc Dryad và metadata readme

Dataset gốc: `E:\JupyterWorkspace\NCKH\Dataset\Dataset` — bản đầy đủ của Dryad [doi:10.5061/dryad.s7h44j150](https://datadryad.org/dataset/doi:10.5061/dryad.s7h44j150) (Al-Jubouri, Hadi, Rajihy 2020). Paper mô tả: COMPUSOFT 9(8):3791–3797. `readme.docx` giống hệt bản trong `Kinect25_ASD_NoVideos`. Script `metadata_link.py` → `metadata_linked.csv`; `orig_color_videos.csv`.

### 7.1 Dataset_video là video màu gốc của tác giả (đã đo)

- Mỗi trẻ có `video/video.avi` (video màu Samsung Note 9), `Svideo.avi` (skeleton), `Tvideo.avi` (quỹ đạo); mỗi augmentation có `Svideo.avi`.
- **Cả 99 file trong `Dataset_video` trùng byte (md5) với `video/video.avi` gốc.** Vậy cắt khung, độ phân giải, cầm tay hay cố định đều **có sẵn từ tác giả**; nhóm không xử lý gì thêm. Lối tắt theo cách quay (§2) là đặc điểm của chính bộ dữ liệu công bố.
- Số thứ tự `video_k` **không** trùng với số thư mục gốc (chỉ 2/99 khớp). Bảng nối nằm trong `metadata_linked.csv`, cột `video_idx`.
- Video màu gốc có 5 cặp Typical trùng byte theo thư mục: 17=39, 22=5, 23=4, 24=7, 26=50. Đây chính là 5 cặp trùng của `Dataset_video`. Typical 2 không có `video.avi`, chỉ có `video1.avi` → 49 video Typical.
- 9 trẻ ASD nặng nằm ở `Autism/Severe level of ASD/case1..9` (chỉ có video màu, không có Kinect; case 2 có 2 video), **không** có trong `Dataset_video`.

### 7.2 Metadata: tuổi, giới, chiều cao lệch mạnh giữa hai nhóm

Readme có bảng từng trẻ. Cột "Length" của Typical là **feet** (2,5–5,0; trường hợp 28 ghi 1,2 có vẻ nhầm), của ASD là **mét**. Đã đổi Typical sang mét.

| | ASD (50) | Typical (50) |
|---|---|---|
| Tuổi trung vị (min–max) | 9 (5–15) | 6 (2–14) |
| ≤ 4 tuổi | **0** | **13** |
| Nam / nữ | 42 / 8 | 26 / 24 |
| Chiều cao theo metadata (trung bình) | 1,32 m | 1,13 m |
| Chiều cao đo từ Kinect 3D (đầu → chân) | 1,22 m | 1,04 m |

- AUC chỉ dùng **chiều cao đo từ Kinect: 0,85**; tuổi (metadata): 0,70; giới: 0,66; tuổi + giới (CV 5 fold): 0,72.
- Chỉ xét trẻ 5–10 tuổi (44 ASD, 29 Typical), chiều cao Kinect vẫn đạt AUC 0,86 → trong cùng khoảng tuổi, nhóm ASD vẫn lớn hơn.
- Tuổi tương quan với chiều cao Kinect (Typical r = 0,70; ASD 0,31) và với tỉ lệ chân/thân 3D (0,34; 0,25). Vậy chênh lệch chân/thân trong Kinect (§3.2, ASD cao hơn) **phần lớn là do tuổi và thể trạng**, không phải dáng đi. Trẻ 2–4 tuổi còn có dáng đi chưa trưởng thành.
- Chuẩn hoá bbox bỏ được kích thước tuyệt đối nhưng không bỏ được tỉ lệ cơ thể và nhịp bước theo tuổi. Model train trên Kinect có thể học "trẻ lớn = ASD".
- Ghép "Case k" ↔ thư mục k: tương quan chiều cao metadata với chiều cao Kinect là 0,58 (Typical) và 0,22 (ASD). Với ASD, việc ghép theo số thứ tự **chưa chắc chắn**. Các con số AUC dựa trên số đo Kinect thì không phụ thuộc việc ghép này.

### 7.3 Khác

- `outlier_detection_report.txt` (đã có sẵn) in toạ độ Kinect 2D: vai trái x = 653 < vai phải x = 716 khi trẻ đi về phía camera → xác nhận Kinect 2D lật gương (§6.1).
- Trong `E:\JupyterWorkspace\NCKH\Dataset` còn có `MMASD` (JSON khung xương, các hoạt động trị liệu: lắc maracas, hát + vỗ tay, squat, tư thế cây), `MMASD_3D` (ROMP 3D), `NTU_pretrain_ready`. Chưa đánh giá. MMASD có thể hữu ích cho phần bài tập bắt chước (F3/F4), và NTU cho pretrain skeleton.

### 7.4 Hệ quả cho đề xuất

1. Với bộ Kinect: chia tập phải **cân bằng theo tuổi**, hoặc chỉ dùng khoảng tuổi chồng nhau (5–14), bỏ 13 trẻ Typical ≤ 4 tuổi. Báo cáo thêm AUC của tuổi, giới, chiều cao làm baseline; model phải vượt rõ các baseline đó. Thêm tuổi/chiều cao vào cổng kiểm tra lối tắt.
2. Kinect cũng có lối tắt (tuổi, thể trạng), chỉ là khác loại so với bộ video (cách quay). Số liệu 92–95% trong các bài báo dùng bộ này cần được đọc với lưu ý đó.
3. Không có cách nào thu được số liệu sạch về khả năng sàng lọc ASD bằng dáng đi từ bộ Dryad này. Với dự án thử nội bộ, đó là giới hạn cần ghi nhận; muốn đo khả năng thật thì cần dữ liệu cân bằng tuổi, giới và cách quay.

## 8. Domain có khắc phục được không (ablation, `domain_fix.py`)

Các bước sửa được áp dồn lên Kinect (46 + 41) và video (50 + 44), cùng đưa về 128 × 18 × 2, rồi đo lại. Kết quả trong `domain_fix_results.csv`.

| Cấu hình (dồn) | AUC domain, đặc trưng tóm tắt | AUC domain, tư thế từng khớp | Số đặc trưng lệch mạnh (AUC > 0,8) |
|---|---|---|---|
| 0. Hiện tại | 0,99 | 1,00 | 19/30 |
| 1. Lật gương Kinect | 0,99 | 0,98 | 18 |
| 2. + nội suy khớp thiếu (video) | 1,00 | 0,99 | 15 |
| 3. + lọc nhiễu (median 5) | 1,00 | 0,99 | 15 |
| 4. + video 30 fps, cắt 1 chu kỳ bước (57/94 clip tìm được) | 1,00 | 0,99 | 15 |
| 5. + resample tuyến tính cho cả hai | 0,98 | 0,99 | 11 |
| 6. (5) + chuẩn hoá theo thân thay bbox | 0,99 | 0,98 | 14 |
| 7. (5) + SpineMid tổng hợp cho Kinect | 0,98 | 0,99 | 10 |
| 8. (7) + chỉnh độ dài xương Kinect theo OpenPose | **0,93** | **0,98** | **0** |

Hệ số chỉnh xương (trung vị video / trung vị Kinect, theo tỉ lệ với thân): tay 1,06–1,16; hông → SpineBase 1,5; đùi 1,26; cẳng chân 1,32; bàn chân 1,38. Chân và hông của hai bộ định nghĩa khác nhau rõ.

Phần lệch còn lại sau cấu hình 8, đo bằng pose vector:
- Kinect vs video Typical quay cố định (gần giao thức Kinect nhất): **0,99**.
- Kinect vs video ASD cố định: 0,95; vs video ASD cầm tay: 0,97.
- Mốc so sánh: cùng bộ phân loại đó tách ASD/Typical **trong** từng domain được 0,92.

Phần lệch còn lại **không** do cách quay (ngay cả video Typical quay cố định vẫn tách được 0,99). Đó là khác biệt giữa skeleton của cảm biến độ sâu (Kinect) và skeleton suy từ ảnh màu (OpenPose), ở mức từng khớp.

Tín hiệu ASD vẫn không chuyển được giữa hai domain ở mọi cấu hình (học trên domain này, thử trên domain kia: AUC 0,41–0,64, quanh mức ngẫu nhiên).

**Kết luận:**
- Các lệch "kỹ thuật" sửa được bằng tiền xử lý: lật gương, thang thời gian, nhiễu, khớp thiếu, độ dài xương. Sau khi sửa, không còn đặc trưng tóm tắt nào lệch mạnh.
- Lệch ở mức phân bố tư thế từng khớp vẫn còn rất lớn, tiền xử lý tay không xoá được.
- Muốn thu hẹp tiếp phải đổi cách tiếp cận: nâng OpenPose 2D lên 3D rồi train trên Kinect 3D; dùng đặc trưng bất biến hơn (góc khớp); hoặc huấn luyện đối kháng domain hay fine-tune trên dữ liệu OpenPose có nhãn sạch.
- Giới hạn của phép đo: dùng đặc trưng tóm tắt và logistic regression, không phải ST-GCN; chưa đo được tác động lên model thật vì không có checkpoint.
