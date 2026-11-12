# Giọng nói Bạn Bin

Bản thử nghiệm dùng Gipformer 1.5 INT8 qua sherpa-onnx và VieNeu-TTS v3
Turbo trên CPU. Groq tiếp tục tạo kịch bản Bạn Bin từ bản chép lời và dùng
hạn mức của tài khoản hiện có. Dịch vụ âm thanh chỉ kết nối với backend
trong mạng Compose, qua cổng 8020. Không cần GPU cho dịch vụ này.

## Chạy với Docker Compose

Cấu hình `GROQ_API_KEY` thuộc gói Free và thêm vào file `.env` của Compose:

```dotenv
BUDDY_VOICE_URL=http://buddy-voice:8020
```

```sh
docker compose --profile buddy-voice up -d --build buddy-voice backend frontend
docker compose logs -f buddy-voice
```

Lần đầu tải các model từ Hugging Face và làm nóng bộ tổng hợp giọng. Các
model được cache trong volume `buddy_voice_models`. Sau khi Uvicorn báo
startup hoàn tất, mở `/buddy` qua HTTPS hoặc localhost. Phụ huynh chọn
**Bật mic rảnh tay** và cấp quyền mic một lần. Sau khoảng một giây im lặng
cuối câu, trình duyệt tự gửi lượt vừa nói. Mic tự mở lại khi Bin nói xong.
Chọn **Ngắt lời** để dừng câu đang phát và nói tiếp. **Tạm dừng mic**, đổi
hồ sơ hoặc rời tab sẽ đóng phiên mic.

AudioWorklet phát hiện lượt nói ngay trong trình duyệt. Lúc chờ chỉ giữ một
đoạn đệm ngắn trong bộ nhớ để giữ âm đầu câu. Trình duyệt gửi từng lượt
dưới dạng WAV, tối đa 12 giây. Mic tạm ngưng trong lúc Bin xử lý và phát
lời đáp.

Có thể đổi `BUDDY_ASR_THREADS` (mặc định `2`) và `BUDDY_TTS_VOICE`
(mặc định `Quang Sơn`) trong file `.env` của Compose. Để tắt tính năng trên
môi trường triển khai, để trống `BUDDY_VOICE_URL` rồi nạp lại backend.

## Chạy khi phát triển

Trong môi trường Python riêng, cài `requirements.txt` rồi chạy từ thư mục
này:

```sh
python -m uvicorn app:app --host 127.0.0.1 --port 8020 --no-access-log
```

Đặt `BUDDY_VOICE_URL=http://127.0.0.1:8020` ở backend dev và khởi động lại
backend. Dịch vụ xử lý âm thanh trong bộ nhớ. Bản chép lời được gửi qua
luồng Groq hiện hành, vì vậy nên dùng giọng người lớn khi thử trước khi
đánh giá cách xử lý dữ liệu với nhóm. Có thể thử các câu ngắn, ngập ngừng
giữa câu, ngắt lời lúc Bin đang nói và thu hồi quyền mic để kiểm tra fallback.

Bạn Bin dùng tối đa 32 tin nhắn gần nhất trong tab đang trò chuyện. Chuyển
hồ sơ hoặc rời trang sẽ bắt đầu lại. Mỗi lượt tạo một đoạn thoại ngắn để
đọc liền mạch. Khi dịch vụ chat tạm lỗi, nút **Thử lại** gửi lại lượt hiện
tại với ngữ cảnh đang có.
Nếu bản chép lời sai, **Sửa lời vừa nói** thay câu vừa nhận và tạo lại lời
đáp của Bin từ câu đã sửa.

- [Gipformer 1.5 và giấy phép MIT](https://huggingface.co/g-group-ai-lab/gipformer1.5-68M-rnnt)
- [VieNeu-TTS streaming](https://docs.vieneu.io/docs/sdk/streaming/)
- [Groq Free Plan limits](https://console.groq.com/docs/rate-limits)
