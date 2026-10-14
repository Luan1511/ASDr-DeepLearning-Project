# M-CHAT-R/F trong AIMBRACE — giấy phép, bản tiếng Việt và email xin phép

> Tóm tắt nghiên cứu ngày 2026-10-07 (không phải tư vấn pháp lý). Tài liệu này **không** chứa nội dung câu hỏi M-CHAT-R/F.

## 1. Vì sao cần xin phép

- M-CHAT-R/F™ © 2009 Diana Robins, Deborah Fein, & Marianne Barton. Được dùng miễn phí cho mục đích lâm sàng, nghiên cứu, giáo dục **khi tải từ mchatscreen.com**.
- Đưa bảng hỏi vào **phần mềm/website cho người khác dùng** (kể cả phi thương mại) cần **giấy phép của tác giả** (trang License Inquiry, phần Permissions trong bản PDF chính thức, phần Follow-Up: "commercial *or electronic* product").
- Điều kiện đã công bố: giữ nguyên văn, đủ 20 câu, đúng thứ tự; ghi dòng bản quyền trên mọi bản sao; không thêm hình ảnh/âm thanh; tải từ mchatscreen.com.
- Giấy phép của a365.vn (CCIHP) và việc Bộ Y tế đưa M-CHAT-R/F vào Quyết định 2254/QĐ-BYT **không** chuyển sang AIMBRACE.
- Trong lúc chờ: AIMBRACE chỉ dùng **chế độ nhập theo số câu** (`MCHAT_MODE=entry`: phụ huynh làm trên phiếu chính thức rồi nhập Có/Không) — vẫn nên hỏi tác giả xem chế độ này có cần giấy phép không (đã nêu trong email).

## 2. Bản tiếng Việt nên dùng

| Bản | Nhận xét |
|---|---|
| **CCIHP 2015** (mchatscreen.com, 28 trang, đủ R/F, văn bản Unicode) | **Khuyến nghị.** Gần với bản trong QĐ 2254/QĐ-BYT và a365. Dùng thuật ngữ cũ "nguy cơ". |
| Diep et al. 2014 | Đủ R/F nhưng không trích được văn bản. |
| v3 | Chỉ M-CHAT-R, không có Follow-Up. Không dùng. |
| v4 | Theo quy tắc cũ (best-7). Không dùng. |

Lưu ý cấu trúc: AIMBRACE chạy Follow-Up theo **bản 2025**. Câu 13 bản 2025 có thêm một câu hỏi thăm dò không có trong bản tiếng Việt 2015 → cần hỏi tác giả bản dịch phù hợp.

## 3. Cách bật chế độ hỏi trong ứng dụng (sau khi được phép)

1. `cd backend && npm run questionnaires:content-template` → tạo `content/mchat-rf.template.json` (chỉ có mã, không có chữ).
2. Sao chép thành `content/mchat-rf.vi.json` (bị `.gitignore` chặn), điền **nguyên văn** từ bản tiếng Việt chính thức, ghi `licenseRef` (ngày/số thư cho phép), `translationSource`, `copyrightNotice`.
3. `npm run questionnaires:validate-content` → phải báo `ready`.
4. Đặt `MCHAT_MODE=inapp` trong `backend/.env`, khởi động lại backend. Trang Admin → thẻ "Bảng hỏi" hiển thị trạng thái nội dung.

## 4. Bằng chứng về làm bảng hỏi trên máy (tóm tắt)

- Làm trên máy giúp Follow-Up được thực hiện và chấm đúng (Campbell 2017: ghi nhận đúng 54% → 92%; Attar/Robins 2023: không mất dữ liệu, Follow-Up hoàn thành cùng ngày).
- Khi **phụ huynh tự làm Follow-Up**, PPV thấp hơn phỏng vấn qua điện thoại (0,28 so với 0,60; Attar 2023) → giữ ngưỡng ≥ 2, luôn có lựa chọn **làm cùng nhân viên y tế**, và kết quả "khả năng cao" chỉ là khuyến nghị đi đánh giá.
- Không để Follow-Up bị bỏ dở thành kết quả cuối (Sturner 2022: 14% bị bỏ qua).

## 5. Email xin phép (bản nháp, tiếng Anh)

**To:** mchatscreen2009@gmail.com
**Subject:** M-CHAT R/F Permissions Question – non-commercial student research app (Vietnam)

Dear Dr. Robins,

We are a student research team at the Vietnam–Korea University of Information and Communication Technology (VKU), The University of Da Nang, Vietnam, supervised by [Supervisor name, title]. We are developing AIMBRACE, a free, non-commercial research and education web application for the AI for Life 2026 programme. AIMBRACE helps Vietnamese parents of young children with developmental monitoring and links them to professional care. It does not diagnose.

We would like to ask permission to include the M-CHAT-R/F in AIMBRACE as a parent-report assessment, alongside (but scored separately from) our other modules. Specifically, we propose:

1. **Verbatim display of an official Vietnamese translation.** We plan to use the Vietnamese version by CCIHP (2015) posted on mchatscreen.com, unless you recommend a different version (for example the text in Vietnam Ministry of Health Decision 2254/QĐ-BYT). We would show the complete instrument with no changes to title, items, examples, instructions or order. Items would appear one per screen with Yes/No buttons, and there would be no added images, audio or text-to-speech.
2. **Copyright notice** "© 2009 Diana Robins, Deborah Fein, & Marianne Barton" on every screen and on every result printout, with a link to www.mchatscreen.com.
3. **Automatic scoring** exactly per the official algorithm. We will check the scoring against test cases and are glad to share our implementation for your review.
4. **Computer-administered Follow-Up.** For scores of 3–7, the Follow-Up would start immediately for the failed items only, with screen-positive at 2 or more failed items, following the official flowcharts of the current (2025) form. If you have an authorized electronic Follow-Up version (as in Attar et al., 2023) or an approved Vietnamese version of it, we would be grateful to use it. We also offer a health-worker-assisted Follow-Up in which the app only records pass/fail per item.
5. **Terminology:** please advise whether we should use the March 2025 "likelihood" terminology in our result screens, and which Vietnamese text matches the 2025 Follow-Up (item 13).
6. **Result communication:** results will be labelled as screening, never diagnosis, and will include the recommended actions (rescreening, Follow-Up, referral for diagnostic evaluation and early intervention). Questionnaire scores will not be combined with any other score.
7. **Data protection:** parental consent, access limited to the family and authorized professionals, no sale or advertising use of data, deletion on request, and compliance with Vietnamese personal-data law.
8. **Non-commercial:** free to users, no fees, ads or sublicensing. We expect about [N] users during [start–end dates].

While we wait for your decision, we would only link to the official PDF on mchatscreen.com and let parents enter Yes/No by item number for automatic scoring. Please let us know if even this requires a license.

We are happy to sign a license agreement, accept any conditions, send screenshots for approval, and remove the content at any time on request. Thank you very much for considering our request.

Sincerely,
[Student name], on behalf of the AIMBRACE team
[Supervisor name, title, email]
Vietnam–Korea University of ICT (VKU), The University of Da Nang
[email] | [phone] | [project URL]
